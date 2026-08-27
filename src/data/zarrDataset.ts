import { DataFrame } from '@grafana/data';

import { detectFields, FieldRoleOverrides, resolveRoles } from './detectFields';

/**
 * A Zarr variable a query points at, in the shape the panel's tile layer needs.
 *
 * Like a WMS layer and unlike a table, this carries no rows: TiTiler renders the
 * pictures, so all that travels is where the store is, which array of it is
 * meant, and — when that array has a time axis — the moments it can be asked
 * about together with the exact spelling each one answers to.
 *
 * Unlike a WMS there *is* a server here, and its presence is the point. A WMS is
 * its own renderer; a Zarr store is a bag of compressed chunks, and something
 * has to turn them into tiles.
 */
export interface ZarrDataset {
  id: string;
  label: string;
  /** The TiTiler that will render it, from the panel option. */
  serverUrl: string;
  /** The store, as TiTiler will open it. */
  storeUrl: string;
  /** The one array of that store to draw. */
  variable: string;
  /** Every moment the query offered, oldest first, in epoch ms. */
  times: number[];
  /**
   * The store's own index label for each moment, keyed by epoch ms.
   *
   * Kept beside `times` rather than derived from it because the two are not the
   * same fact: `times` is what the map's clock filters on, the label is what
   * xarray's `.sel` matches. Deriving the second from the first works for a
   * store stamped at midnight and fails for one stamped at 09:00.
   */
  labels: Record<number, string>;
  /** `dimension=value` for every non-spatial axis except time. */
  selectors?: string[];
  /** Levels in the store's `multiscales` pyramid, or absent for a flat store. */
  levels?: number;
  /** The axis the clock walks, when the store does not call it `time`. */
  dimension?: string;
  colormap?: string;
  rescale?: string;
}

/** What the panel knows that the query does not. */
export interface ZarrOptions {
  serverUrl: string;
  colormap?: string;
  rescale?: string;
}

/**
 * A timestamp spelled the way numpy stamps a `datetime64[ns]`.
 *
 * The fallback for a query that offers moments but no labels, which is the
 * ordinary case: a dashboard selecting `dia::TIMESTAMPTZ AS time` has said
 * everything a store stamped on the hour needs. Nanoseconds are padded rather
 * than invented — Grafana's clock has milliseconds and nothing finer.
 */
export function defaultTimeLabel(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, -1)}000000`;
}

/** The dataset id for a query's Zarr variable. */
export function zarrDatasetId(refId: string): string {
  return `grafana-${refId}-zarr`;
}

/**
 * The id of the dataset holding a Zarr variable's calendar.
 *
 * Its own dataset for the same reason the WMS one is: kepler's time filter needs
 * a column of rows to attach to, and a tileset dataset has none.
 */
export function zarrCalendarDatasetId(zarrId: string): string {
  return `${zarrId}-times`;
}

/** Whether an id is one this panel minted for a query's Zarr variable. */
export function isPanelZarrId(id: string): boolean {
  return id.startsWith('grafana-') && (id.endsWith('-zarr') || id.endsWith('-zarr-times'));
}

/** The store's label for a moment, or undefined if it never offered that one. */
export function labelForTime(dataset: ZarrDataset, epochMs: number): string | undefined {
  return dataset.labels[epochMs];
}

/**
 * Turns the queries that name a Zarr store into layer descriptors.
 *
 * One descriptor per query, never one per row — the rule `framesToWms` follows,
 * and for the same reason: many rows describe one variable at many moments,
 * which is a timeline rather than a stack of layers.
 */
export function framesToZarr(
  frames: DataFrame[],
  overrides: Record<string, FieldRoleOverrides> = {},
  options: ZarrOptions
): ZarrDataset[] {
  const datasets: ZarrDataset[] = [];
  const serverUrl = options.serverUrl.trim();
  if (!serverUrl) {
    return datasets;
  }

  frames.forEach((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const roles = resolveRoles(detectFields(frame), overrides[refId]);
    if (!roles.zarrUrl || !roles.zarrVariable) {
      return;
    }

    const stores = frame.fields.find((f) => f.name === roles.zarrUrl);
    const variables = frame.fields.find((f) => f.name === roles.zarrVariable);
    if (!stores || !variables) {
      return;
    }

    const named = firstNamed(frame.length, stores.values, variables.values);
    if (!named) {
      return;
    }

    const dimension = firstText(frame, roles.zarrTimeDim);
    const { times, labels } = readCalendar(frame, roles.time, roles.zarrTimeLabel, dimension);

    datasets.push({
      id: zarrDatasetId(refId),
      label: frame.name ?? `Query ${refId}`,
      serverUrl,
      storeUrl: named.storeUrl,
      variable: named.variable,
      times,
      labels,
      dimension,
      selectors: readSelectors(frame, roles.zarrSel),
      levels: readLevels(frame, roles.zarrLevels),
      colormap: options.colormap,
      rescale: options.rescale,
    });
  });

  return datasets;
}

/** The first row that names both a store and a variable, or null if none does. */
function firstNamed(
  length: number,
  stores: unknown[],
  variables: unknown[]
): { storeUrl: string; variable: string } | null {
  for (let i = 0; i < length; i++) {
    const store = stores[i];
    const variable = variables[i];
    if (typeof store !== 'string' || typeof variable !== 'string') {
      continue;
    }
    const storeUrl = store.trim().replace(/\/+$/, '');
    const name = variable.trim();
    if (storeUrl && name) {
      return { storeUrl, variable: name };
    }
  }
  return null;
}

/**
 * The moments a frame offers and the label each one answers to.
 *
 * Sorted and deduplicated here rather than trusted from the query, for the same
 * reason `framesToWms` does it: a catalogue comes back in whatever order it was
 * written, and the window logic downstream is easier to reason about when it can
 * assume an ordering it did not have to ask for.
 */
function readCalendar(
  frame: DataFrame,
  timeColumn: string | undefined,
  labelColumn: string | undefined,
  dimension: string | undefined
): { times: number[]; labels: Record<number, string> } {
  const timeField = timeColumn ? frame.fields.find((f) => f.name === timeColumn) : undefined;
  if (!timeField) {
    return { times: [], labels: {} };
  }
  const labelField = labelColumn ? frame.fields.find((f) => f.name === labelColumn) : undefined;

  const labels: Record<number, string> = {};
  const seen = new Set<number>();
  for (let i = 0; i < frame.length; i++) {
    const at = Number(timeField.values[i]);
    if (!Number.isFinite(at)) {
      continue;
    }
    seen.add(at);

    const given = labelField?.values[i];
    if (typeof given === 'string' && given.trim()) {
      labels[at] = given.trim();
    } else if (!dimension || dimension === 'time') {
      // Only a `time` axis can be spelled from a timestamp. A store holding
      // months as 1..12 answers to `7`, never to a datetime, and guessing there
      // would send a label it cannot match — a 500 on every tile.
      labels[at] = defaultTimeLabel(at);
    }
  }

  return { times: [...seen].sort((a, b) => a - b), labels };
}

/**
 * The pyramid depth the query declared, or undefined for a flat store.
 *
 * A whole number above one or nothing: a "pyramid" of a single level is a flat
 * store described awkwardly, and treating it as a pyramid would pin every zoom
 * to group `0`.
 */
function readLevels(frame: DataFrame, column: string | undefined): number | undefined {
  const field = column ? frame.fields.find((f) => f.name === column) : undefined;
  if (!field) {
    return undefined;
  }
  for (let i = 0; i < frame.length; i++) {
    const levels = Number(field.values[i]);
    if (Number.isInteger(levels) && levels > 1) {
      return levels;
    }
  }
  return undefined;
}

/** The `dimension=value` pairs the query pinned, comma separated. */
function readSelectors(frame: DataFrame, column: string | undefined): string[] | undefined {
  const field = column ? frame.fields.find((f) => f.name === column) : undefined;
  if (!field) {
    return undefined;
  }
  for (let i = 0; i < frame.length; i++) {
    const raw = field.values[i];
    if (typeof raw === 'string' && raw.trim()) {
      return raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }
  }
  return undefined;
}

/** The first non-empty text a column holds, or undefined. */
function firstText(frame: DataFrame, column: string | undefined): string | undefined {
  const field = column ? frame.fields.find((f) => f.name === column) : undefined;
  if (!field) {
    return undefined;
  }
  for (let i = 0; i < frame.length; i++) {
    const raw = field.values[i];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }
  return undefined;
}
