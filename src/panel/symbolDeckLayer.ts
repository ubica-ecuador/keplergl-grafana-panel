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

/**
 * Room on every side of a glyph drawn behind the symbols — a shadow, an
 * outline — for the blur or the thickness to spread into, rather than be cut
 * off at the edge of the cell.
 */
export const PAD = 24;

/** The side of a padded cell: a glyph's, and the padding round it. */
export const PADDED_CELL = CELL + 2 * PAD;

/** Atlas pixels of outline per step of the panel's thickness slider. */
export const OUTLINE_PX_PER_STEP = 2;

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
 * An atlas of the glyphs of the symbols' own, each copied into a cell grown by
 * the padding and anchored at the same point of the glyph — a shadow's or an
 * outline's, depending on `stamp`.
 *
 * Copied from the sharp atlas rather than painted again, so what sits behind a
 * symbol is always the silhouette of exactly what is drawn above it.
 * `stamp` draws one glyph into its padded cell, given where the glyph itself
 * would sit in it unpadded.
 */
function paddedAtlasFor(
  names: string[],
  kind: string,
  stamp: (ctx: CanvasRenderingContext2D, draw: (dx: number, dy: number) => void) => void
): Atlas | null {
  const sharp = atlasFor(names);
  if (!sharp) {
    return null;
  }
  const frames = Object.entries(sharp.mapping);
  return cached(`${kind}:${frames.map(([name]) => name).join(',')}`, () => {
    const created = createAtlasCanvas(frames.length, PADDED_CELL);
    if (!created) {
      return null;
    }
    const mapping: Record<string, IconFrame> = {};
    frames.forEach(([name, frame], index) => {
      const x = (index % ATLAS_COLUMNS) * PADDED_CELL;
      const y = Math.floor(index / ATLAS_COLUMNS) * PADDED_CELL;
      stamp(created.ctx, (dx, dy) =>
        created.ctx.drawImage(
          sharp.canvas,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          x + PAD + dx,
          y + PAD + dy,
          frame.width,
          frame.height
        )
      );
      mapping[name] = {
        ...frame,
        x,
        y,
        width: PADDED_CELL,
        height: PADDED_CELL,
        anchorX: frame.anchorX + PAD,
        anchorY: frame.anchorY + PAD,
      };
    });
    return { canvas: created.canvas, mapping };
  });
}

/**
 * The shadow's atlas: each glyph blurred. A browser whose canvas ignores
 * `filter` draws a sharp shadow, which is still a shadow.
 */
function shadowAtlasFor(names: string[]): Atlas | null {
  return paddedAtlasFor(names, 'shadow', (ctx, draw) => {
    ctx.filter = `blur(${SHADOW_BLUR}px)`;
    draw(0, 0);
  });
}

/**
 * The outline's atlas: each glyph grown by the thickness asked for, by stamping
 * it round rings out to that radius — a dilation, with nothing a canvas does
 * not do everywhere. Rings every few pixels and stamps a couple of pixels
 * apart round each, so neither a thin stroke nor a sharp corner leaves a gap.
 *
 * Capped at the padding: a thicker outline would be cut at the cell's edge.
 */
function outlineAtlasFor(names: string[], thickness: number): Atlas | null {
  const radius = Math.min(PAD, Math.max(1, thickness) * OUTLINE_PX_PER_STEP);
  return paddedAtlasFor(names, `outline-${radius}`, (_ctx, draw) => {
    draw(0, 0);
    const rings = Math.ceil(radius / 3);
    for (let ring = 1; ring <= rings; ring++) {
      const r = (radius * ring) / rings;
      const stamps = Math.max(8, Math.ceil((2 * Math.PI * r) / 2));
      for (let i = 0; i < stamps; i++) {
        const theta = (2 * Math.PI * i) / stamps;
        draw(r * Math.cos(theta), r * Math.sin(theta));
      }
    }
  });
}

/** Builds the icon layer, or null when the atlas could not be painted. */
export const buildSymbolDeckLayer = (
  props: { symbols?: string[]; shadow?: boolean; outline?: number } & Record<string, unknown>
): unknown => {
  const { symbols, shadow, outline, ...rest } = props;
  const names = symbols ?? [];
  const built =
    outline !== undefined ? outlineAtlasFor(names, outline) : shadow ? shadowAtlasFor(names) : atlasFor(names);
  const padded = outline !== undefined || shadow === true;
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
    // deck sizes an icon by its cell, so the glyph in a padded cell would come
    // out smaller than the symbol by the padding's ratio. Last, because the
    // padding is this module's business and nobody else's.
    ...(padded ? { sizeScale: PADDED_CELL / CELL } : {}),
  } as never);
};
