import { DataFrame } from '@grafana/data';

import { detectFields, FieldRoleOverrides, resolveRoles } from './detectFields';
import { anotherServiceWins } from './serviceKind';
import { attributionsOf } from './frameLayer';

/**
 * A WMS layer a query points at, in the shape kepler's WMS tileset needs.
 *
 * Like a raster scene and unlike everything else the panel draws, this carries
 * no data: a WMS renders its own pictures, so all that travels is where the
 * service is, which of its layers is meant, and — if the query said so — the
 * moments it can be asked about.
 *
 * There is no tile server here, and its absence is the point. A COG needs one
 * because a GeoTIFF is not tiles; a WMS *is* the server.
 */
export interface WmsDataset {
  /** Whom to credit for it (`meta.custom.layer.attribution`), as kepler's dataset attributions (`frameLayer.ts`). */
  attributions?: string[];
  id: string;
  /**
   * The name the dataset, and kepler's layer on it until the user renames it,
   * go by: the row's own name for the layer when it has one (its `title`
   * column, as the Spatial Catalog's Services frame gives each service), else
   * the query's. A catalog query lists many services under one query name
   * ("services"), so that name alone told none of them apart, in the layer
   * panel or in the map's legend.
   */
  label: string;
  /** The service endpoint, bare: no query, no fragment — see {@link serviceUrlOf}. */
  serviceUrl: string;
  /** The one layer of that service to draw. */
  layerName: string;
  /**
   * Every moment the query offered, oldest first, in epoch ms.
   *
   * Empty when the query carries no time column, which is the ordinary case of
   * a fixed layer. It is not the only source of a timeline — the service
   * publishes its own dates in GetCapabilities — but it is the one that wins,
   * because a query that says which dates matter has said something the
   * service cannot know.
   */
  times: number[];
  /**
   * Where the layer has data, as the query says: `[west, south, east, north]`
   * in degrees, or null when the query says nothing usable.
   *
   * Read from the same row as the service and the layer (`tiles_bbox`), and it
   * does two jobs on the map: the view is framed on it when the layer arrives
   * somewhere it cannot be seen (`wmsExtent.ts`), and the picture is drawn only
   * inside it, because many services answer an opaque white image wherever they
   * have nothing — IGN's Cassini map covers the whole world in white outside
   * France. `west` greater than `east` is a box across the antimeridian.
   */
  bbox: WmsBox | null;
  /**
   * The style to draw the layer with, one of those the service publishes for it
   * (`wms_style`); absent for the service's default.
   *
   * Not part of what makes the layer this layer: a query that moves from one
   * style to another — a variable picking among the styles the catalogue
   * lists — draws the same layer in another way, and is followed by a new
   * picture, not a new layer (`applyWmsStyle`). The view stays where it is and
   * the layer keeps what the user set on it.
   */
  style?: string;
  /** Where its legend is (`legend_url`), drawn over the map. See `serviceLegend.ts`. */
  legendUrl?: string;
}

/** A layer's box in degrees: `[west, south, east, north]`; `west > east` crosses the antimeridian. */
export type WmsBox = [number, number, number, number];

/**
 * The endpoint, as loaders.gl needs it: no query string and no fragment.
 *
 * Stripping the query is a real decision and not tidiness. `_getWMSUrl` builds
 * every request by appending `?` and its parameters to this string without
 * checking whether one is already there, so anything after a `?` survives only
 * as a corrupted first parameter — GeoServer answers a GetMap built that way
 * with `ParseException: Invalid date: …?SERVICE=WMS`. Since pasting a whole
 * GetMap url is the most natural thing for someone to put in the column, the
 * choice is between reading it charitably and drawing nothing.
 *
 * The cost is a service that genuinely needs parameters on its endpoint — a
 * MapServer `?map=/path.map`. Those cannot be driven through loaders.gl at all,
 * whatever this function does.
 */
export function serviceUrlOf(url: string): string {
  // A trailing slash stays: a service may answer only with it (NASA GIBS's `…/best/`, as its capabilities say).
  return url.trim().split('#')[0].split('?')[0];
}

/**
 * The dataset id for a query's WMS layer.
 *
 * Suffixed for the same reason the raster's is: the rows are also a table worth
 * keeping — service, layer, dates — and both can sit on the same map. The
 * `grafana-` prefix marks it as rebuilt-from-a-query, which is how the save
 * path knows to leave it out of the dashboard JSON.
 */
export function wmsDatasetId(refId: string): string {
  return `grafana-${refId}-wms`;
}

/**
 * The id of the dataset holding a WMS layer's calendar.
 *
 * Its own dataset rather than a field on the WMS one, because kepler's time
 * filter needs a column of rows to attach to and a WMS dataset has neither.
 */
export function wmsCalendarDatasetId(wmsId: string): string {
  return `${wmsId}-times`;
}

/** Whether an id is one this panel minted for a query's WMS layer. */
export function isPanelWmsId(id: string): boolean {
  return id.startsWith('grafana-') && (id.endsWith('-wms') || id.endsWith('-wms-times'));
}

/**
 * Turns the queries that name a WMS into layer descriptors.
 *
 * Sibling to `framesToDatasets` for the same reason as `framesToRasters`: this
 * dataset has no rows, and the row path drops exactly that.
 *
 * One descriptor per query, never one per row. A query with many rows is
 * describing one layer at many moments — that is a timeline, not a stack of
 * layers — so the service and layer come from the first row that has them and
 * the dates come from all of them.
 */
export function framesToWms(frames: DataFrame[], overrides: Record<string, FieldRoleOverrides> = {}): WmsDataset[] {
  const datasets: WmsDataset[] = [];

  frames.forEach((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const roles = resolveRoles(detectFields(frame), overrides[refId]);
    // A query whose first service is another kind draws that one (`serviceKindOf`).
    if (!roles.wmsUrl || !roles.wmsLayer || anotherServiceWins(frame, roles, 'wms')) {
      return;
    }

    const urls = frame.fields.find((f) => f.name === roles.wmsUrl);
    const layers = frame.fields.find((f) => f.name === roles.wmsLayer);
    if (!urls || !layers) {
      return;
    }

    const named = firstNamed(frame.length, urls.values, layers.values);
    if (!named) {
      return;
    }
    const boxes = roles.tilesBbox ? frame.fields.find((f) => f.name === roles.tilesBbox) : undefined;
    // On the row that names the service and the layer, as the box is: a style
    // is a style of that layer.
    const textOnRow = (column: string | undefined) => {
      const value = column ? frame.fields.find((f) => f.name === column)?.values[named.row] : undefined;
      return typeof value === 'string' ? value.trim() : '';
    };
    const style = textOnRow(roles.wmsStyle);
    const legendUrl = textOnRow(roles.legendUrl);
    const title = textOnRow('title');

    datasets.push({
      id: wmsDatasetId(refId),
      label: title || (frame.name ?? `Query ${refId}`),
      serviceUrl: named.serviceUrl,
      layerName: named.layerName,
      times: readTimes(frame, roles.time),
      bbox: boxes ? parseWmsBox(boxes.values[named.row]) : null,
      ...(style ? { style } : {}),
      ...(legendUrl ? { legendUrl } : {}),
      ...attributionsOf(frame),
    });
  });

  return datasets;
}

/** The first row that names both a service and a layer, or null if none does. */
function firstNamed(
  length: number,
  urls: unknown[],
  layers: unknown[]
): { serviceUrl: string; layerName: string; row: number } | null {
  for (let i = 0; i < length; i++) {
    const url = urls[i];
    const layer = layers[i];
    if (typeof url !== 'string' || typeof layer !== 'string') {
      continue;
    }
    const serviceUrl = serviceUrlOf(url);
    const layerName = layer.trim();
    if (serviceUrl && layerName) {
      return { serviceUrl, layerName, row: i };
    }
  }
  return null;
}

/**
 * A layer's box from what a query put in its `tiles_bbox` column, or null.
 *
 * The spelling the Spatial Catalog writes is text, `"west south east north"`
 * with spaces between — `"-5.5 41 10 51.5"` for France — and spaces on
 * purpose: kepler's type analyzer reads `[w,s,e,n]` or `w,s,e,n` as a pair of
 * points and would draw the column as one. Commas, a JSON array and a list
 * value are read too, since a hand-written query will reach for them.
 *
 * Degrees or nothing. Anything else — three numbers, a south north of its
 * north, a projected box in metres that no longitude reaches — is not a box
 * the map can use, and guessing would frame the view somewhere wrong or clip
 * the picture away entirely; the layer then draws as it did before, unframed
 * and unclipped. A box a hair outside the world (a server's -180.0000001) is
 * pulled back to its edge.
 */
export function parseWmsBox(value: unknown): WmsBox | null {
  let parts: unknown[];
  if (typeof value === 'string') {
    const text = value.trim().replace(/^\[|\]$/g, '');
    parts = text ? text.split(/[\s,;]+/) : [];
  } else if (Array.isArray(value)) {
    parts = value;
  } else if (value && typeof (value as { toArray?: unknown }).toArray === 'function') {
    parts = (value as { toArray(): unknown[] }).toArray();
  } else {
    return null;
  }
  if (parts.length !== 4) {
    return null;
  }
  const numbers = parts.map((part) =>
    typeof part === 'number' ? part : typeof part === 'string' ? Number(part) : NaN
  );
  if (!numbers.every(Number.isFinite)) {
    return null;
  }
  const SLACK = 1e-6;
  const [west, south, east, north] = numbers;
  const inRange = (n: number, limit: number) => Math.abs(n) <= limit + SLACK;
  if (!inRange(west, 180) || !inRange(east, 180) || !inRange(south, 90) || !inRange(north, 90)) {
    return null;
  }
  const clamp = (n: number, limit: number) => Math.max(-limit, Math.min(limit, n));
  const box: WmsBox = [clamp(west, 180), clamp(south, 90), clamp(east, 180), clamp(north, 90)];
  // No height, or no width: a point or a line is not where a layer has data.
  if (box[1] >= box[3] || box[0] === box[2]) {
    return null;
  }
  return box;
}

/**
 * The moments a frame offers, oldest first and each one once.
 *
 * Sorted and deduplicated here rather than trusted from the query: a catalogue
 * read from a service comes back in whatever order it was written, and the
 * window logic downstream is easier to reason about — and to test — when it can
 * assume an ordering it did not have to ask for.
 */
function readTimes(frame: DataFrame, timeColumn?: string): number[] {
  const field = timeColumn ? frame.fields.find((f) => f.name === timeColumn) : undefined;
  if (!field) {
    return [];
  }

  const seen = new Set<number>();
  for (let i = 0; i < frame.length; i++) {
    const raw = Number(field.values[i]);
    if (Number.isFinite(raw)) {
      seen.add(raw);
    }
  }
  return [...seen].sort((a, b) => a - b);
}
