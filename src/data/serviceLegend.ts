import type { EsriDataset } from './esriDataset';
import type { WmsDataset } from './wmsDataset';

/**
 * The legends of the services a map draws, as the map shows them over itself
 * (`ServiceLegends.tsx`).
 *
 * A WMS or an ArcGIS service hands out finished pictures, so the map has no
 * colour scale of its own to explain them: kepler's legend shows a WMS layer
 * as a name and nothing else. What the colours mean is the service's to say,
 * and services say it in one of two ways, which are the two kinds here:
 *
 * - **A picture.** A WMS publishes a `LegendURL` for each style of a layer,
 *   most often a GetLegendGraphic — swatches and labels already drawn. It is
 *   shown as an `<img>`, which needs no CORS: the browser shows a picture from
 *   anywhere, and nothing reads its pixels.
 * - **ArcGIS's legend JSON.** An Image Service or a Map Service answers
 *   `…/legend?f=json` (with `renderingRule=` for the raster function drawn)
 *   with each layer's swatches as base64 PNGs and their labels as text. The
 *   map draws those itself, so the labels take the dashboard's theme. That one
 *   is fetched, and so needs the service to allow it; one that does not shows
 *   nothing, and the map is drawn as before.
 *
 * Pure, so what is read from a column and from a reply can be tested without a
 * map or a network.
 */

/** A legend to show over the map: whose, where it is, and how to read it. */
export interface ServiceLegend {
  /** The dataset of the layer it explains: the legend shows while kepler's layer on it does. */
  dataId: string;
  /** The query's name for it, when kepler's layer has no label of its own. */
  label: string;
  url: string;
  kind: LegendKind;
  /**
   * For an ArcGIS legend of a Map Service drawn one layer at a time
   * (`…/MapServer/<id>`): that layer's id, the only one of the reply shown.
   */
  layerId?: number;
}

/** A picture to show as it is, or ArcGIS's legend JSON to draw. */
export type LegendKind = 'image' | 'arcgis';

/** One swatch and what it means. */
export interface LegendEntry {
  label: string;
  /** The swatch, as a `data:` url, or the http(s) address the service gave for it. */
  image: string;
}

/** The entries of one layer of an ArcGIS reply. */
export interface LegendGroup {
  /** The layer's name in the service: a title over its entries when the reply has several layers. */
  title: string;
  entries: LegendEntry[];
  /**
   * A stretch rather than classes: more entries than read as a list (an NDVI
   * colormap gives one per value, 256 of them), drawn as one bar of colour
   * with its first and last labels. `entries` is then the bar's swatches,
   * sampled, and `ends` the labels at either end.
   */
  ramp?: { ends: [string, string] };
}

/** Past this many entries a layer is a stretch, drawn as a bar (`LegendGroup.ramp`). */
export const MAX_LISTED_ENTRIES = 24;
/** The swatches a bar is drawn with, at most: one per two pixels of a 128-pixel bar. */
export const RAMP_SWATCHES = 64;

/**
 * The legends of a map's services, one per WMS layer or ArcGIS service whose
 * query gave a `legend_url`, in the order the queries came. A url the map would
 * not show — anything but http(s), a path on Grafana's own host or a `data:`
 * picture — gives none.
 */
export function serviceLegends(wms: readonly WmsDataset[], esri: readonly EsriDataset[]): ServiceLegend[] {
  const legends: ServiceLegend[] = [];
  for (const layer of wms) {
    const legend = legendOf(layer.id, layer.label, layer.legendUrl);
    if (legend) {
      legends.push(legend);
    }
  }
  for (const service of esri) {
    const legend = legendOf(service.id, service.label, service.legendUrl);
    if (legend) {
      const layerId = /\/MapServer\/(\d+)\/?$/i.exec(service.serviceUrl)?.[1];
      legends.push(legend.kind === 'arcgis' && layerId ? { ...legend, layerId: Number(layerId) } : legend);
    }
  }
  return legends;
}

function legendOf(dataId: string, label: string, url: string | undefined): ServiceLegend | null {
  const address = url?.trim() ?? '';
  const kind = legendKindOf(address);
  if (!kind) {
    return null;
  }
  return { dataId, label, url: kind === 'arcgis' ? asJsonLegend(address) : address, kind };
}

/**
 * How a legend url is read, or null when the map would not show it.
 *
 * ArcGIS's legend is the REST endpoint `…/ImageServer/legend` or
 * `…/MapServer/legend`; anything else is a picture. A `javascript:` url, or any
 * scheme but http(s), is no picture, and neither is a `data:` url that is not an
 * image.
 */
export function legendKindOf(url: string): LegendKind | null {
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(url)) {
    return 'image';
  }
  if (!/^(https?:\/\/[^/]|\/[^/]|\/$)/i.test(url)) {
    return null;
  }
  const path = url.split(/[?#]/)[0];
  return /\/(ImageServer|MapServer)\/legend\/?$/i.test(path) ? 'arcgis' : 'image';
}

/**
 * An ArcGIS legend url that answers JSON: `f=json` added when the url asks
 * for no format, and any other format (`f=html`, the endpoint's default when
 * none is given) replaced, since only JSON can be drawn.
 */
function asJsonLegend(url: string): string {
  const [base, fragment] = url.split('#');
  const [path, query = ''] = base.split('?');
  const params = query.split('&').filter((part) => part && !/^f=/i.test(part));
  return `${path}?${[...params, 'f=json'].join('&')}${fragment !== undefined ? `#${fragment}` : ''}`;
}

/**
 * The groups of swatches in an ArcGIS legend reply, or none.
 *
 * `{ layers: [{ layerId, layerName, legend: [{ label, imageData, contentType, url }] }] }`,
 * as an Image Service and a Map Service both answer. A swatch is its
 * `imageData` (base64) as a `data:` url, or, without one, an absolute `url`;
 * one with neither is left out, and so is a layer left with none. An error
 * reply (`{ error: … }`), or anything else, is none: the map is drawn without
 * a legend.
 *
 * A layer whose one entry has no label (a Map Service's single-symbol layer)
 * takes the layer's name as its label.
 */
export function parseArcgisLegend(reply: unknown, layerId?: number): LegendGroup[] {
  const layers = (reply as { layers?: unknown } | null)?.layers;
  if (!Array.isArray(layers)) {
    return [];
  }
  const groups: LegendGroup[] = [];
  for (const layer of layers as Array<Record<string, unknown>>) {
    if (!layer || typeof layer !== 'object' || (layerId !== undefined && layer.layerId !== layerId)) {
      continue;
    }
    const title = typeof layer.layerName === 'string' ? layer.layerName.trim() : '';
    const entries = (Array.isArray(layer.legend) ? (layer.legend as unknown[]) : [])
      .map(entryOf)
      .filter((entry): entry is LegendEntry => entry !== null);
    if (entries.length === 0) {
      continue;
    }
    if (entries.length === 1 && !entries[0].label) {
      entries[0] = { ...entries[0], label: title };
    }
    groups.push(entries.length > MAX_LISTED_ENTRIES ? rampOf(title, entries) : { title, entries });
  }
  return groups;
}

function entryOf(value: unknown): LegendEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const { label, imageData, contentType, url } = value as Record<string, unknown>;
  const text = typeof label === 'string' ? label.trim() : typeof label === 'number' ? String(label) : '';
  if (typeof imageData === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(imageData) && imageData.trim()) {
    const type =
      typeof contentType === 'string' && /^image\/[a-z0-9.+-]+$/i.test(contentType) ? contentType : 'image/png';
    return { label: text, image: `data:${type};base64,${imageData.replace(/\s+/g, '')}` };
  }
  if (typeof url === 'string' && /^https?:\/\/[^/]/i.test(url)) {
    return { label: text, image: url };
  }
  return null;
}

/** A stretch as a bar: its swatches sampled evenly, first and last kept, and its two end labels. */
function rampOf(title: string, entries: LegendEntry[]): LegendGroup {
  const count = Math.min(RAMP_SWATCHES, entries.length);
  const sampled = Array.from(
    { length: count },
    (_, i) => entries[Math.round((i * (entries.length - 1)) / (count - 1))]
  );
  return { title, entries: sampled, ramp: { ends: [entries[0].label, entries[entries.length - 1].label] } };
}

/** Each ArcGIS legend, fetched once per page and shared by every panel that shows it. */
const replies = new Map<string, Promise<unknown>>();

/**
 * An ArcGIS legend's reply, fetched at most once per page.
 *
 * Without credentials: a public service's legend needs none, and a service
 * that answers CORS with `*` refuses a request that carries them. A failure
 * — the service refuses CORS, answers an error, or is down — is null, and is
 * not remembered, so a later showing of the legend asks again.
 */
export function fetchArcgisLegend(url: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const cached = replies.get(url);
  if (cached) {
    return cached;
  }
  const pending = fetchImpl(url, { credentials: 'omit' })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
    .then((reply) => {
      if (reply === null) {
        replies.delete(url);
      }
      return reply;
    });
  replies.set(url, pending);
  return pending;
}

/** A legend as the map shows it: titled with kepler's name for its layer. */
export interface ShownLegend extends ServiceLegend {
  title: string;
}

/**
 * The legends to show: those whose layer kepler draws, in the order the
 * legends came, each titled with the layer's label (which the user may have
 * renamed in the layer panel), or the query's name when it has none. A legend
 * whose layer is hidden, or not built yet, is not shown.
 */
export function shownLegends(
  legends: readonly ServiceLegend[],
  layers: ReadonlyArray<{ dataId: string; label: string; visible: boolean }>
): ShownLegend[] {
  const byId = new Map(layers.map((layer) => [layer.dataId, layer]));
  return legends.flatMap((legend) => {
    const layer = byId.get(legend.dataId);
    return layer?.visible ? [{ ...legend, title: layer.label || legend.label }] : [];
  });
}
