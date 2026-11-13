import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useApi, type KilnfireVesselOption } from "./api";
import { ErrorMessage } from "./components";

export function VesselPicker({
  id,
  value,
  onValueChange,
  disabled,
  "aria-describedby": describedBy,
}: {
  id?: string;
  value: KilnfireVesselOption | null;
  onValueChange: (value: KilnfireVesselOption | null) => void;
  disabled?: boolean;
  "aria-describedby"?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const vessels = useApi<KilnfireVesselOption[]>(
    `/kilnfire/vessel-options?q=${encodeURIComponent(query)}`,
  );
  const options = vessels.data ?? [];
  const activeIndex = options.findIndex((option) => option.id === active);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const rect = input.current?.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? innerHeight);
      const above = rect.top - top - 12;
      const below = bottom - rect.bottom - 12;
      const upwards = below < 180 && above > below;
      setPosition({
        left: rect.left,
        width: rect.width,
        ...(upwards
          ? { bottom: innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
        maxHeight: Math.max(44, Math.min(240, upwards ? above : below)),
      });
    }
    update();
    const resize = new ResizeObserver(update);
    const dialog = input.current?.closest("dialog");
    if (dialog) resize.observe(dialog);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (open && activeIndex >= 0)
      list.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function choose(vessel: KilnfireVesselOption) {
    onValueChange(vessel);
    setQuery("");
    setActive(null);
    setOpen(false);
  }

  return (
    <>
      <div className="vessel-picker-control">
        <input
          ref={input}
          id={id}
          className="vessel-picker-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && Boolean(position)}
          aria-controls={open && position ? listId : undefined}
          aria-activedescendant={
            open && position && activeIndex >= 0
              ? `${listId}-${activeIndex}`
              : undefined
          }
          aria-describedby={describedBy}
          autoComplete="off"
          placeholder="Search by name or #"
          disabled={disabled}
          value={value?.name ?? query}
          onChange={(event) => {
            onValueChange(null);
            setQuery(event.target.value);
            setActive(null);
            setOpen(true);
          }}
          onFocus={(event) => {
            setOpen(true);
            if (value) event.currentTarget.select();
          }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (!options.length) return;
              const next =
                event.key === "ArrowDown"
                  ? (open ? activeIndex + 1 : 0) % options.length
                  : (open && activeIndex >= 0
                      ? activeIndex - 1 + options.length
                      : options.length - 1) % options.length;
              setActive(options[next].id);
            } else if (event.key === "Enter" && open) {
              event.preventDefault();
              if (activeIndex >= 0) choose(options[activeIndex]);
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setActive(null);
            }
          }}
        />
        {value && <span className="vessel-number">#{value.id}</span>}
        <button
          type="button"
          className="icon-button"
          aria-label="Show vessels"
          tabIndex={-1}
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            input.current?.focus();
            setOpen(!open);
          }}
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
      <ErrorMessage error={vessels.error} />
      {open &&
        position &&
        createPortal(
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label="Vessels"
            className="autocomplete-menu vessel-picker-menu"
            style={position}
          >
            {options.map((vessel, index) => (
              <div
                key={vessel.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={value?.id === vessel.id}
                data-active={active === vessel.id || undefined}
                className="autocomplete-option vessel-picker-option"
                onPointerDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(vessel.id)}
                onClick={() => choose(vessel)}
              >
                <span className="vessel-picker-name">{vessel.name}</span>
                <span className="vessel-number">
                  #{vessel.id}
                  {vessel.archived ? " (archived)" : ""}
                </span>
              </div>
            ))}
            {!options.length && (
              <div
                role="option"
                aria-selected="false"
                aria-disabled="true"
                className="autocomplete-option helper"
              >
                {vessels.isPending
                  ? "Loading vessels…"
                  : "No matching vessels."}
              </div>
            )}
          </div>,
          input.current?.closest("dialog") ?? document.body,
        )}
    </>
  );
}
