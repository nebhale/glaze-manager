import { useRef, useState, type ReactNode } from "react";
import { Link, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Camera, Plus, Search, Trash2, X } from "lucide-react";
import { useApi, type Glaze, type Jar, type Page, type Photo } from "../api";
import {
  AddButton,
  Empty,
  ErrorMessage,
  JarList,
  Loading,
  InlinePanel,
  PhotoThumb,
  GlazeHeading,
} from "../components";
import { GlazeFields } from "../editors";
import { ContainerForm, GlazeForm, useSave } from "../forms";
import { SplitWorkspace } from "../SplitWorkspace";

export function Catalog() {
  const selectedId = useMatch("/glazes/:id")?.params.id;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q") || "";
  const [adding, setAdding] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(Boolean(q));
  const searchOpen = searchExpanded || Boolean(q);
  const listScroll = useRef<HTMLDivElement>(null);
  const records = useApi<Page<Glaze>>(
    `/glazes?page_size=1000&q=${encodeURIComponent(q)}`,
  );
  const search = q ? `?q=${encodeURIComponent(q)}` : "";
  const listHref = `/catalog${search}`;

  function updateSearch(value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set("q", value);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
    if (listScroll.current) listScroll.current.scrollTop = 0;
  }

  function closeDetail() {
    setAdding(false);
    navigate(listHref, { replace: true });
    requestAnimationFrame(() =>
      document
        .getElementById(`catalog-${selectedId}`)
        ?.focus({ preventScroll: true }),
    );
  }

  return (
    <SplitWorkspace
      section="glazes"
      hasSelection={Boolean(selectedId || adding)}
    >
      <section
        id="glazes-list"
        className="inventory-list catalog-list"
        aria-label="Glazes"
      >
        <div className="inventory-heading">
          <h1>Glazes</h1>
          <div className="inventory-actions">
            <button
              className={`icon-button ${searchOpen ? "selected" : ""}`}
              aria-label="Search glazes"
              title="Search glazes"
              aria-expanded={searchOpen}
              onClick={() => {
                if (searchOpen) updateSearch("");
                setSearchExpanded(!searchOpen);
              }}
            >
              <Search size={18} />
            </button>
            <button
              className="button primary catalog-add-button"
              aria-label="Add glaze"
              title="Add glaze"
              onClick={() => setAdding(true)}
            >
              <Plus size={18} />
              <span>Add</span>
            </button>
          </div>
        </div>
        {searchOpen && (
          <div className="inventory-search">
            <label className="search-box">
              <Search size={16} />
              <input
                aria-label="Search catalog"
                placeholder="Search glazes…"
                autoFocus
                value={q}
                onChange={(event) => updateSearch(event.target.value)}
              />
              <button
                className="icon-button"
                aria-label="Clear and close search"
                onClick={() => {
                  updateSearch("");
                  setSearchExpanded(false);
                }}
              >
                <X size={15} />
              </button>
            </label>
          </div>
        )}
        <ErrorMessage error={records.error} />
        <div className="inventory-table-scroll" ref={listScroll}>
          {records.isPending ? (
            <Loading />
          ) : records.data?.items.length ? (
            <table className="stock-table catalog-table">
              <caption className="sr-only">
                Glazes. Select a name to open details.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" className="catalog-product-line">
                    Product Line
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.data.items.map((record) => (
                  <tr
                    key={record.id}
                    className={selectedId === record.id ? "selected-row" : ""}
                    onClick={(event) => {
                      if (!(event.target as HTMLElement).closest("a,button"))
                        document
                          .getElementById(`catalog-${record.id}`)
                          ?.click();
                    }}
                  >
                    <td>
                      <Link
                        id={`catalog-${record.id}`}
                        className="jar-select catalog-select"
                        to={`/glazes/${record.id}${search}`}
                        onClick={() => setAdding(false)}
                        aria-current={
                          selectedId === record.id ? "true" : undefined
                        }
                        title={record.name}
                      >
                        <PhotoThumb glaze={record} />
                        <span className="jar-name-text">
                          <strong>{record.name}</strong>
                          {record.product_code && (
                            <span className="jar-product-code">
                              {record.product_code}
                            </span>
                          )}
                        </span>
                      </Link>
                    </td>
                    <td
                      className="catalog-product-line"
                      title={record.product_line ?? undefined}
                    >
                      {record.product_line ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            !records.error && (
              <Empty
                title={q ? "No matching records" : "No glazes yet"}
                description={
                  q
                    ? "Try a different glaze name."
                    : "Add a glaze to get started."
                }
              />
            )
          )}
        </div>
        <div className="inventory-footer">
          <span>
            {records.data?.total ?? 0}{" "}
            {records.data?.total === 1 ? "glaze" : "glazes"}
          </span>
        </div>
      </section>
      {adding ? (
        <CatalogPane onClose={() => setAdding(false)}>
          <section
            className="catalog-create"
            aria-labelledby="catalog-create-heading"
          >
            <GlazeProductHeader
              heading={
                <div className="detail-heading">
                  <h2 id="catalog-create-heading">Glaze</h2>
                </div>
              }
            />
            <GlazeForm done={() => setAdding(false)} />
          </section>
        </CatalogPane>
      ) : selectedId ? (
        <GlazeDetail key={selectedId} id={selectedId} onClose={closeDetail} />
      ) : (
        <div className="jar-detail-pane empty-detail-pane" aria-hidden="true" />
      )}
    </SplitWorkspace>
  );
}

function CatalogPane({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      className="jar-detail-pane catalog-detail-pane"
      aria-label="Glaze details"
    >
      <div className="pane-navigation">
        <button className="text-button back-to-inventory" onClick={onClose}>
          <ArrowLeft size={16} />
          Glazes
        </button>
        <button
          className="icon-button close-pane"
          aria-label="Close glaze details"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <div className="pane-content">{children}</div>
    </aside>
  );
}

function PhotoCard({ photo }: { photo: Photo }) {
  const save = useSave();
  return (
    <div className="photo-item">
      <div className="photo-tile">
        <a
          href={photo.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open photo"
        >
          <img
            src={photo.thumbnail_url}
            alt={photo.caption || "Glaze sample"}
          />
        </a>
        <button
          type="button"
          className="icon-button photo-delete"
          aria-label="Delete photo"
          title="Delete photo"
          disabled={save.isPending}
          onClick={() => {
            if (window.confirm("Delete this photo?"))
              save.mutate({ path: `/photos/${photo.id}`, method: "DELETE" });
          }}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
      <ErrorMessage error={save.error} />
    </div>
  );
}

function GlazeProductHeader({
  heading,
  onAddJar,
}: {
  heading: ReactNode;
  onAddJar?: () => void;
}) {
  return (
    <div className="glaze-product-header">
      <div className="glaze-product-title">{heading}</div>
      {onAddJar && <AddButton onClick={onAddJar}>Add a jar</AddButton>}
    </div>
  );
}

export function GlazeDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const query = useApi<Glaze>(`/glazes/${id}`);
  const containers = useApi<Page<Jar>>(
    `/containers?glaze_id=${id}&page_size=1000`,
  );
  const [addingJar, setAddingJar] = useState(false);
  const upload = useSave();
  if (query.isPending || !query.data)
    return (
      <CatalogPane onClose={onClose}>
        {query.isPending ? <Loading /> : <ErrorMessage error={query.error} />}
      </CatalogPane>
    );
  const glaze = query.data;
  return (
    <CatalogPane onClose={onClose}>
      <section className="detail-section glaze-product-section">
        <GlazeProductHeader
          heading={<GlazeHeading glaze={glaze} />}
          onAddJar={() => setAddingJar(true)}
        />
        {addingJar && (
          <InlinePanel title="Jar" onClose={() => setAddingJar(false)}>
            <ContainerForm
              glazeId={glaze.id}
              done={() => setAddingJar(false)}
            />
          </InlinePanel>
        )}
        <GlazeFields glaze={glaze} />
      </section>
      <section className="detail-section photo-section" aria-label="Photos">
        <div className="section-heading">
          <h3>
            Photos <span className="count">{glaze.photos.length}</span>
          </h3>
        </div>
        <div className="photo-grid" aria-busy={upload.isPending}>
          {glaze.photos.map((photo) => (
            <PhotoCard photo={photo} key={photo.id} />
          ))}
          <label
            className={`photo-tile photo-add-tile ${upload.isPending ? "disabled" : ""}`}
            title="Add photo"
          >
            <span className="photo-add-icon" aria-hidden="true">
              <Camera size={26} />
              <Plus size={13} />
            </span>
            <input
              type="file"
              aria-label="Add photo"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              disabled={upload.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const body = new FormData();
                  body.append("file", file);
                  upload.mutate({ path: `/glazes/${glaze.id}/photos`, body });
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <span className="sr-only" role="status">
          {upload.isPending ? "Uploading photo…" : ""}
        </span>
        <ErrorMessage error={upload.error} />
      </section>
      <section className="detail-section">
        <div className="section-heading">
          <div>
            <h3>
              Active jars{" "}
              <span className="count">{containers.data?.total ?? 0}</span>
            </h3>
          </div>
        </div>
        <ErrorMessage error={containers.error} />
        {containers.data?.items.length ? (
          <div className="active-jars-scroll">
            <JarList jars={containers.data.items} caption="Active jars" />
          </div>
        ) : (
          <div className="small-empty">
            No active jars. Add a jar to track its weight.
          </div>
        )}
      </section>
    </CatalogPane>
  );
}
