import { useRef, useState, type ReactNode } from "react";
import { Link, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import {
  useApi,
  type Glaze,
  type GlazeRecord,
  type Jar,
  type Page,
} from "../api";
import {
  DetailPane,
  VesselList,
  Empty,
  ErrorMessage,
  JarList,
  ListHeading,
  Loading,
  InlinePanel,
  PhotoThumb,
  GlazeHeading,
  sortableHeadings,
} from "../components";
import { GlazeFields } from "../editors";
import { forgetDrafts } from "../autosave";
import { ContainerForm, GlazeForm, useSave } from "../forms";
import { PhotoGallery } from "../PhotoGallery";
import { SplitWorkspace } from "../SplitWorkspace";
import { useListSort } from "../useListSort";

export function Catalog() {
  const selectedId = useMatch("/glazes/:id")?.params.id;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q") || "";
  const { sort, descending } = useListSort(
    "glazes",
    params,
    ["name", "product_line"],
    "name",
  );
  const [adding, setAdding] = useState(false);
  const listScroll = useRef<HTMLDivElement>(null);
  const apiParams = new URLSearchParams({
    page_size: "1000",
    q,
    sort,
    descending: String(descending),
  });
  const records = useApi<Page<Glaze>>(`/glazes?${apiParams}`);
  const search = params.size ? `?${params}` : "";
  const listHref = `/catalog${search}`;
  const heading = sortableHeadings(sort, descending, update);

  function update(values: Record<string, string>) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(values)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
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
        <ListHeading
          title="Glazes"
          query={q}
          onQueryChange={(value) => update({ q: value })}
          inputLabel="Search catalog"
          placeholder="Search glazes…"
        >
          <button
            className="button primary list-add-button"
            aria-label="Add glaze"
            title="Add glaze"
            onClick={() => setAdding(true)}
          >
            <Plus size={18} />
            <span>Add</span>
          </button>
        </ListHeading>
        <ErrorMessage error={records.error} />
        <div className="inventory-table-scroll" ref={listScroll}>
          {records.isPending || records.data?.items.length ? (
            <table className="stock-table catalog-table">
              <caption className="sr-only">
                Glazes. Select a name to open details.
              </caption>
              <thead>
                <tr>
                  {heading("name", "Name")}
                  {heading(
                    "product_line",
                    "Product Line",
                    "catalog-product-line",
                  )}
                </tr>
              </thead>
              <tbody>
                {records.data?.items.map((record) => (
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
          {records.isPending && <Loading />}
        </div>
        <div className="inventory-footer">
          <span>
            {records.data?.total ?? 0}{" "}
            {records.data?.total === 1 ? "glaze" : "glazes"}
          </span>
        </div>
      </section>
      {adding ? (
        <DetailPane item="glaze" onClose={() => setAdding(false)}>
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
        </DetailPane>
      ) : selectedId ? (
        <GlazeDetail key={selectedId} id={selectedId} onClose={closeDetail} />
      ) : (
        <div className="jar-detail-pane empty-detail-pane" aria-hidden="true" />
      )}
    </SplitWorkspace>
  );
}

function GlazeProductHeader({
  heading,
  children,
}: {
  heading: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="glaze-product-header">
      <div className="glaze-product-title">{heading}</div>
      {children && <div className="detail-actions">{children}</div>}
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
  const query = useApi<GlazeRecord>(`/glazes/${id}`);
  const containers = useApi<Page<Jar>>(
    `/containers?glaze_id=${id}&page_size=1000`,
  );
  const [addingJar, setAddingJar] = useState(false);
  const deletion = useSave(() => {
    forgetDrafts(`/glazes/${id}`);
    onClose();
  });
  if (query.isPending || !query.data)
    return (
      <DetailPane item="glaze" onClose={onClose}>
        {query.isPending ? <Loading /> : <ErrorMessage error={query.error} />}
      </DetailPane>
    );
  const glaze = query.data;
  return (
    <DetailPane item="glaze" onClose={onClose}>
      <section className="detail-section glaze-product-section no-divider">
        <GlazeProductHeader heading={<GlazeHeading glaze={glaze} />}>
          <button
            type="button"
            className="button secondary"
            disabled={deletion.isPending}
            onClick={() => setAddingJar(true)}
          >
            <Plus size={15} /> Add a jar
          </button>
          <button
            type="button"
            className="icon-button delete-record"
            aria-label="Delete glaze"
            title="Delete glaze"
            disabled={deletion.isPending}
            onClick={() => {
              if (window.confirm(`Permanently delete ${glaze.name} and its glaze photos?`))
                deletion.mutate({ path: `/glazes/${id}`, method: "DELETE" });
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </GlazeProductHeader>
        <ErrorMessage error={deletion.error} />
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
      <PhotoGallery glaze={glaze} />
      <section className="detail-section no-divider">
        <div className="section-heading">
          <div>
            <h3>
              Jars{" "}
              <span className="count">{containers.data?.total ?? 0}</span>
            </h3>
          </div>
        </div>
        <ErrorMessage error={containers.error} />
        {containers.data?.items.length ? (
          <div className="related-table-scroll">
            <JarList jars={containers.data.items} caption="Jars" />
          </div>
        ) : (
          <div className="small-empty">
            No active jars. Add a jar to track its weight.
          </div>
        )}
      </section>
      <section className="detail-section" aria-label="Vessels">
        <div className="section-heading">
          <h3>
            Vessels <span className="count">{glaze.vessels.length}</span>
          </h3>
        </div>
        {glaze.vessels.length ? (
          <div className="related-table-scroll">
            <VesselList vessels={glaze.vessels} />
          </div>
        ) : (
          <p className="small-empty">No vessels use this glaze yet.</p>
        )}
      </section>
    </DetailPane>
  );
}
