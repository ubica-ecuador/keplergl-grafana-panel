import { IconLayer } from '@deck.gl/layers';

import { atlasSize, IconFrame } from './vectorFieldGlyphs';
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

let atlas: { key: string; canvas: HTMLCanvasElement; mapping: Record<string, IconFrame> } | null = null;

function atlasFor(names: string[]): { canvas: HTMLCanvasElement; mapping: Record<string, IconFrame> } | null {
  const glyphs = glyphsFor(names);
  const key = glyphs.map((glyph) => glyph.key).join(',');
  if (atlas?.key === key) {
    return atlas;
  }

  const { width, height } = atlasSize(glyphs.length);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Nothing cached on this path: the next call tries again rather than
    // remembering a failure as if it were a built atlas.
    return null;
  }

  atlas = { key, canvas, mapping: paintGlyphs(glyphs, ctx as unknown as SymbolPainter) };
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
