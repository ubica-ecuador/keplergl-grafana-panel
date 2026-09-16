import {
  arrowGlyph,
  ATLAS_COLUMNS,
  CELL,
  drawGlyph,
  Glyph,
  IconFrame,
  paintAtlas,
  Painter,
} from './vectorFieldGlyphs';
import keplerIcons from '../icons/svg-icons.json';
import maki from '../icons/maki-paths.json';

/**
 * The shapes this plugin draws itself, as geometry.
 *
 * Geometry rather than pixels for the same reason the wind barbs are: what can
 * be wrong — where a glyph is anchored, whether it closes — is testable without
 * a canvas, and jest has none.
 *
 * Every glyph points north in its cell; the layer turns it on the map.
 */

const MID = CELL / 2;

/**
 * A glyph whose outline is an SVG path.
 *
 * Maki's icons have curves, which `Shape` cannot express, so the path travels
 * as the string it came as and is painted with `Path2D`. `box` is the side of
 * the coordinate system that path is drawn in, so the painter can scale it into
 * the atlas cell.
 */
export interface PathGlyph {
  key: string;
  anchor: [number, number];
  path: string;
  box: number;
}

export type AnyGlyph = Glyph | PathGlyph;

export function isPathGlyph(glyph: AnyGlyph): glyph is PathGlyph {
  return typeof (glyph as PathGlyph).path === 'string';
}

/**
 * What painting a symbol atlas needs, beyond what a shape needs.
 *
 * `Path2D` has no place in jsdom, so nothing here is exercised by jest with a
 * real canvas: the glyph geometry is tested pure and the painting is verified
 * in the browser, exactly as the wind barbs already are.
 */
export interface SymbolPainter extends Painter {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  fill(path?: Path2D): void;
}

/** One icon of kepler's own library: a flat, triangulated outline. */
export interface KeplerIcon {
  id: string;
  mesh: { positions: number[][]; cells: number[][] };
}

/** The glyph drawn when a saved config names one this build does not have. */
export const SYMBOL_FALLBACK = 'arrow';

/**
 * kepler's icons as glyphs of this atlas.
 *
 * They arrive as 2-D meshes — positions normalised to [-1, 1] with z always
 * zero, and triangles indexing them — so each triangle becomes a filled polygon
 * of the cell. Filling the triangles of a triangulation paints the same solid
 * shape the outline would, and needs nothing our painter does not already do.
 *
 * The y axis is flipped: a mesh grows upwards, a canvas downwards.
 */
export function meshGlyphs(icons: KeplerIcon[]): Glyph[] {
  return icons.map((icon) => ({
    key: icon.id,
    anchor: [MID, MID] as [number, number],
    shapes: icon.mesh.cells.map((cell) => ({
      kind: 'polygon' as const,
      points: cell.map((index) => {
        const [x, y] = icon.mesh.positions[index];
        return [round(MID + x * MID), round(MID - y * MID)] as [number, number];
      }),
    })),
  }));
}

/** Atlas pixels, to a hundredth: enough to draw, short enough to compare in a test. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function ownGlyphs(): Glyph[] {
  return [
    arrowGlyph(),
    { key: 'circle', anchor: [MID, MID], shapes: [{ kind: 'circle', centre: [MID, MID], radius: 26 }] },
    {
      key: 'square',
      anchor: [MID, MID],
      shapes: [{ kind: 'polygon', points: [[22, 22], [74, 22], [74, 74], [22, 74]] }],
    },
    {
      key: 'triangle',
      anchor: [MID, MID],
      shapes: [{ kind: 'polygon', points: [[MID, 18], [76, 74], [20, 74]] }],
    },
    {
      key: 'chevron',
      anchor: [MID, MID],
      shapes: [{ kind: 'line', points: [[24, 62], [MID, 30], [72, 62]] }],
    },
    {
      key: 'pin',
      // Driven into the ground at the bottom of the cell, like a barb's station.
      anchor: [MID, 92],
      shapes: [
        { kind: 'line', points: [[MID, 92], [MID, 44]] },
        { kind: 'circle', centre: [MID, 30], radius: 16 },
      ],
    },
    {
      key: 'cross',
      anchor: [MID, MID],
      shapes: [
        { kind: 'line', points: [[26, 26], [70, 70]] },
        { kind: 'line', points: [[70, 26], [26, 70]] },
      ],
    },
  ];
}

/** Maki's icons as glyphs, drawn in the 15-unit box Maki designs in. */
export function makiGlyphs(paths: Record<string, string>): PathGlyph[] {
  return Object.entries(paths).map(([key, path]) => ({
    key,
    anchor: [MID, MID] as [number, number],
    path,
    box: 15,
  }));
}

let catalogue: Map<string, AnyGlyph> | null = null;

/**
 * Every glyph this build can draw, by name.
 *
 * Three sources, one namespace: our own shapes, kepler's 162 meshes and Maki's
 * 215 paths. Ours are inserted last so a name we promise in the panel — the
 * basic shapes — is the one the panel draws, whatever the libraries also call
 * `circle`.
 */
export function symbolCatalogue(): Map<string, AnyGlyph> {
  if (!catalogue) {
    catalogue = new Map<string, AnyGlyph>();
    for (const glyph of [
      ...meshGlyphs(keplerIcons.svgIcons as unknown as KeplerIcon[]),
      ...makiGlyphs(maki.paths),
      ...ownGlyphs(),
    ]) {
      catalogue.set(glyph.key, glyph);
    }
  }
  return catalogue;
}

let names: string[] | null = null;

/**
 * The names the panel offers, in catalogue order.
 *
 * A function, not a constant: a top-level `const` here ran at import time,
 * which meant every panel render built the whole catalogue — including
 * triangulating kepler's 162 meshes into polygons — whether or not a symbol
 * layer was ever added. `symbolCatalogue()` is already memoized, so caching
 * here only avoids re-spreading its keys into a fresh array on every call.
 */
export function symbolNames(): string[] {
  if (!names) {
    names = [...symbolCatalogue().keys()];
  }
  return names;
}

/**
 * The glyphs behind a list of names: deduplicated, ordered, and never empty.
 *
 * A name this build does not have draws the arrow rather than nothing at all —
 * a dashboard saved against a later catalogue still has to draw. Kept apart
 * from the atlas so the fallback can be tested: painting needs a canvas, and
 * jest has none.
 */
export function glyphsFor(names: string[]): AnyGlyph[] {
  const catalogue = symbolCatalogue();
  const wanted = [...new Set(names)].sort();
  const glyphs = wanted.map((name) => catalogue.get(name) ?? catalogue.get(SYMBOL_FALLBACK)!);
  const unique = new Map(glyphs.map((glyph) => [glyph.key, glyph]));

  return unique.size > 0 ? [...unique.values()] : [catalogue.get(SYMBOL_FALLBACK)!];
}

/**
 * Paints the glyphs given — and only those — returning deck's icon mapping.
 *
 * Only those is the whole point: the full catalogue is nearly four hundred
 * glyphs, which at one 96 px cell each is a texture of some 14 MB. A layer
 * draws one symbol at a time.
 */
export function paintGlyphs(
  glyphs: AnyGlyph[],
  ctx: SymbolPainter,
  columns = ATLAS_COLUMNS
): Record<string, IconFrame> {
  return paintAtlas(glyphs as unknown as Glyph[], ctx, columns, (glyph, context, x, y) => {
    const anyGlyph = glyph as AnyGlyph;
    const symbolCtx = context as SymbolPainter;
    if (isPathGlyph(anyGlyph)) {
      // Saved and restored around the transform: without it every later glyph
      // would inherit this one's scale and land in the wrong cell.
      symbolCtx.save();
      symbolCtx.translate(x, y);
      symbolCtx.scale(CELL / anyGlyph.box, CELL / anyGlyph.box);
      symbolCtx.fill(new Path2D(anyGlyph.path));
      symbolCtx.restore();
    } else {
      drawGlyph(anyGlyph, symbolCtx, x, y);
    }
  });
}
