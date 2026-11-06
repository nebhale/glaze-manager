import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { components } from "./generated/api";

export type Jar = components["schemas"]["ContainerOut"];
export type Glaze = components["schemas"]["GlazeOut"];
export type GlazeRecord = components["schemas"]["GlazeDetailOut"];
export type GlazeReference = components["schemas"]["GlazeReference"];
export type Vessel = components["schemas"]["VesselOut"];
export type VesselSummary = components["schemas"]["VesselSummary"];
export type Application = components["schemas"]["ApplicationOut"];
export type Manufacturer = components["schemas"]["ManufacturerOut"];
export type Preset = components["schemas"]["PresetOut"];
export type Measurement = components["schemas"]["MeasurementOut"];
export type Photo =
  components["schemas"]["PhotoOut"] | components["schemas"]["VesselPhotoOut"];
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({
        detail: "Unable to contact the studio. Please try again.",
      }));
    const message = Array.isArray(error.detail)
      ? error.detail
          .map(
            (e: { msg: string; loc: string[] }) =>
              `${e.loc.slice(1).join(" ")}: ${e.msg}`,
          )
          .join("; ")
      : error.detail;
    throw new ApiError(
      response.status,
      message || "Something went wrong. Please try again.",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function useApi<T>(path: string) {
  return useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path) });
}

export function useLiveUpdates(onStatus: (connected: boolean) => void) {
  const client = useQueryClient();
  useEffect(() => {
    const events = new EventSource("/api/v1/events");
    events.onmessage = () => {
      onStatus(true);
      void client.invalidateQueries();
    };
    events.onerror = () => onStatus(false);
    return () => events.close();
  }, [client, onStatus]);
}

export const grams = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n)} g`;
export const percent = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n)}%`;
export const date = (n: string | null | undefined) =>
  n
    ? new Date(n).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not weighed yet";
export const shortDate = (n: string | null | undefined) =>
  n
    ? new Date(n).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "Not weighed";
export function formValues(form: HTMLFormElement) {
  return Object.fromEntries(
    Array.from(new FormData(form).entries()).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() || null : value,
    ]),
  ) as Record<string, string | null>;
}
export function weights(
  values: Record<string, unknown>,
  keys = ["tare_g", "full_weight_g"],
) {
  for (const key of keys)
    if (key in values)
      values[key] =
        values[key] === null || values[key] === "" ? null : Number(values[key]);
  return values;
}
