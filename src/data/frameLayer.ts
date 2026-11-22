import type { DataFrame } from '@grafana/data';

/** A layer's extent in degrees, `[west, south, east, north]`; west may be east of east across the antimeridian. */
export type LayerBox = [number, number, number, number];

/**
 * What a frame says about the layer it draws, in `meta.custom.layer`:
 * `{ key, bbox?, title?, attribution?, minZoom?, maxZoom? }`. This is the
 * layer's place on the map; its name, whom it credits and its tiles' zoom
 * levels are read on their own (`frameTitleOf`, `frameCreditsOf`,
 * `frameZoomsOf`).
 *
 * `key` names the layer, and is the same on every refresh of it: a Spatial
 * Catalog sends its data source, the query's kind and the entries it reads. A
 * query that answers with another key has been pointed at another layer — in
 * its editor, or by a variable — even when the new layer's columns are the old
 * one's. `bbox` is where that layer is, when its source knows, which may be
 * before or without any row of it.
 *
 * Any data source may send it; a frame without it is framed as before.
 */
export interface FrameLayer {
  key: string;
  bbox: LayerBox | null;
}

/**
 * Whom a frame's layer credits, as `meta.custom.layer.attribution` says: a
 * title, `{ title, url? }`, or a list of either. A map shows them beside its
 * base map's credits, in kepler's attribution (`attributionStrings`).
 */
export interface LayerCredit {
  title: string;
  url?: string;
}

/** The longest layer name kept, in characters: a line of kepler's layer list. */
const LONGEST_TITLE = 80;

/** Credits kept for one layer: a footer, not a bibliography. */
const MOST_CREDITS = 4;
/** The longest credit shown, in characters. */
const LONGEST = 160;

const layerObjectOf = (frame: DataFrame): Record<string, unknown> | null => {
  const layer = (frame.meta?.custom as { layer?: unknown } | undefined)?.layer;
  return layer && typeof layer === 'object' && !Array.isArray(layer) ? (layer as Record<string, unknown>) : null;
};

/** An http(s) address as the browser writes it, or undefined: a credit links to a web page or to nothing. */
function webUrlOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) {
    return undefined;
  }
  try {
    return new URL(value.trim()).href;
  } catch {
    return undefined;
  }
}

/** A credit's title as plain text: one line, no markup, no quotes, cut to a footer's length. */
function creditTitleOf(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const flat = value.replace(/[<>"]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > LONGEST ? `${flat.slice(0, LONGEST - 1).trimEnd()}…` : flat;
}

/**
 * What a frame calls its layer (`meta.custom.layer.title`): a Spatial Catalog
 * sends the title of the entry it reads, where the frame's own name says what
 * kind of rows it holds (`rasters`, `features`, `services`). Plain text on one
 * line, at most 80 characters; undefined when it names none. Read whether or
 * not the frame names its layer's `key`.
 */
export function frameTitleOf(frame: DataFrame): string | undefined {
  const given = layerObjectOf(frame)?.title;
  if (typeof given !== 'string') {
    return undefined;
  }
  const flat = given.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!flat) {
    return undefined;
  }
  return flat.length > LONGEST_TITLE ? `${flat.slice(0, LONGEST_TITLE - 1).trimEnd()}…` : flat;
}

/** The name a query's frame gives what the panel draws of it: its layer's title, else its own name, else its query. */
export function frameLabelOf(frame: DataFrame, refId: string): string {
  return frameTitleOf(frame) ?? untitledLabelOf(frame, refId);
}

/** The name the panel gives a query's frame that names no title: the frame's own name, else its query's. */
export function untitledLabelOf(frame: DataFrame, refId: string): string {
  return frame.name ?? `Query ${refId}`;
}

/**
 * The credits a frame's layer names (`meta.custom.layer.attribution`), once
 * each, at most four; none when it names none. Read whether or not the frame
 * names its layer's `key`: a data source may credit what it sends and say no
 * more.
 */
export function frameCreditsOf(frame: DataFrame): LayerCredit[] {
  const given = layerObjectOf(frame)?.attribution;
  const items = Array.isArray(given) ? given : given === undefined || given === null ? [] : [given];
  const credits: LayerCredit[] = [];
  for (const item of items) {
    const title = creditTitleOf(typeof item === 'string' ? item : (item as { title?: unknown } | null)?.title);
    const url = typeof item === 'object' && item ? webUrlOf((item as { url?: unknown }).url) : undefined;
    if (title && !credits.some((c) => c.title.toLowerCase() === title.toLowerCase())) {
      credits.push({ title, ...(url ? { url } : {}) });
    }
  }
  return credits.slice(0, MOST_CREDITS);
}

/**
 * Credits as kepler's dataset attributions (`metadata.attributions`, which its
 * `datasetAttributionSelector` reads): a link written by the panel itself, of
 * a title with no quotes or markup (`creditTitleOf`) and an http(s) address
 * the browser wrote out (`webUrlOf`), or the title alone. kepler pulls the
 * `href` out of a link's text and puts it on an anchor as it is, so nothing a
 * data source sends reaches it but through these two.
 */
export function attributionStrings(credits: readonly LayerCredit[]): string[] {
  return credits.map(({ title, url }) =>
    url && !url.includes('"') ? `<a href="${url}" title="${title}">${title}</a>` : title
  );
}

/** A frame's credits as kepler's dataset metadata, to spread into a proto dataset's; empty without any. */
export function attributionsOf(frame: DataFrame): { attributions?: string[] } {
  const strings = attributionStrings(frameCreditsOf(frame));
  return strings.length ? { attributions: strings } : {};
}

const zoomOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 30 ? value : undefined;

/**
 * The zoom levels a frame's layer has tiles for (`meta.custom.layer.minZoom`,
 * `maxZoom`), when it says: what a `tiles_min_zoom` and `tiles_max_zoom`
 * column say row by row, said once for the layer. A maximum under the minimum
 * is dropped.
 */
export function frameZoomsOf(frame: DataFrame): { minZoom?: number; maxZoom?: number } {
  const layer = layerObjectOf(frame);
  const minZoom = zoomOf(layer?.minZoom);
  const maxZoom = zoomOf(layer?.maxZoom);
  return {
    ...(minZoom !== undefined ? { minZoom } : {}),
    ...(maxZoom !== undefined && (minZoom === undefined || maxZoom >= minZoom) ? { maxZoom } : {}),
  };
}

/** The layer a frame names in `meta.custom.layer`, or null when it names none. */
export function frameLayerOf(frame: DataFrame): FrameLayer | null {
  const layer = (frame.meta?.custom as { layer?: unknown } | undefined)?.layer;
  if (!layer || typeof layer !== 'object') {
    return null;
  }
  const { key, bbox } = layer as { key?: unknown; bbox?: unknown };
  if (typeof key !== 'string' || !key) {
    return null;
  }
  return { key, bbox: layerBoxOf(bbox) };
}

/**
 * A layer's box from `meta.custom.layer.bbox`, or null.
 *
 * Four finite numbers in degrees, south no further north than north. A box a
 * hair outside the world is pulled back to its edge; a box of no width or no
 * height — a single point, a line — is kept, and framed at a zoom of its own
 * (`layerFraming.ts`). A west greater than east crosses the antimeridian.
 */
export function layerBoxOf(value: unknown): LayerBox | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }
  if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  const SLACK = 1e-6;
  const [west, south, east, north] = value as number[];
  const inRange = (n: number, limit: number) => Math.abs(n) <= limit + SLACK;
  if (!inRange(west, 180) || !inRange(east, 180) || !inRange(south, 90) || !inRange(north, 90) || south > north) {
    return null;
  }
  const clamp = (n: number, limit: number) => Math.max(-limit, Math.min(limit, n));
  return [clamp(west, 180), clamp(south, 90), clamp(east, 180), clamp(north, 90)];
}
