import { useEffect, useRef, useState } from "react";
import { Link, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useApi, type Jar, type Page } from "../api";
import {
  Empty,
  ErrorMessage,
  ListHeading,
  Loading,
  InlinePanel,
  JarList,
  sortableHeadings,
} from "../components";
import { ContainerForm } from "../forms";
import { ContainerDetail } from "./ContainerDetail";
import { SplitWorkspace } from "../SplitWorkspace";

const queryKeys = ["q", "sort", "descending", "page"];
const viewKeys = [...queryKeys, "show_archived"];

export function Inventory() {
  const selectedId = useMatch("/containers/:id")?.params.id;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const showArchived = params.get("show_archived") === "true";
  const tableScroll = useRef<HTMLDivElement>(null);
  const apiParams = new URLSearchParams({
    page_size: "100",
    status: showArchived ? "all" : "active",
    sort: "number",
  });
  queryKeys.forEach((key) => {
    if (params.get(key)) apiParams.set(key, params.get(key)!);
  });
  const jars = useApi<Page<Jar>>(`/containers?${apiParams}`);
  const sort = params.get("sort") || "number";
  const descending = params.get("descending") === "true";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const search = params.toString() ? `?${params}` : "";
  useEffect(() => {
    if ([...params.keys()].some((key) => !viewKeys.includes(key))) {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const key of [...next.keys()])
            if (!viewKeys.includes(key)) next.delete(key);
          next.delete("page");
          return next;
        },
        { replace: true },
      );
    }
  }, [params, setParams]);
  function update(values: Record<string, string>) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("page");
        Object.entries(values).forEach(([key, value]) =>
          value ? next.set(key, value) : next.delete(key),
        );
        return next;
      },
      { replace: true },
    );
    if (tableScroll.current) tableScroll.current.scrollTop = 0;
  }
  function closeDetail() {
    const id = selectedId;
    navigate(`/${search}`, { replace: true });
    requestAnimationFrame(() =>
      document.getElementById(`jar-${id}`)?.focus({ preventScroll: true }),
    );
  }
  return (
    <SplitWorkspace hasSelection={Boolean(selectedId || adding)}>
      <section
        id="inventory-list"
        className="inventory-list"
        aria-label="Jar inventory"
      >
        <ListHeading
          title="Inventory"
          query={params.get("q") || ""}
          onQueryChange={(value) => update({ q: value })}
          inputLabel="Search jars"
          placeholder="Search name, code, location, or #ID…"
        >
          <button
            className="button primary list-add-button"
            aria-label="Add a jar"
            title="Add a jar"
            onClick={() => setAdding(true)}
          >
            <Plus size={18} />
            <span>Add</span>
          </button>
        </ListHeading>
        <ErrorMessage error={jars.error} />
        <div className="inventory-table-scroll" ref={tableScroll}>
          {jars.isPending ? (
            <Loading />
          ) : jars.data?.items.length ? (
            <JarList
              jars={jars.data.items}
              caption="Jar inventory. Select a name to open jar details."
              selectedId={selectedId}
              search={search}
              renderHeading={sortableHeadings(sort, descending, update)}
            />
          ) : (
            !jars.error && (
              <Empty
                title={
                  params.get("q")
                    ? "No matching jars"
                    : showArchived
                      ? "No jars yet"
                      : "No active jars"
                }
                description={
                  params.get("q")
                    ? showArchived
                      ? "Try a different search to see more jars."
                      : "Try a different search or turn on Show archived."
                    : showArchived
                      ? "Add a glaze, then create your first jar."
                      : "Add a jar, or turn on Show archived to see archived jars."
                }
              >
                <Link className="button secondary" to="/catalog">
                  Manage glazes
                </Link>
              </Empty>
            )
          )}
        </div>
        <div className="inventory-footer inventory-list-footer">
          <span>
            {jars.data?.total ?? 0} {jars.data?.total === 1 ? "jar" : "jars"}
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
          {jars.data && jars.data.total > 100 && (
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
                disabled={page * 100 >= jars.data.total}
                onClick={() => update({ page: String(page + 1) })}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </section>
      {adding ? (
        <aside className="jar-detail-pane">
          <InlinePanel
            title="Jar"
            backLabel="Inventory"
            onClose={() => setAdding(false)}
          >
            <ContainerForm
              done={() => setAdding(false)}
              created={(jar) => navigate(`/containers/${jar.id}${search}`)}
            />
          </InlinePanel>
        </aside>
      ) : selectedId ? (
        <ContainerDetail
          key={selectedId}
          id={selectedId}
          onClose={closeDetail}
          outsideList={Boolean(
            jars.data && !jars.data.items.some((j) => j.id === selectedId),
          )}
        />
      ) : (
        <div className="jar-detail-pane empty-detail-pane" aria-hidden="true" />
      )}
    </SplitWorkspace>
  );
}
