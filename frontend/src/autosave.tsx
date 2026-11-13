import { useEffect, useId, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { UrlInput } from "./UrlInput";
import { CostInput } from "./components";
import { api, ApiError, type Jar } from "./api";
import { Select } from "./Select";
import { TextArea } from "./TextArea";
import { Autocomplete, type SuggestionField } from "./Autocomplete";

type Value = string | number | null;
type RecordValue = Record<string, Value>;
type Options = {
  resource: string;
  field: string;
  value: Value;
  label: string;
  type?: "text" | "number" | "currency" | "url" | "textarea";
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  children?: ReactNode;
  suggestions?: SuggestionField;
};
type Attempt = { value: string; run: () => Promise<string> };
type Draft = {
  key: string;
  options: Options;
  value: string;
  baseline: string;
  remote: string;
  href: string;
  status: "idle" | "dirty" | "saving" | "saved" | "error";
  validation: string;
  error: string;
  conflict: boolean;
  queued: boolean;
  timer?: ReturnType<typeof setTimeout>;
  attempt?: Attempt;
  invalidate: () => Promise<void>;
};
const drafts = new Map<string, Draft>();
const queues = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;
const snapshot = () => version;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const notify = () => {
  version++;
  listeners.forEach((listener) => listener());
};
const display = (value: unknown) => (value == null ? "" : String(value));
const readValue = (record: Record<string, unknown>, field: string) =>
  display(record[field]);
const changesFor = (options: Options, value: string): RecordValue => {
  return {
    [options.field]:
      value.trim() === ""
        ? null
        : options.type === "number"
          ? Number(value)
          : value.trim(),
  };
};
function validate(options: Options, value: string) {
  if (!value.trim()) return options.required ? "Enter a value." : "";
  if (options.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "Enter a valid number.";
    if (n < (options.min ?? 0) || n > (options.max ?? 10000000))
      return `Enter a weight between ${options.min ?? 0} and ${options.max ?? 10000000} g.`;
    if (Math.abs(n * 1000 - Math.round(n * 1000)) > 0.00001)
      return "Use at most three decimal places.";
  }
  if (options.type === "url" && !/^https?:\/\/\S+$/.test(value.trim()))
    return "Use an http:// or https:// URL.";
  if (value.length > (options.maxLength ?? 200))
    return "This value is too long.";
  return "";
}

function operation(options: Options, value: string, baseline: string): Attempt {
  const changes = changesFor(options, value);
  const expected = changesFor(options, baseline);
  return {
    value,
    run: async () => {
      if (!options.resource.startsWith("/containers/")) {
        const result = await api<Record<string, unknown>>(
          options.resource,
          "PATCH",
          { changes, expected },
        );
        return readValue(result, options.field);
      }
      for (let tries = 0; tries < 3; tries++) {
        const current = await api<Jar>(options.resource);
        const saved = readValue(
          current as unknown as Record<string, unknown>,
          options.field,
        );
        const desired = readValue(changes, options.field);
        if (saved === desired) return saved;
        if (saved !== baseline)
          throw new ApiError(409, "This field changed elsewhere.");
        try {
          const result = await api<Jar>(options.resource, "PATCH", {
            ...changes,
            expected_revision: current.revision,
          });
          return readValue(
            result as unknown as Record<string, unknown>,
            options.field,
          );
        } catch (error) {
          if (
            !(error instanceof ApiError) ||
            error.status !== 409 ||
            tries === 2
          )
            throw error;
        }
      }
      throw new ApiError(409, "The jar is changing. Wait a moment and retry.");
    },
  };
}
function schedule(draft: Draft) {
  clearTimeout(draft.timer);
  draft.timer = setTimeout(() => {
    void flush(draft);
  }, 750);
}
function change(draft: Draft, value: string, nativeError = "") {
  draft.value = value;
  draft.validation = nativeError || validate(draft.options, value);
  if (!draft.queued) {
    draft.status = "dirty";
    draft.error = "";
  }
  schedule(draft);
  notify();
}
async function flush(draft: Draft) {
  clearTimeout(draft.timer);
  if (
    drafts.get(draft.key) !== draft ||
    draft.queued ||
    draft.validation ||
    draft.status === "error"
  )
    return;
  if (!draft.attempt && draft.value === draft.baseline) {
    draft.status = "idle";
    notify();
    return;
  }
  draft.queued = true;
  draft.status = "saving";
  notify();
  const previous = queues.get(draft.options.resource) ?? Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(async () => {
      if (drafts.get(draft.key) !== draft) return;
      if (draft.validation) {
        draft.queued = false;
        draft.status = "dirty";
        notify();
        return;
      }
      // Take the latest draft when this record's preceding field has finished.
      draft.attempt ??= operation(draft.options, draft.value, draft.baseline);
      const attempt = draft.attempt;
      try {
        const saved = await attempt.run();
        draft.baseline = saved;
        draft.remote = saved;
        if (draft.value === attempt.value) draft.value = saved;
        draft.attempt = undefined;
        draft.error = "";
        draft.conflict = false;
        // Refetch while still marked as saving so stale query results cannot
        // replace either the successful value or newer typing in this field.
        await draft.invalidate();
        draft.status = draft.value === saved ? "saved" : "dirty";
      } catch (error) {
        if (error instanceof ApiError && error.status < 500)
          draft.attempt = undefined;
        draft.conflict = error instanceof ApiError && error.status === 409;
        draft.error =
          error instanceof Error
            ? error.message
            : "Unable to save. Please retry.";
        draft.status = "error";
        if (draft.conflict) {
          try {
            const latest = await api<Record<string, unknown>>(
              draft.options.resource,
            );
            draft.remote = readValue(latest, draft.options.field);
          } catch {
            /* Keep the draft and original error if refresh is unavailable. */
          }
        }
      } finally {
        draft.queued = false;
        notify();
        if (draft.status === "dirty" && !draft.validation) schedule(draft);
      }
    });
  queues.set(draft.options.resource, job);
  await job;
  if (queues.get(draft.options.resource) === job)
    queues.delete(draft.options.resource);
}
function retry(draft: Draft) {
  if (draft.conflict) {
    draft.baseline = draft.remote;
    draft.attempt = undefined;
  }
  draft.status = "dirty";
  void flush(draft);
}
async function discard(draft: Draft) {
  try {
    const latest = await api<Record<string, unknown>>(draft.options.resource);
    draft.remote = readValue(latest, draft.options.field);
    draft.value = draft.baseline = draft.remote;
    draft.attempt = undefined;
    draft.error = draft.validation = "";
    draft.status = "idle";
    await draft.invalidate();
  } catch {
    draft.error = "Unable to load the saved value. Please retry.";
  }
  notify();
}
export function forgetDrafts(resource: string, fieldNames?: readonly string[]) {
  for (const [key, draft] of drafts) {
    if (
      (draft.options.resource === resource ||
        draft.options.resource.startsWith(resource + "/")) &&
      (!fieldNames || fieldNames.includes(draft.options.field))
    ) {
      clearTimeout(draft.timer);
      draft.status = "idle";
      drafts.delete(key);
    }
  }
  notify();
}

export function useDraft(options: Options) {
  const client = useQueryClient();
  const key = `${options.resource}:${options.field}`;
  let draft = drafts.get(key);
  if (!draft) {
    draft = {
      key,
      options,
      value: display(options.value),
      baseline: display(options.value),
      remote: display(options.value),
      href: location.pathname + location.search,
      status: "idle",
      validation: "",
      error: "",
      conflict: false,
      queued: false,
      invalidate: () => client.invalidateQueries(),
    };
    drafts.set(key, draft);
  }
  draft.options = options;
  useSyncExternalStore(subscribe, snapshot);
  const entry = draft;
  useEffect(() => {
    entry.remote = display(options.value);
    if (
      (entry.status === "idle" || entry.status === "saved") &&
      entry.value !== entry.remote
    ) {
      entry.value = entry.baseline = entry.remote;
      entry.status = "idle";
      notify();
    }
  }, [entry, options.value]);
  useEffect(
    () => () => {
      void flush(entry);
    },
    [entry],
  );
  return {
    draft: entry,
    change: (value: string, error?: string) => change(entry, value, error),
    flush: () => {
      void flush(entry);
    },
  };
}
function Feedback({ draft, id }: { draft: Draft; id: string }) {
  return (
    <div className="field-feedback" id={id}>
      {(draft.validation || draft.error) && (
        <span role="alert">
          {draft.validation || draft.error}
          {draft.conflict && ` Saved value: ${draft.remote || "empty"}.`}
        </span>
      )}
      {draft.status === "error" && (
        <span className="field-recovery">
          <button
            type="button"
            className="text-button"
            onClick={() => retry(draft)}
          >
            {draft.conflict ? "Save my value" : "Retry"}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              void discard(draft);
            }}
          >
            Use saved value
          </button>
        </span>
      )}
    </div>
  );
}
export function InlineField(options: Options & { hideLabel?: boolean }) {
  const id = useId();
  const { draft, change, flush } = useDraft(options);
  const props = {
    id,
    value: draft.value,
    disabled: options.disabled,
    required: options.required,
    placeholder:
      options.placeholder ?? (options.required ? undefined : "Not set"),
    maxLength: options.maxLength ?? 200,
    "aria-invalid": Boolean(draft.validation || draft.error) || undefined,
    "aria-describedby": `${id}-feedback${options.hint ? ` ${id}-hint` : ""}`,
    onBlur: flush,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && options.type !== "textarea") {
        e.preventDefault();
        flush();
      }
    },
  };
  const onInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) =>
    change(
      e.target.value,
      e.target.validity.badInput ? "Enter a valid number." : "",
    );
  return (
    <div className="field inline-field" data-save-state={draft.status}>
      <label htmlFor={id} className={options.hideLabel ? "sr-only" : undefined}>
        {options.label}
      </label>
      {options.children ? (
        <Select
          id={id}
          value={draft.value}
          required={options.required}
          disabled={options.disabled}
          aria-describedby={`${id}-feedback`}
          onValueChange={(value) => {
            change(value);
            flush();
          }}
        >
          {options.children}
        </Select>
      ) : options.suggestions ? (
        <Autocomplete
          {...props}
          source={options.suggestions}
          onValueChange={change}
          onCommit={flush}
        />
      ) : options.type === "textarea" ? (
        <TextArea {...props} onChange={onInputChange} rows={2} />
      ) : options.type === "url" ? (
        <UrlInput {...props} label={options.label} onChange={onInputChange} />
      ) : options.type === "currency" ? (
        <CostInput
          {...props}
          onChange={({ currentTarget }) =>
            change(currentTarget.value, currentTarget.validationMessage)
          }
        />
      ) : (
        <input
          {...props}
          onChange={onInputChange}
          type={options.type ?? "text"}
          min={options.min ?? 0}
          max={options.max ?? 10000000}
          step="0.001"
        />
      )}
      {options.hint && <small id={`${id}-hint`}>{options.hint}</small>}
      <Feedback draft={draft} id={`${id}-feedback`} />
    </div>
  );
}
export function AutosaveStatus() {
  useSyncExternalStore(subscribe, snapshot);
  const entries = [...drafts.values()];
  const unsaved = entries.filter(
    (d) =>
      d.status === "dirty" || d.queued || d.status === "error" || d.validation,
  );
  useEffect(() => {
    if (!unsaved.length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved.length]);
  const failed = unsaved.filter((d) => d.error || d.validation);
  return (
    <div
      className={`autosave-status ${failed.length ? "has-errors" : ""}`}
      role="status"
      aria-live="polite"
    >
      {failed.length
        ? failed.map((d) => (
            <span key={d.key}>
              <Link to={d.href}>{d.options.label}: not saved</Link>{" "}
              <button
                className="text-button"
                onClick={() => {
                  void discard(d);
                }}
              >
                Discard
              </button>
            </span>
          ))
        : unsaved.length
          ? "Saving…"
          : entries.some((d) => d.status === "saved")
            ? "All changes saved"
            : null}
    </div>
  );
}
