import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  Amphora,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Droplets,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { grams, percent, type Jar, type Glaze, type VesselSummary } from "./api";

export function JarIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="26"
      height="28"
      viewBox="0 0 26 28"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="5"
        y="2"
        width="16"
        height="4"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="3"
        y="8"
        width="20"
        height="18"
        rx="5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8 17c3-5 6 5 10 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function InlinePanel({
  title,
  children,
  onClose,
  backLabel,
}: {
  title: string;
  backLabel?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
    ref.current
      ?.querySelector<HTMLElement>("input, textarea, [role=combobox]")
      ?.focus({ preventScroll: true });
  }, []);
  return (
    <section ref={ref} className="panel inline-panel" aria-labelledby={titleId}>
      {backLabel && (
        <div className="pane-navigation">
          <button className="text-button back-to-inventory" onClick={onClose}>
            <ArrowLeft size={16} />
            {backLabel}
          </button>
          <button
            className="icon-button close-pane"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      )}
      <div className="pane-content">
        <div className="detail-heading reference-detail">
          <h2 id={titleId}>{title}</h2>
          {!backLabel && (
            <button
              className="icon-button"
              aria-label={`Close ${title}`}
              onClick={onClose}
            >
              <X size={17} />
            </button>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

export function CostInput(props: ComponentProps<"input">) {
  return (
    <div className="cost-input">
      <span aria-hidden="true">$</span>
      <input
        {...props}
        aria-description="US dollars"
        type="number"
        inputMode="decimal"
        min="0"
        max="9999999999.99"
        step="0.01"
      />
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  hideLabel,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </label>
      {cloneElement(
        children as ReactElement<{ id?: string; "aria-describedby"?: string }>,
        { id, "aria-describedby": hint ? `${id}-hint` : undefined },
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <div className="error" role="alert">
      <AlertCircle size={18} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      Loading your studio<span>…</span>
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <JarIcon />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Submit({
  pending,
  label = "Save changes",
  onCancel,
}: {
  pending: boolean;
  label?: string;
  onCancel?: () => void;
}) {
  return (
    <div className="form-actions">
      {onCancel && (
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? (
          "Saving…"
        ) : (
          <>
            <Check size={17} />
            {label}
          </>
        )}
      </button>
    </div>
  );
}
export function ListHeading({
  title,
  query,
  onQueryChange,
  inputLabel,
  placeholder,
  children,
}: {
  title: string;
  query: string;
  onQueryChange: (value: string) => void;
  inputLabel: string;
  placeholder: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(Boolean(query));
  const open = expanded || Boolean(query);
  const toggle = useRef<HTMLButtonElement>(null);
  const toggleLabel = `Search ${title.toLowerCase()}`;

  function closeSearch() {
    onQueryChange("");
    setExpanded(false);
    toggle.current?.focus();
  }

  return (
    <>
      <div className="inventory-heading">
        <h1>{title}</h1>
        <div className="inventory-actions">
          <button
            ref={toggle}
            type="button"
            className={`icon-button ${open ? "selected" : ""}`}
            aria-label={toggleLabel}
            title={toggleLabel}
            aria-expanded={open}
            onClick={() => open ? closeSearch() : setExpanded(true)}
          >
            <Search size={18} />
          </button>
          {children}
        </div>
      </div>
      {open && (
        <div className="inventory-search">
          <div className="search-box">
            <Search size={16} />
            <input
              aria-label={inputLabel}
              placeholder={placeholder}
              autoFocus
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Clear and close search"
              onClick={closeSearch}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function DetailPane({
  item,
  children,
  onClose,
}: {
  item: "glaze" | "vessel";
  children: ReactNode;
  onClose: () => void;
}) {
  const label = item === "vessel" ? "Vessel" : "Glaze";
  return (
    <aside
      className="jar-detail-pane catalog-detail-pane"
      aria-label={`${label} details`}
    >
      <div className="pane-navigation">
        <button className="text-button back-to-inventory" onClick={onClose}>
          <ArrowLeft size={16} />
          {label}s
        </button>
        <button
          className="icon-button close-pane"
          aria-label={`Close ${item} details`}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <div className="pane-content">{children}</div>
    </aside>
  );
}

function ArchiveMarker() {
  return (
    <span
      className="jar-archive-marker"
      role="img"
      aria-label="Archived"
      title="Archived"
    >
      <Archive size={12} aria-hidden="true" />
    </span>
  );
}

function VesselThumb({ vessel }: { vessel: VesselSummary }) {
  const photo = vessel.photos[0];
  return photo ? (
    <img
      className="glaze-thumb"
      src={photo.thumbnail_url}
      alt=""
      loading="lazy"
    />
  ) : (
    <span className="glaze-thumb placeholder">
      <Amphora size={24} aria-hidden="true" />
    </span>
  );
}

export function PhotoThumb({
  glaze,
  large = false,
}: {
  glaze: Glaze;
  large?: boolean;
}) {
  const photo = glaze.photos.find((p) => p.cover) || glaze.photos[0];
  return photo ? (
    <img
      className={`glaze-thumb ${large ? "large" : ""}`}
      src={photo.thumbnail_url}
      alt={`${glaze.name} glaze sample`}
    />
  ) : (
    <div className={`glaze-thumb placeholder ${large ? "large" : ""}`}>
      <Droplets size={large ? 40 : 22} />
    </div>
  );
}
export function GlazeHeading({ glaze, jar }: { glaze: Glaze; jar?: Jar }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 760px)").matches)
      heading.current?.focus({ preventScroll: true });
  }, [glaze.id, jar?.id]);
  return (
    <div className="detail-heading glaze-heading">
      <PhotoThumb glaze={glaze} />
      <div className="glaze-identity">
        <h2 ref={heading} tabIndex={-1}>
          {jar ? (
            <Link to={`/glazes/${glaze.id}`}>{glaze.name}</Link>
          ) : (
            <span>{glaze.name}</span>
          )}{" "}
          {jar && (
            <span className="heading-qualifier" title={`#${jar.number}`}>
              #{jar.number}
            </span>
          )}
        </h2>
        <div className="detail-code">
          {glaze.manufacturer_id && (
            <Link to={`/settings#manufacturer-${glaze.manufacturer_id}`}>
              {glaze.manufacturer_name}
            </Link>
          )}
          {glaze.manufacturer_name && glaze.product_code && " · "}
          {glaze.product_code}
        </div>
      </div>
    </div>
  );
}

export function RemainingWeight({ jar }: { jar: Jar }) {
  return (
    <>
      {jar.low_stock && <span className="sr-only">Low stock: </span>}
      <span
        className={jar.low_stock ? "remaining-weight low-stock-weight" : "remaining-weight"}
        title={jar.low_stock ? "Low stock" : undefined}
      >
        {grams(jar.remaining_g)}
      </span>
    </>
  );
}

export function RemainingBar({
  jar,
  className = "stock-meter",
}: {
  jar: Jar;
  className?: string;
}) {
  return jar.percentage == null ? (
    <div
      className={`${className} unknown${jar.low_stock ? " low" : ""}`}
      role="img"
      aria-label="Remaining percentage unknown"
      title="Weight setup needed"
    />
  ) : (
    <div
      className={`${className} ${jar.low_stock ? "low" : ""}`}
      role="progressbar"
      aria-label={`Jar #${jar.number} remaining`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.max(0, jar.percentage))}
      aria-valuetext={`${percent(jar.percentage)} remaining`}
      title={`${percent(jar.percentage)} remaining`}
    >
      <span
        style={{
          width: `${Math.min(100, Math.max(0, jar.percentage))}%`,
        }}
      />
    </div>
  );
}

export function sortableHeadings(
  sort: string,
  descending: boolean,
  update: (values: { sort: string; descending: string }) => void,
) {
  return (key: string, label: string, className?: string) => {
    const active = sort === key;
    return (
      <th
        scope="col"
        className={className}
        aria-sort={
          active ? (descending ? "descending" : "ascending") : undefined
        }
      >
        <button
          type="button"
          onClick={() =>
            update({ sort: key, descending: String(active && !descending) })
          }
        >
          {label}
          {active &&
            (descending ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
        </button>
      </th>
    );
  };
}

export function VesselList({
  vessels,
  selectedId,
  search = "",
  heading = (_key, label, className) => (
    <th scope="col" className={className}>
      {label}
    </th>
  ),
}: {
  vessels: VesselSummary[];
  selectedId?: string;
  search?: string;
  heading?: ReturnType<typeof sortableHeadings>;
}) {
  return (
    <table className="stock-table">
      <caption className="sr-only">Vessels</caption>
      <thead>
        <tr>
          {heading("id", "ID", "stock-id-column")}
          {heading("name", "Name", "stock-name-column")}
          {heading("location", "Location", "stock-location-column")}
        </tr>
      </thead>
      <tbody>
        {vessels.map((vessel) => (
          <tr
            key={vessel.id}
            className={
              String(vessel.id) === selectedId ? "selected-row" : undefined
            }
            onClick={(event) => {
              if (!(event.target as HTMLElement).closest("a,button"))
                event.currentTarget.querySelector("a")?.click();
            }}
          >
            <td className="stock-id-column" title={`#${vessel.id}`}>
              #{vessel.id}
            </td>
            <td className="stock-name-column">
              <Link
                id={`vessel-${vessel.id}`}
                className="jar-select"
                to={`/vessels/${vessel.id}${search}`}
                aria-label={`${vessel.name} #${vessel.id}${vessel.archived ? ", archived" : ""}`}
                aria-current={
                  String(vessel.id) === selectedId ? "true" : undefined
                }
                title={vessel.name}
              >
                <VesselThumb vessel={vessel} />
                <strong className="jar-name-text">{vessel.name}</strong>
                {vessel.archived && <ArchiveMarker />}
              </Link>
            </td>
            <td
              className="stock-location-column"
              title={vessel.location ?? undefined}
            >
              {vessel.location || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function JarList({
  jars,
  caption,
  selectedId,
  search = "",
  renderHeading,
}: {
  jars: Jar[];
  caption: string;
  selectedId?: string;
  search?: string;
  renderHeading?: (key: string, label: string, className: string) => ReactNode;
}) {
  const column =
    renderHeading ??
    ((_key, label, className) => (
      <th scope="col" className={className}>
        {label}
      </th>
    ));
  return (
    <table className="stock-table jar-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {column("number", "ID", "stock-id-column")}
          {column("name", "Name", "stock-name-column")}
          {column("percentage", "Remaining", "jar-bar-column")}
          {column("remaining_g", "Weight", "jar-weight-column")}
          {column("location", "Location", "stock-location-column")}
        </tr>
      </thead>
      <tbody>
        {jars.map((jar) => (
          <tr
            key={jar.id}
            data-jar-id={jar.id}
            className={selectedId === jar.id ? "selected-row" : ""}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest("a,button"))
                e.currentTarget.querySelector("a")?.click();
            }}
          >
            <td className="stock-id-column">#{jar.number}</td>
            <td className="stock-name-column">
              <Link
                id={`jar-${jar.id}`}
                className="jar-select"
                to={`/containers/${jar.id}${search}`}
                aria-label={`${[jar.glaze.name, jar.glaze.product_code].filter(Boolean).join(" ")}, jar #${jar.number}${jar.archived ? ", archived" : ""}`}
                aria-current={selectedId === jar.id ? "true" : undefined}
                title={[jar.glaze.name, jar.glaze.product_code]
                  .filter(Boolean)
                  .join(" ")}
              >
                <PhotoThumb glaze={jar.glaze} />
                <span className="jar-name-text">
                  <strong>{jar.glaze.name}</strong>
                  {jar.glaze.product_code && (
                    <span className="jar-product-code">
                      {jar.glaze.product_code}
                    </span>
                  )}
                </span>
                {jar.archived && <ArchiveMarker />}
              </Link>
            </td>
            <td className="jar-bar-column">
              <RemainingBar jar={jar} />
            </td>
            <td className="jar-weight-column">
              <RemainingWeight jar={jar} />
            </td>
            <td
              className="stock-location-column"
              title={jar.location || "Not set"}
            >
              {jar.location || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export function AddButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className="button primary" onClick={onClick}>
      <Plus size={18} />
      {children}
    </button>
  );
}
export type SubmitEvent = FormEvent<HTMLFormElement>;
