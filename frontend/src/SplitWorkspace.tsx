import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { GripVertical } from "lucide-react";

const DEFAULT_WIDTH = 470;
const MIN_LIST_WIDTH = 360;
const MIN_DETAIL_WIDTH = 360;
const DIVIDER_WIDTH = 12;
// Share Inventory's saved width across sections.
const WIDTH_KEY = "glaze-manager.inventory-list-width";
let unsavedWidth: number | undefined;

function readWidth() {
  if (unsavedWidth !== undefined) return unsavedWidth;
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= MIN_LIST_WIDTH) return stored;
  } catch {
    // Resizing still works when browser storage is unavailable.
  }
  return DEFAULT_WIDTH;
}

function rememberWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
    unsavedWidth = undefined;
  } catch {
    unsavedWidth = width;
  }
}

export function SplitWorkspace({
  children,
  hasSelection,
  section = "inventory",
}: {
  children: [ReactNode, ReactNode];
  hasSelection: boolean;
  section?: "inventory" | "glazes" | "vessels";
}) {
  const sectionLabel = section[0].toUpperCase() + section.slice(1);
  const workspace = useRef<HTMLDivElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const [preferredWidth, setPreferredWidth] = useState(readWidth);
  const preferred = useRef(preferredWidth);
  const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    originalWidth: number;
  } | null>(null);
  const maximum =
    workspaceWidth == null
      ? preferredWidth
      : Math.max(
          0,
          Math.floor(workspaceWidth - DIVIDER_WIDTH - MIN_DETAIL_WIDTH),
        );
  const minimum = Math.min(MIN_LIST_WIDTH, maximum);
  const clamp = (width: number) =>
    Math.min(maximum, Math.max(minimum, Math.round(width)));
  const width = clamp(preferredWidth);

  useLayoutEffect(() => {
    const element = workspace.current!;
    const measure = () =>
      setWorkspaceWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("resizing-inventory");
    return () => document.body.classList.remove("resizing-inventory");
  }, [dragging]);

  function changeWidth(next: number, remember = false) {
    preferred.current = next;
    setPreferredWidth(next);
    if (remember) rememberWidth(next);
  }

  function finishDrag(cancel = false) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (cancel) changeWidth(current.originalWidth);
    else rememberWidth(preferred.current);
    setDragging(false);
    if (divider.current?.hasPointerCapture(current.pointerId)) {
      divider.current.releasePointerCapture(current.pointerId);
    }
  }

  return (
    <div
      ref={workspace}
      className={`inventory-workspace ${hasSelection ? "has-selection" : ""}`}
      style={{ "--inventory-list-width": `${width}px` } as CSSProperties}
    >
      {children[0]}
      <div
        ref={divider}
        className={`pane-divider ${dragging ? "is-dragging" : ""}`}
        role="separator"
        tabIndex={0}
        aria-label={`Resize ${section} panes`}
        aria-orientation="vertical"
        aria-controls={`${section}-list`}
        aria-valuemin={minimum}
        aria-valuemax={maximum}
        aria-valuenow={width}
        aria-valuetext={`${sectionLabel} width ${width} pixels`}
        aria-describedby={`${section}-divider-help`}
        title="Drag to resize · Double-click to reset"
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: width,
            originalWidth: preferred.current,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          changeWidth(
            clamp(current.startWidth + event.clientX - current.startX),
          );
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId === event.pointerId) finishDrag();
        }}
        onPointerCancel={(event) => {
          if (drag.current?.pointerId === event.pointerId) finishDrag(true);
        }}
        onLostPointerCapture={(event) => {
          if (drag.current?.pointerId === event.pointerId) finishDrag();
        }}
        onDoubleClick={() => changeWidth(DEFAULT_WIDTH, true)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && drag.current) {
            event.preventDefault();
            finishDrag(true);
            return;
          }
          if (drag.current) return;
          const step = event.shiftKey ? 50 : 10;
          const next = {
            ArrowLeft: clamp(width - step),
            ArrowRight: clamp(width + step),
            Home: minimum,
            End: maximum,
            Enter: DEFAULT_WIDTH,
          }[event.key];
          if (next == null) return;
          event.preventDefault();
          changeWidth(next, true);
        }}
      >
        <span className="pane-divider-grip" aria-hidden="true">
          <GripVertical size={12} />
        </span>
      </div>
      <span id={`${section}-divider-help`} className="sr-only">
        Drag or use the left and right arrow keys to resize. Hold Shift for
        larger steps. Home and End move to the limits. Double-click or press
        Enter to reset. Escape cancels a drag.
      </span>
      {children[1]}
    </div>
  );
}
