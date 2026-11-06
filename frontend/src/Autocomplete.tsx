import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { createPortal } from "react-dom";
import { useApi } from "./api";

const suggestionLabels = {
  product_line: "Product line",
  location: "Location",
  vessel_location: "Location",
  cone: "Cone",
  application_note: "Application note",
};
export type SuggestionField = keyof typeof suggestionLabels;
type Props = Omit<
  ComponentProps<"input">,
  "value" | "defaultValue" | "onChange" | "type" | "list"
> & {
  source: SuggestionField;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onCommit?: () => void;
};

// A free-text combobox, rather than a select: suggestions never restrict what
// the studio can enter. The portal keeps it clear of scrolling detail panes.
export function Autocomplete({
  source,
  value,
  defaultValue = "",
  onValueChange,
  onCommit,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: Props) {
  const suggestions = useApi<string[]>(`/suggestions/${source}`);
  const [localValue, setLocalValue] = useState(defaultValue);
  const current = value ?? localValue;
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number; option: string } | null>(
    null,
  );
  const id = useId();
  const listId = `${id}-suggestions`;
  const query = current.trim().toLocaleLowerCase();
  const matches = (suggestions.data ?? []).filter((option) =>
    option.toLocaleLowerCase().includes(query),
  );
  const activeIndex = matches.findIndex((option) => option === active);
  const open = focused && !dismissed && matches.length > 0;
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportHeight = viewport?.height ?? innerHeight;
      let visibleTop = viewportTop;
      let visibleBottom = viewportTop + viewportHeight;
      // Portals escape clipping, so hide the menu when its input scrolls out
      // of view (including behind the detail pane's sticky navigation).
      for (
        let parent = input.current?.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (
          /(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)
        ) {
          const bounds = parent.getBoundingClientRect();
          visibleTop = Math.max(visibleTop, bounds.top + parent.clientTop);
          visibleBottom = Math.min(
            visibleBottom,
            bounds.top + parent.clientTop + parent.clientHeight,
          );
        }
      }
      const navigation = input.current
        ?.closest(".jar-detail-pane")
        ?.querySelector(".pane-navigation");
      if (navigation)
        visibleTop = Math.max(
          visibleTop,
          navigation.getBoundingClientRect().bottom,
        );
      if (rect.bottom <= visibleTop || rect.top >= visibleBottom) {
        setPosition(null);
        return;
      }
      const below = viewportTop + viewportHeight - rect.bottom - 12;
      const above = rect.top - viewportTop - 12;
      const upwards = below < 150 && above > below;
      const width = Math.min(Math.max(rect.width, 200), innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)),
        ...(upwards
          ? { bottom: innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
        width,
        maxHeight: Math.max(44, Math.min(240, upwards ? above : below)),
      });
    };
    update();
    const resize = new ResizeObserver(update);
    for (
      let parent = input.current?.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      resize.observe(parent);
    }
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
  useEffect(() => {
    if (open && activeIndex >= 0)
      list.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function change(next: string) {
    setLocalValue(next);
    onValueChange?.(next);
  }
  function choose(option: string) {
    change(option);
    setDismissed(true);
    setActive(null);
    onCommit?.();
  }
  return (
    <>
      <input
        {...props}
        ref={input}
        type="text"
        value={current}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && Boolean(position)}
        aria-controls={open && position ? listId : undefined}
        aria-activedescendant={
          open && position && activeIndex >= 0
            ? `${listId}-${activeIndex}`
            : undefined
        }
        onChange={(event) => {
          change(event.target.value);
          setActive(null);
          setDismissed(false);
        }}
        onFocus={(event) => {
          setFocused(true);
          setDismissed(false);
          void suggestions.refetch();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          setActive(null);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (
            (event.key === "ArrowDown" || event.key === "ArrowUp") &&
            matches.length
          ) {
            event.preventDefault();
            setDismissed(false);
            const next =
              event.key === "ArrowDown"
                ? (open ? activeIndex + 1 : 0) % matches.length
                : (open && activeIndex >= 0
                    ? activeIndex - 1 + matches.length
                    : matches.length - 1) % matches.length;
            setActive(matches[next]);
            return;
          }
          if (event.key === "Enter" && open && activeIndex >= 0) {
            event.preventDefault();
            choose(matches[activeIndex]);
            return;
          }
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setDismissed(true);
            setActive(null);
            return;
          }
          onKeyDown?.(event);
        }}
      />
      {suggestions.isError && focused && (
        <small role="status">
          Suggestions unavailable. You can still enter a value.
        </small>
      )}
      {open &&
        position &&
        createPortal(
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={`${suggestionLabels[source]} suggestions`}
            className="autocomplete-menu"
            style={position}
          >
            {matches.map((option, index) => (
              <div
                key={option}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className="autocomplete-option"
                // Keep focus in the input so blur cannot save a partial value before
                // mouse/touch selection commits the chosen suggestion.
                onPointerDown={(event) => {
                  event.preventDefault();
                  touchStart.current =
                    event.pointerType === "touch"
                      ? { x: event.clientX, y: event.clientY, option }
                      : null;
                }}
                onTouchEnd={(event) => {
                  // Commit taps without the synthesized mouse click, which
                  // could hit a control underneath after this menu disappears.
                  const start = touchStart.current;
                  touchStart.current = null;
                  const touch = event.changedTouches[0];
                  if (
                    start?.option === option &&
                    touch &&
                    Math.abs(touch.clientX - start.x) < 8 &&
                    Math.abs(touch.clientY - start.y) < 8
                  ) {
                    event.preventDefault();
                    choose(option);
                  }
                }}
                onPointerCancel={() => {
                  touchStart.current = null;
                }}
                onMouseMove={() => setActive(option)}
                onClick={() => choose(option)}
              >
                {option}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
