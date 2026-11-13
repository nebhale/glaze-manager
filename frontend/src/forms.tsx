import { Select } from "./Select";
import { UrlInput } from "./UrlInput";
import { TextArea } from "./TextArea";
import { Autocomplete } from "./Autocomplete";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  api,
  formValues,
  useApi,
  weights,
  type Glaze,
  type Jar,
  type Manufacturer,
  type Page,
  type Preset,
} from "./api";
import { CostInput, ErrorMessage, Field, Submit, type SubmitEvent } from "./components";

export function useSave<T = unknown>(onSuccess?: (data: T) => void) {
  const client = useQueryClient();
  return useMutation<
    T,
    Error,
    { path: string; body?: unknown; method?: string }
  >({
    mutationFn: ({ path, body, method = "POST" }) => api<T>(path, method, body),
    onSuccess: (data) => {
      void client.invalidateQueries();
      onSuccess?.(data);
    },
  });
}

export function ManufacturerForm({ done }: { done: () => void }) {
  const save = useSave(done);
  return (
    <form
      aria-label="New manufacturer"
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          path: "/manufacturers",
          body: formValues(e.currentTarget),
        });
      }}
    >
      <div className="editable-grid">
        <Field label="Name">
          <input
            name="name"
            required
            maxLength={200}
            placeholder="e.g. AMACO"
            autoFocus
          />
        </Field>
        <Field label="Website">
          <UrlInput name="website" label="Website" placeholder="https://" />
        </Field>
        <Field label="Notes">
          <TextArea name="notes" />
        </Field>
      </div>
      <ErrorMessage error={save.error} />
      <Submit pending={save.isPending} onCancel={done} label="Add" />
    </form>
  );
}

export function GlazeForm({ done }: { done: () => void }) {
  const manufacturers = useApi<Page<Manufacturer>>(
    "/manufacturers?page_size=1000",
  );
  const save = useSave(done);
  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    const values = formValues(e.currentTarget);
    save.mutate({
      path: "/glazes",
      body: values,
    });
  };
  return (
    <form className="record-form" onSubmit={submit}>
      <ErrorMessage error={manufacturers.error} />
      <div className="editable-grid">
        <Field label="Name">
          <input
            name="name"
            autoFocus
            required
            maxLength={200}
            placeholder="e.g. Blue Rutile"
          />
        </Field>
        <Field label="Product code">
          <input name="product_code" maxLength={200} placeholder="PC-20" />
        </Field>
        <Field label="Cone">
          <Autocomplete source="cone" name="cone" maxLength={200} />
        </Field>
        <Field label="Classification">
          <Select name="classification" defaultValue="">
            <option value="">Not set</option>
            <option value="glaze">Glaze</option>
            <option value="underglaze">Underglaze</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Manufacturer">
          <Select name="manufacturer_id" defaultValue="">
            <option value="">Not set</option>
            {manufacturers.data?.items.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Product line">
          <Autocomplete
            source="product_line"
            name="product_line"
            maxLength={200}
            placeholder="Potter’s Choice"
          />
        </Field>
        <Field label="Product page">
          <UrlInput
            name="product_url"
            label="Product page"
            placeholder="https://"
          />
        </Field>
        <Field label="Notes">
          <TextArea name="notes" />
        </Field>
      </div>
      <ErrorMessage error={save.error} />
      <Submit pending={save.isPending} onCancel={done} label="Add" />
    </form>
  );
}

export function ContainerForm({
  glazeId,
  done,
  created,
}: {
  glazeId?: string;
  done: () => void;
  created?: (jar: Jar) => void;
}) {
  const glazes = useApi<Page<Glaze>>("/glazes?page_size=1000");
  const presets = useApi<Page<Preset>>("/presets?page_size=1000");
  const [glaze, setGlaze] = useState(glazeId ?? "");
  const save = useSave<Jar>((data) => {
    created?.(data);
    done();
  });
  function submit(e: SubmitEvent) {
    e.preventDefault();
    save.mutate({
      path: "/containers",
      body: formValues(e.currentTarget),
    });
  }
  return (
    <form className="record-form" onSubmit={submit}>
      <ErrorMessage error={glazes.error || presets.error} />
      {glazes.data?.total === 0 && (
        <p className="notice">
          Start by adding a glaze to your catalog.{" "}
          <Link to="/catalog" onClick={done}>
            Open catalog →
          </Link>
        </p>
      )}
      <div className="editable-grid">
        <Field label="Glaze">
          <Select
            name="glaze_id"
            value={glaze}
            required
            onValueChange={(value) => setGlaze(value)}
          >
            <option value="" disabled>
              Choose a glaze
            </option>
            {glazes.data?.items.map((g) => (
              <option key={g.id} value={g.id}>
                <strong className="glaze-option-name">{g.name}</strong>
                {g.product_code && (
                  <>
                    {" "}
                    <span className="jar-product-code">{g.product_code}</span>
                  </>
                )}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Container">
          <Select name="preset_id" defaultValue="">
            <option value="">No container</option>
            {presets.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Location">
          <Autocomplete
            source="location"
            name="location"
            maxLength={200}
            placeholder="e.g. Studio, Home"
          />
        </Field>
        <Field label="Cost">
          <CostInput name="cost_usd" placeholder="Not set" />
        </Field>
        <Field label="Notes">
          <TextArea name="notes" />
        </Field>
      </div>
      <ErrorMessage error={save.error} />
      <Submit pending={save.isPending} onCancel={done} label="Add" />
    </form>
  );
}

export function PresetForm({ done }: { done: () => void }) {
  const save = useSave(done);
  return (
    <form
      aria-label="New container"
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          path: "/presets",
          body: weights(formValues(e.currentTarget)),
        });
      }}
    >
      <div className="editable-grid">
        <Field label="Name">
          <input
            name="name"
            maxLength={200}
            required
            placeholder="AMACO pint jar"
            autoFocus
          />
        </Field>
        <Field label="Weight (g)">
          <input
            name="tare_g"
            placeholder="Unknown"
            type="number"
            min="0"
            max="10000000"
            step="0.001"
          />
        </Field>
      </div>
      <ErrorMessage error={save.error} />
      <Submit pending={save.isPending} onCancel={done} label="Add" />
    </form>
  );
}
