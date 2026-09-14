import { barbIconKey, barbParts } from './windBarb';
import { atlasSize, CELL, glyphCatalogue, Glyph, paintAtlas, Painter } from './vectorFieldGlyphs';

const byKey = (key: string): Glyph => glyphCatalogue().find((glyph) => glyph.key === key)!;
const MID = CELL / 2;

/** Every point a glyph draws through, its circles included by their extremes. */
const pointsOf = (glyph: Glyph): Array<[number, number]> =>
  glyph.shapes.flatMap((shape) =>
    shape.kind === 'circle'
      ? [
          [shape.centre[0] - shape.radius, shape.centre[1] - shape.radius],
          [shape.centre[0] + shape.radius, shape.centre[1] + shape.radius],
        ]
      : shape.points
  );

describe('glyphCatalogue', () => {
  it('holds the arrow, calm and every barb from 5 to 200 knots on both sides of the equator', () => {
    expect(glyphCatalogue()).toHaveLength(82);
  });

  it('has a glyph for every key a speed can ask for', () => {
    // Whatever the layer computes has to be in the atlas: deck draws nothing,
    // and says nothing, for an icon key it does not know.
    const keys = new Set(glyphCatalogue().map((glyph) => glyph.key));
    for (let knots = 0; knots <= 260; knots += 0.5) {
      expect(keys.has(barbIconKey(barbParts(knots), false))).toBe(true);
      expect(keys.has(barbIconKey(barbParts(knots), true))).toBe(true);
    }
    expect(keys.has('arrow')).toBe(true);
  });

  it('keeps every glyph inside its own cell', () => {
    for (const glyph of glyphCatalogue()) {
      for (const [x, y] of pointsOf(glyph)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(CELL);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(CELL);
      }
    }
  });

  it('draws the barbs east of the staff north of the equator, and west of it south', () => {
    // The glyph's staff points north, into the wind. With the wind at your back
    // — facing south — low pressure is on your left in the northern hemisphere,
    // which is east, and the barbs fly on that side. The southern mirror flips it.
    const featherTips = (glyph: Glyph) => glyph.shapes.slice(1).flatMap((shape) => (shape.kind === 'circle' ? [] : shape.points));

    expect(featherTips(byKey('barb-10-n')).every(([x]) => x >= MID)).toBe(true);
    expect(featherTips(byKey('barb-10-n')).some(([x]) => x > MID)).toBe(true);
    expect(featherTips(byKey('barb-10-s')).every(([x]) => x <= MID)).toBe(true);
    expect(featherTips(byKey('barb-10-s')).some(([x]) => x < MID)).toBe(true);
  });

  it('draws a pennant for every fifty knots and a line for every barb', () => {
    const polygons = (key: string) => byKey(key).shapes.filter((shape) => shape.kind === 'polygon').length;
    const lines = (key: string) => byKey(key).shapes.filter((shape) => shape.kind === 'line').length;

    expect(polygons('barb-150-n')).toBe(3);
    // The staff, one full barb and one half barb.
    expect(polygons('barb-65-n')).toBe(1);
    expect(lines('barb-65-n')).toBe(3);
  });

  it('anchors a barb at its station and an arrow at its middle', () => {
    expect(byKey('arrow').anchor).toEqual([MID, MID]);
    expect(byKey('barb-20-n').anchor[0]).toBe(MID);
    // The station is the far end of the staff from the feathers.
    expect(byKey('barb-20-n').anchor[1]).toBeGreaterThan(CELL * 0.9);
  });
});

describe('paintAtlas', () => {
  /** A 2D context that remembers the points it was drawn through. */
  function recordingPainter() {
    const points: Array<[number, number]> = [];
    const painter: Painter = {
      lineWidth: 0,
      strokeStyle: '',
      fillStyle: '',
      lineCap: 'butt',
      lineJoin: 'miter',
      beginPath: () => undefined,
      closePath: () => undefined,
      moveTo: (x, y) => void points.push([x, y]),
      lineTo: (x, y) => void points.push([x, y]),
      arc: (x, y) => void points.push([x, y]),
      stroke: () => undefined,
      fill: () => undefined,
    };
    return { painter, points };
  }

  it('lays the glyphs out in rows of ten cells and maps each one to its cell', () => {
    const glyphs = glyphCatalogue();
    const { painter } = recordingPainter();

    const mapping = paintAtlas(glyphs, painter);

    expect(Object.keys(mapping)).toHaveLength(82);
    expect(mapping[glyphs[0].key]).toEqual({ x: 0, y: 0, width: CELL, height: CELL, anchorX: MID, anchorY: MID, mask: true });
    expect(mapping[glyphs[13].key]).toMatchObject({ x: 3 * CELL, y: CELL });
    expect(atlasSize(82)).toEqual({ width: 10 * CELL, height: 9 * CELL });
  });

  it('paints each glyph inside the cell the mapping gives it', () => {
    const glyphs = glyphCatalogue().slice(0, 12);
    const { painter, points } = recordingPainter();

    paintAtlas(glyphs, painter);

    // Glyph 11 sits in row 1, column 1; nothing painted for the first glyph
    // may leak out of row 0, column 0.
    const first = points.slice(0, pointsOf(glyphs[0]).length);
    expect(first.every(([x, y]) => x <= CELL && y <= CELL)).toBe(true);
    expect(points.every(([x, y]) => x <= 10 * CELL && y <= 2 * CELL)).toBe(true);
  });
});
