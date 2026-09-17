import { IconLayer } from '@deck.gl/layers';

import { createAtlasCanvas, IconFrame } from './vectorFieldGlyphs';
import { glyphsFor, paintGlyphs, SymbolPainter } from './symbolGlyphs';

/**
 * The deck.gl layer that draws a symbol per row.
 *
 * The atlas is handed to deck as a canvas, never as a URL: given a URL,
 * `IconLayer` fetches it, and Grafana's strict CSP has no `data:` in
 * `connect-src` — so a data URL atlas draws nothing and says why nowhere.
 *
 * Painted for the symbols in use rather than for the catalogue, and repainted
 * when that set changes. The catalogue is nearly four hundred glyphs; a layer
 * uses one.
 */

interface Atlas {
  canvas: HTMLCanvasElement;
  mapping: Record<string, IconFrame>;
}

/**
 * Painted atlases, by the glyphs they hold.
 *
 * One per set rather than one slot for the page: the module is shared by every
 * panel, and a single slot meant two layers drawing different shapes repainted
 * the canvas on every render, each time handing deck a new texture to upload
 * and every row's icon to recompute. Bounded, least recently used first out,
 * because a user flicking through the shape picker leaves a set behind per
 * shape — and one glyph's atlas is small, but not free.
 */
const atlases = new Map<string, Atlas>();
const MAX_ATLASES = 16;

function atlasFor(names: string[]): Atlas | null {
  const glyphs = glyphsFor(names);
  const key = glyphs.map((glyph) => glyph.key).join(',');
  const cached = atlases.get(key);
  if (cached) {
    // Re-inserted, so the order of the map is the order of use.
    atlases.delete(key);
    atlases.set(key, cached);
    return cached;
  }

  const created = createAtlasCanvas(glyphs.length);
  if (!created) {
    // Nothing cached on this path: the next call tries again rather than
    // remembering a failure as if it were a built atlas.
    return null;
  }

  const atlas = { canvas: created.canvas, mapping: paintGlyphs(glyphs, created.ctx as unknown as SymbolPainter) };
  atlases.set(key, atlas);
  if (atlases.size > MAX_ATLASES) {
    atlases.delete(atlases.keys().next().value as string);
  }
  return atlas;
}

/** Builds the icon layer, or null when the atlas could not be painted. */
export const buildSymbolDeckLayer = (props: { symbols?: string[] } & Record<string, unknown>): unknown => {
  const { symbols, ...rest } = props;
  const built = atlasFor(symbols ?? []);
  if (!built) {
    return null;
  }
  return new IconLayer({
    iconAtlas: built.canvas,
    iconMapping: built.mapping,
    getPosition: (row: { position: [number, number, number] }) => row.position,
    // Pixels, so a symbol reads the same at every zoom.
    sizeUnits: 'pixels',
    // Lying on the map rather than facing the camera, so a symbol turns with
    // the map's bearing: its angle is a compass bearing on the ground.
    billboard: false,
    ...rest,
  } as never);
};
