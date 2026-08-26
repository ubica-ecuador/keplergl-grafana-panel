import { DataFrame } from '@grafana/data';

import { detectFields, FieldRoleOverrides, resolveRoles } from './detectFields';

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
  id: string;
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
}

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
  return url.trim().split('#')[0].split('?')[0].replace(/\/+$/, '');
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
    if (!roles.wmsUrl || !roles.wmsLayer) {
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

    datasets.push({
      id: wmsDatasetId(refId),
      label: frame.name ?? `Query ${refId}`,
      serviceUrl: named.serviceUrl,
      layerName: named.layerName,
      times: readTimes(frame, roles.time),
    });
  });

  return datasets;
}

/** The first row that names both a service and a layer, or null if none does. */
function firstNamed(
  length: number,
  urls: unknown[],
  layers: unknown[]
): { serviceUrl: string; layerName: string } | null {
  for (let i = 0; i < length; i++) {
    const url = urls[i];
    const layer = layers[i];
    if (typeof url !== 'string' || typeof layer !== 'string') {
      continue;
    }
    const serviceUrl = serviceUrlOf(url);
    const layerName = layer.trim();
    if (serviceUrl && layerName) {
      return { serviceUrl, layerName };
    }
  }
  return null;
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
