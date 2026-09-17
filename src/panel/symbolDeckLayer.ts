import { IconLayer } from '@deck.gl/layers';

import { ATLAS_COLUMNS, CELL, createAtlasCanvas, IconFrame } from './vectorFieldGlyphs';
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

/** The shadow's blur, as a canvas filter radius in atlas pixels. */
export const SHADOW_BLUR = 5;

/** Room on every side of a shadow's glyph for the blur to spread into, not be cut off. */
export const SHADOW_PAD = 16;

/** The side of a shadow's cell: a glyph's, and the padding round it. */
export const SHADOW_CELL = CELL + 2 * SHADOW_PAD;

/** Cached by key, least recently used first out; built by `build` on a miss. */
function cached(key: string, build: () => Atlas | null): Atlas | null {
  const hit = atlases.get(key);
  if (hit) {
    // Re-inserted, so the order of the map is the order of use.
    atlases.delete(key);
    atlases.set(key, hit);
    return hit;
  }

  const atlas = build();
  if (!atlas) {
    // Nothing cached on this path: the next call tries again rather than
    // remembering a failure as if it were a built atlas.
    return null;
  }
  atlases.set(key, atlas);
  if (atlases.size > MAX_ATLASES) {
    atlases.delete(atlases.keys().next().value as string);
  }
  return atlas;
}

function atlasFor(names: string[]): Atlas | null {
  const glyphs = glyphsFor(names);
  return cached(glyphs.map((glyph) => glyph.key).join(','), () => {
    const created = createAtlasCanvas(glyphs.length);
    return created
      ? { canvas: created.canvas, mapping: paintGlyphs(glyphs, created.ctx as unknown as SymbolPainter) }
      : null;
  });
}

/**
 * The shadow's atlas: each glyph of the symbols' own, blurred, in a cell grown
 * by the padding and anchored at the same point of the glyph.
 *
 * Copied from the sharp atlas rather than painted again, so a shadow is always
 * the silhouette of exactly what is drawn above it. A browser whose canvas
 * ignores `filter` draws a sharp shadow, which is still a shadow.
 */
function shadowAtlasFor(names: string[]): Atlas | null {
  const sharp = atlasFor(names);
  if (!sharp) {
    return null;
  }
  const frames = Object.entries(sharp.mapping);
  return cached(`shadow:${frames.map(([name]) => name).join(',')}`, () => {
    const created = createAtlasCanvas(frames.length, SHADOW_CELL);
    if (!created) {
      return null;
    }
    const mapping: Record<string, IconFrame> = {};
    created.ctx.filter = `blur(${SHADOW_BLUR}px)`;
    frames.forEach(([name, frame], index) => {
      const x = (index % ATLAS_COLUMNS) * SHADOW_CELL;
      const y = Math.floor(index / ATLAS_COLUMNS) * SHADOW_CELL;
      created.ctx.drawImage(
        sharp.canvas,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        x + SHADOW_PAD,
        y + SHADOW_PAD,
        frame.width,
        frame.height
      );
      mapping[name] = {
        ...frame,
        x,
        y,
        width: SHADOW_CELL,
        height: SHADOW_CELL,
        anchorX: frame.anchorX + SHADOW_PAD,
        anchorY: frame.anchorY + SHADOW_PAD,
      };
    });
    return { canvas: created.canvas, mapping };
  });
}

/** Builds the icon layer, or null when the atlas could not be painted. */
export const buildSymbolDeckLayer = (
  props: { symbols?: string[]; shadow?: boolean } & Record<string, unknown>
): unknown => {
  const { symbols, shadow, ...rest } = props;
  const built = shadow ? shadowAtlasFor(symbols ?? []) : atlasFor(symbols ?? []);
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
    // deck sizes an icon by its cell, so the glyph in a padded shadow cell would
    // come out smaller than the symbol by the padding's ratio. Last, because
    // the padding is this module's business and nobody else's.
    ...(shadow ? { sizeScale: SHADOW_CELL / CELL } : {}),
  } as never);
};
