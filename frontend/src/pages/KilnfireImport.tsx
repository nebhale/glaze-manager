import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  Amphora,
  Archive,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import {
  ApiError,
  api,
  useApi,
  type KilnfireCandidate,
  type KilnfireStatus,
  type KilnfireVesselOption,
  type Page,
  type Vessel,
} from "../api";
import { ErrorMessage, Field, ListHeading } from "../components";
import { useSave } from "../forms";
import { VesselPicker } from "../VesselPicker";
import { forgetDrafts } from "../autosave";

function createdDate(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Date unavailable";
}

function ImportChoice({
  piece,
  endpoint,
  onClose,
  onImport,
}: {
  piece: KilnfireCandidate;
  endpoint: string;
  onClose: () => void;
  onImport: (vessel: Vessel) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [destination, setDestination] = useState("new");
  const [selected, setSelected] = useState<KilnfireVesselOption | null>(null);
  const save = useSave<Vessel>((vessel) => {
    forgetDrafts(`/vessels/${vessel.id}`, ["name"]);
    onImport(vessel);
  });
  useEffect(() => {
    if (save.error instanceof ApiError && save.error.status === 409)
      setSelected(null);
  }, [save.error]);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      className="kilnfire-dialog"
      ref={dialog}
      aria-labelledby="import-choice-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!save.isPending) onClose();
      }}
    >
      <div className="kilnfire-dialog-heading">
        <h2 id="import-choice-heading">{piece.name}</h2>
        <button
          className="icon-button"
          aria-label="Close import"
          disabled={save.isPending}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="kilnfire-dialog-image">
        {piece.thumbnail_url ? (
          <img src={piece.thumbnail_url} alt={piece.name} />
        ) : (
          <Amphora size={64} aria-hidden="true" />
        )}
      </div>
      <form
        className="record-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (save.isPending || (destination === "existing" && !selected))
            return;
          save.mutate({
            path: `/kilnfire/pieces/${piece.piece_id}/import`,
            body: {
              endpoint,
              vessel_id: destination === "existing" ? selected?.id : null,
              expected_name: destination === "existing" ? selected?.name : null,
            },
          });
        }}
      >
        <fieldset
          className="kilnfire-destination"
          aria-label="Destination"
          disabled={save.isPending}
        >
          <label>
            <input
              type="radio"
              name="destination"
              value="new"
              checked={destination === "new"}
              onChange={() => setDestination("new")}
            />{" "}
            New vessel
          </label>
          <label>
            <input
              type="radio"
              name="destination"
              value="existing"
              checked={destination === "existing"}
              onChange={() => setDestination("existing")}
            />{" "}
            Existing vessel
          </label>
        </fieldset>
        {destination === "existing" && (
          <Field label="Existing vessel">
            <VesselPicker
              value={selected}
              onValueChange={setSelected}
              disabled={save.isPending}
            />
          </Field>
        )}
        <ErrorMessage error={save.error} />
        {save.isPending ? (
          <p role="status" className="sr-only">
            Importing piece and photos…
          </p>
        ) : null}
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={save.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={
              save.isPending || (destination === "existing" && !selected)
            }
            aria-busy={save.isPending}
          >
            {save.isPending ? (
              <LoaderCircle
                size={17}
                className="kilnfire-import-spinner"
                aria-hidden="true"
              />
            ) : (
              <Download size={17} aria-hidden="true" />
            )}
            Import
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function KilnfireImport() {
  const connection = useApi<KilnfireStatus>("/kilnfire");
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const showArchived = params.get("show_archived") === "true";
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);
  const [selected, setSelected] = useState<KilnfireCandidate | null>(null);
  const [imported, setImported] = useState<Vessel | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const refreshed = useRef<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const queryParams = new URLSearchParams({
    q,
    show_archived: String(showArchived),
    page: String(page),
  });
  const ready = !!connection.data?.endpoint;
  const query = useApi<Page<KilnfireCandidate>>(
    `/kilnfire/pieces?${queryParams}`,
    ready,
  );
  const archive = useSave();
  const endpoint = connection.data?.endpoint ?? "";
  const connected = connection.data?.state === "connected";

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await api("/kilnfire/pieces/refresh", "POST");
      await client.invalidateQueries();
    } catch (error) {
      setRefreshError(error);
      await client.invalidateQueries({ queryKey: ["/kilnfire"] });
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    if (connected && endpoint && refreshed.current !== endpoint) {
      refreshed.current = endpoint;
      void refresh();
    }
    // Refresh once on entry, not on each archive edit or live update.
  }, [connected, endpoint]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [q, showArchived, page]);

  function update(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const key of ["page", "sort", "descending", "show_hidden"])
      next.delete(key);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  const total = query.data?.total ?? 0;
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(total / 48));
    if (query.data && page > lastPage) {
      const next = new URLSearchParams(params);
      if (lastPage === 1) next.delete("page");
      else next.set("page", String(lastPage));
      setParams(next, { replace: true });
    }
  }, [query.data, total, page, params, setParams]);
  const needsLogin =
    refreshError instanceof ApiError && refreshError.status === 401;
  return (
    <section className="kilnfire-import-page" aria-label="Kilnfire items">
      <ListHeading
        title="Items"
        query={q}
        onQueryChange={(value) => update({ q: value })}
        inputLabel="Search items"
        placeholder="Search by short description…"
      >
        <button
          type="button"
          className="button secondary list-add-button"
          aria-label="Refresh items"
          title="Refresh items"
          disabled={!connected || refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </ListHeading>
      <div className="kilnfire-import-body" ref={scroll}>
        <ErrorMessage error={connection.error} />
        {!connection.isPending && (!connected || needsLogin) ? (
          <div className="notice">
            <p>
              {connection.data?.state === "needs_login" || needsLogin
                ? "Sign in again to renew your Kilnfire connection."
                : "Connect your Kilnfire studio to see items available for import."}
            </p>
            <Link className="button primary" to="/settings#kilnfire">
              {connection.data?.state === "needs_login" || needsLogin
                ? "Sign in in Settings"
                : "Connect in Settings"}
            </Link>
          </div>
        ) : connected ? (
          <>
            <ErrorMessage
              error={refreshError || query.error || archive.error}
            />
            {refreshing && (
              <p className="notice" role="status">
                Fetching items from Kilnfire…
              </p>
            )}
            {imported && (
              <p className="notice" role="status">
                Imported {imported.name}.{" "}
                <Link to={`/vessels/${imported.id}`}>
                  Open vessel #{imported.id}
                </Link>
              </p>
            )}
            {!refreshing && (
              <>
                {query.isPending && (
                  <p className="helper" role="status">
                    Loading items…
                  </p>
                )}
                <div
                  className="kilnfire-candidate-grid"
                  aria-label="Items available to import"
                >
                  {query.data?.items.map((piece) => (
                    <article
                      className={`kilnfire-candidate${piece.archived ? " is-archived" : ""}`}
                      key={piece.piece_id}
                      aria-label={piece.name}
                    >
                      <button
                        className="kilnfire-candidate-image"
                        onClick={() => setSelected(piece)}
                        aria-label={`Import ${piece.name}`}
                      >
                        {piece.thumbnail_url ? (
                          <img
                            src={piece.thumbnail_url}
                            alt={piece.name}
                            loading="lazy"
                          />
                        ) : (
                          <Amphora size={64} aria-hidden="true" />
                        )}
                        {piece.image_count > 1 && (
                          <span className="kilnfire-photo-count">
                            {piece.image_count} photos
                          </span>
                        )}
                      </button>
                      <div className="kilnfire-candidate-body">
                        <h2>{piece.name}</h2>
                        <p className="kilnfire-candidate-meta">
                          <span>{piece.firing_type || "Not assigned"}</span>
                          <span>{createdDate(piece.created_at)}</span>
                        </p>
                        {piece.archived && (
                          <span className="kilnfire-archived-label">
                            <Archive size={12} aria-hidden="true" /> Archived
                          </span>
                        )}
                        <div className="kilnfire-candidate-actions">
                          <button
                            className="button primary"
                            onClick={() => setSelected(piece)}
                          >
                            <Download size={15} aria-hidden="true" /> Import
                          </button>
                          <a
                            className="icon-button"
                            href={piece.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${piece.name} in Kilnfire`}
                            title="Open in Kilnfire"
                          >
                            <ExternalLink size={16} aria-hidden="true" />
                          </a>
                          <button
                            className="icon-button"
                            aria-label={`${piece.archived ? "Restore" : "Archive"} ${piece.name}`}
                            title={
                              piece.archived ? "Restore item" : "Archive item"
                            }
                            disabled={archive.isPending}
                            onClick={() =>
                              archive.mutate({
                                path: `/kilnfire/pieces/${piece.piece_id}`,
                                method: "PATCH",
                                body: {
                                  endpoint: new URL(piece.url).origin,
                                  archived: !piece.archived,
                                },
                              })
                            }
                          >
                            {piece.archived ? (
                              <RotateCcw size={17} aria-hidden="true" />
                            ) : (
                              <Archive size={17} aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                {!query.isPending && total === 0 && (
                  <p className="small-empty">
                    {q ? "No matching items." : "No items available to import."}
                  </p>
                )}
              </>
            )}
          </>
        ) : connection.isPending ? (
          <p role="status" className="helper">
            Checking your Kilnfire connection…
          </p>
        ) : null}
      </div>
      {connected && (
        <div className="inventory-footer inventory-list-footer">
          <span>
            {total} {total === 1 ? "item" : "items"}
          </span>
          <label className="archive-visibility">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) =>
                update({ show_archived: event.target.checked ? "true" : "" })
              }
            />{" "}
            Show archived
          </label>
          {(page > 1 || total > 48) && (
            <div>
              <button
                className="text-button"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) })}
              >
                Previous
              </button>
              <span>Page {page}</span>
              <button
                className="text-button"
                disabled={page * 48 >= total}
                onClick={() => update({ page: String(page + 1) })}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
      {selected && (
        <ImportChoice
          piece={selected}
          endpoint={new URL(selected.url).origin}
          onClose={() => setSelected(null)}
          onImport={(vessel) => {
            setSelected(null);
            setImported(vessel);
          }}
        />
      )}
    </section>
  );
}
