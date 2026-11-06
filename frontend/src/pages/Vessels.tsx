import { useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Archive, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Autocomplete } from "../Autocomplete";
import { PhotoGallery } from "../PhotoGallery";
import { Select } from "../Select";
import { SplitWorkspace } from "../SplitWorkspace";
import {
  formValues,
  useApi,
  type Application,
  type GlazeReference,
  type Page,
  type Vessel,
  type VesselSummary,
} from "../api";
import { forgetDrafts, InlineField } from "../autosave";
import {
  DetailPane,
  ErrorMessage,
  Field,
  ListHeading,
  Loading,
  Submit,
  VesselList,
  sortableHeadings,
} from "../components";
import { useSave } from "../forms";

function NewVessel({
  onCreate,
  onClose,
}: {
  onCreate: (vessel: Vessel) => void;
  onClose: () => void;
}) {
  const save = useSave<Vessel>(onCreate);
  return (
    <DetailPane item="vessel" onClose={onClose}>
      <div className="detail-heading reference-detail">
        <h2>New vessel</h2>
      </div>
      <form
        className="record-form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            path: "/vessels",
            body: formValues(event.currentTarget),
          });
        }}
      >
        <div className="editable-grid">
          <Field label="Name">
            <input
              name="name"
              autoFocus
              required
              maxLength={200}
              placeholder="e.g. Carved serving bowl"
            />
          </Field>
          <Field label="Location">
            <Autocomplete
              name="location"
              source="vessel_location"
              maxLength={200}
            />
          </Field>
        </div>
        <ErrorMessage error={save.error} />
        <Submit
          label="Add vessel"
          pending={save.isPending}
          onCancel={onClose}
        />
      </form>
    </DetailPane>
  );
}

function AddApplication({
  vesselId,
  done,
}: {
  vesselId: number;
  done: () => void;
}) {
  const choices = useApi<GlazeReference[]>("/glaze-options");
  const save = useSave(done);
  return (
    <form
      className="record-item record-form application-form"
      aria-label="New glaze application"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({
          path: `/vessels/${vesselId}/applications`,
          body: formValues(event.currentTarget),
        });
      }}
    >
      <Field label="Glaze" hideLabel>
        <Select name="glaze_id" required autoFocus>
          <option value="" disabled>
            Choose a glaze
          </option>
          {choices.data?.map((glaze) => (
            <option key={glaze.glaze_id} value={glaze.glaze_id}>
              {glaze.manufacturer_name} · {glaze.glaze_name}
              {glaze.product_code ? ` (${glaze.product_code})` : ""}
            </option>
          ))}
        </Select>
      </Field>
      {choices.data?.length === 0 && (
        <p className="notice">
          <Link to="/catalog">Add a glaze to your catalog</Link> to record an
          application.
        </p>
      )}
      <div className="field">
        <Autocomplete
          aria-label="Application note"
          name="application_note"
          source="application_note"
          maxLength={2000}
          placeholder="e.g. 3 coats"
        />
      </div>
      <ErrorMessage error={choices.error || save.error} />
      <Submit pending={save.isPending} label="Save" onCancel={done} />
    </form>
  );
}

function ApplicationRow({
  vesselId,
  application,
}: {
  vesselId: number;
  application: Application;
}) {
  const path = `/vessels/${vesselId}/applications/${application.id}`;
  const remove = useSave(() => forgetDrafts(path));
  return (
    <li className="record-item">
      <div className="application-heading">
        <div>
          <Link to={`/glazes/${application.glaze_id}`}>
            {application.glaze_name}
          </Link>
          <div className="detail-code">
            {application.manufacturer_name}
            {application.product_code && ` · ${application.product_code}`}
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove ${application.glaze_name} application`}
          title="Remove application"
          disabled={remove.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Remove this application of ${application.glaze_name}?`,
              )
            )
              remove.mutate({ path, method: "DELETE" });
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      <InlineField
        resource={path}
        field="application_note"
        value={application.application_note}
        label="Application note"
        hideLabel
        suggestions="application_note"
        maxLength={2000}
        placeholder="e.g. 3 coats"
      />
      <ErrorMessage error={remove.error} />
    </li>
  );
}

function VesselDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const path = `/vessels/${id}`;
  const query = useApi<Vessel>(path);
  const [adding, setAdding] = useState(false);
  const archive = useSave();
  const deletion = useSave(() => {
    forgetDrafts(path);
    onClose();
  });
  const vessel = query.data;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 760px)").matches)
      heading.current?.focus({ preventScroll: true });
  }, [vessel?.id]);
  return (
    <DetailPane item="vessel" onClose={onClose}>
      {query.isPending ? (
        <Loading />
      ) : !vessel ? (
        <ErrorMessage error={query.error} />
      ) : (
        <>
          <section>
            <div className="jar-detail-header reference-detail">
              <div className="detail-heading">
                <h2 ref={heading} tabIndex={-1}>
                  {vessel.name}{" "}
                  <span className="vessel-number">#{vessel.id}</span>
                </h2>
              </div>
              <div className="detail-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={archive.isPending || deletion.isPending}
                  onClick={() =>
                    archive.mutate({
                      path,
                      method: "PATCH",
                      body: {
                        changes: { archived: !vessel.archived },
                        expected: { archived: vessel.archived },
                      },
                    })
                  }
                >
                  {vessel.archived ? (
                    <RotateCcw size={15} />
                  ) : (
                    <Archive size={15} />
                  )}
                  {vessel.archived ? "Restore vessel" : "Archive"}
                </button>
                <button
                  type="button"
                  className="icon-button delete-record"
                  aria-label="Delete vessel"
                  title="Delete vessel"
                  disabled={deletion.isPending || archive.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${vessel.name} (#${vessel.id}), its photos, and its glaze applications?`,
                      )
                    )
                      deletion.mutate({ path, method: "DELETE" });
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <ErrorMessage error={archive.error || deletion.error} />
            <div className="editable-grid">
              <InlineField
                resource={path}
                field="name"
                label="Name"
                value={vessel.name}
                required
              />
              <InlineField
                resource={path}
                field="location"
                label="Location"
                value={vessel.location ?? null}
                suggestions="vessel_location"
              />
            </div>
          </section>
          <PhotoGallery vessel={vessel} />
          <section className="detail-section vessel-glazes" aria-label="Glazes">
            <div className="section-heading">
              <h3>
                Glazes <span className="count">{vessel.applications.length}</span>
              </h3>
              {!adding && (
                <button
                  className="button secondary"
                  onClick={() => setAdding(true)}
                >
                  <Plus size={16} aria-hidden="true" /> Add
                </button>
              )}
            </div>
            {vessel.applications.length > 0 ? (
              <ol className="record-list">
                {vessel.applications.map((application) => (
                  <ApplicationRow
                    key={application.id}
                    vesselId={vessel.id}
                    application={application}
                  />
                ))}
              </ol>
            ) : (
              !adding && <p className="small-empty">No glazes recorded.</p>
            )}
            {adding && (
              <AddApplication
                vesselId={vessel.id}
                done={() => setAdding(false)}
              />
            )}
          </section>
        </>
      )}
    </DetailPane>
  );
}

const pageSize = 48;

export function Vessels() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const order = params.get("sort");
  const sort = order === "id" || order === "location" ? order : "name";
  const descending = params.get("descending") === "true";
  const showArchived = params.get("show_archived") === "true";
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);
  const search = params.size ? `?${params}` : "";
  const addButton = useRef<HTMLAnchorElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const apiParams = new URLSearchParams({
    q,
    sort,
    status: showArchived ? "all" : "active",
    descending: String(descending),
    page: String(page),
    page_size: String(pageSize),
  });
  const query = useApi<Page<VesselSummary>>(`/vessels?${apiParams}`);
  const total = query.data?.total;
  const heading = sortableHeadings(sort, descending, update);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [q, sort, descending, showArchived, page]);

  function update(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    next.delete("page");
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }
  function close() {
    navigate(`/vessels${search}`, { replace: true });
    requestAnimationFrame(() =>
      (document.getElementById(`vessel-${id}`) || addButton.current)?.focus({
        preventScroll: true,
      }),
    );
  }
  return (
    <SplitWorkspace section="vessels" hasSelection={Boolean(id)}>
      <section
        className="inventory-list"
        id="vessels-list"
        aria-label="Vessels"
      >
        <ListHeading
          title="Vessels"
          query={q}
          onQueryChange={(value) => update({ q: value })}
          inputLabel="Search vessels"
          placeholder="Search by name, location, or #…"
        >
          <Link
            ref={addButton}
            className="button primary list-add-button"
            aria-label="Add vessel"
            title="Add vessel"
            to={`/vessels/new${search}`}
          >
            <Plus size={18} />
            <span>Add</span>
          </Link>
        </ListHeading>
        <div ref={scroll} className="inventory-table-scroll">
          <ErrorMessage error={query.error} />
          <VesselList
            vessels={query.data?.items ?? []}
            selectedId={id}
            search={search}
            heading={heading}
          />
          {query.isPending && <Loading />}
          {query.data?.items.length === 0 && (
            <p className="small-empty">
              {q || page > 1
                ? "No matching vessels."
                : showArchived
                  ? "Add your first vessel to start recording photos and glazes."
                  : "Add a vessel or turn on Show archived."}
            </p>
          )}
        </div>
        <div className="inventory-footer inventory-list-footer">
          <span>
            {total ?? 0} {total === 1 ? "vessel" : "vessels"}
          </span>
          <label className="archive-visibility">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) =>
                update({ show_archived: event.target.checked ? "true" : "" })
              }
            />
            Show archived
          </label>
          {(page > 1 || (total ?? 0) > pageSize) && (
            <div>
              <button
                className="text-button"
                disabled={page <= 1}
                onClick={() =>
                  update({ page: page > 2 ? String(page - 1) : "" })
                }
              >
                Previous
              </button>
              <span>Page {page}</span>
              <button
                className="text-button"
                disabled={page * pageSize >= (total ?? 0)}
                onClick={() => update({ page: String(page + 1) })}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </section>
      {id === "new" ? (
        <NewVessel
          onClose={close}
          onCreate={(vessel) =>
            navigate(`/vessels/${vessel.id}${search}`, { replace: true })
          }
        />
      ) : id ? (
        <VesselDetail key={id} id={id} onClose={close} />
      ) : (
        <div className="jar-detail-pane empty-detail-pane" aria-hidden="true" />
      )}
    </SplitWorkspace>
  );
}
