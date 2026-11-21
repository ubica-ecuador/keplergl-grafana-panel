import type { DataFrame } from '@grafana/data';

/** A layer's extent in degrees, `[west, south, east, north]`; west may be east of east across the antimeridian. */
export type LayerBox = [number, number, number, number];

/**
 * What a frame says about the layer it draws, in `meta.custom.layer`:
 * `{ key, bbox? }`.
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
