import { useEffect, useState } from "react";

type SortPreference = { sort: string; descending: boolean };

export function useListSort(
  section: "inventory" | "glazes" | "vessels",
  params: URLSearchParams,
  columns: readonly string[],
  defaultSort: string,
) {
  const storageKey = `glaze-manager.${section}-sort`;
  const [saved, setSaved] = useState<SortPreference>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (
        columns.includes(stored?.sort) &&
        typeof stored?.descending === "boolean"
      )
        return { sort: stored.sort, descending: stored.descending };
    } catch {
      // Invalid or unavailable browser storage falls back to the default.
    }
    return { sort: defaultSort, descending: false };
  });
  // Explicit links specify a complete order; an omitted direction is ascending.
  const explicit = params.has("sort") || params.has("descending");
  const requested = params.get("sort") || "";
  const sort = explicit
    ? columns.includes(requested)
      ? requested
      : defaultSort
    : saved.sort;
  const descending = explicit
    ? params.get("descending") === "true"
    : saved.descending;

  useEffect(() => {
    const preference = { sort, descending };
    setSaved(preference);
    try {
      localStorage.setItem(storageKey, JSON.stringify(preference));
    } catch {
      // Sorting still works for this screen when browser storage is blocked.
    }
  }, [storageKey, sort, descending]);

  return { sort, descending };
}
