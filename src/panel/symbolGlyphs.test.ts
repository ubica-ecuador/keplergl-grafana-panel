import { isPathGlyph, makiGlyphs, meshGlyphs, ownGlyphs, SYMBOL_FALLBACK } from './symbolGlyphs';
import keplerIcons from '../icons/svg-icons.json';
import maki from '../icons/maki-paths.json';

describe('ownGlyphs', () => {
  it('offers the basic shapes, each named once', () => {
    const names = ownGlyphs().map((g) => g.key);

    expect(names).toEqual(expect.arrayContaining(['arrow', 'circle', 'square', 'triangle', 'chevron', 'pin', 'cross']));
    expect(new Set(names).size).toBe(names.length);
  });

  it('anchors a pin at its point and everything else at its centre', () => {
    const byName = new Map(ownGlyphs().map((g) => [g.key, g]));

    // The cell is 96 px: a pin is driven into the ground at the bottom of it,
    // an arrow turns about the middle.
    expect(byName.get('pin')!.anchor).toEqual([48, 92]);
    expect(byName.get('arrow')!.anchor).toEqual([48, 48]);
  });

  it('draws every glyph with at least one shape, so no name paints an empty cell', () => {
    for (const glyph of ownGlyphs()) {
      expect(glyph.shapes.length).toBeGreaterThan(0);
    }
  });

  it('falls back to a name that exists', () => {
    expect(ownGlyphs().map((g) => g.key)).toContain(SYMBOL_FALLBACK);
  });
});

describe('meshGlyphs', () => {
  it('turns a triangulated mesh into polygons of the glyph cell', () => {
    // A single triangle spanning the whole normalised box.
    const glyphs = meshGlyphs([
      { id: 'tri', mesh: { positions: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]], cells: [[0, 1, 2]] } },
    ]);

    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].key).toBe('tri');
    expect(glyphs[0].shapes).toHaveLength(1);
    // x: -1 -> left edge, 1 -> right edge. y is flipped, because a mesh's y
    // grows upwards and a canvas's grows downwards.
    expect(glyphs[0].shapes[0]).toEqual({
      kind: 'polygon',
      points: [[0, 96], [96, 96], [48, 0]],
    });
  });

  it('anchors a mesh glyph at the centre of its cell', () => {
    const glyphs = meshGlyphs([
      { id: 'tri', mesh: { positions: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]], cells: [[0, 1, 2]] } },
    ]);

    expect(glyphs[0].anchor).toEqual([48, 48]);
  });

  it('reads the library this plugin ships', () => {
    const glyphs = meshGlyphs(keplerIcons.svgIcons as never);

    expect(glyphs.length).toBe(162);
    // The map-ish ones this layer exists to offer.
    expect(glyphs.map((g) => g.key)).toEqual(expect.arrayContaining(['pin', 'place', 'location', 'directions']));
    for (const glyph of glyphs) {
      expect(glyph.shapes.length).toBeGreaterThan(0);
    }
  });
});

describe('makiGlyphs', () => {
  it('carries the path as a string, because curves do not fit the shape model', () => {
    const glyphs = makiGlyphs({ airport: 'M15,6.8L8.5,7.5z' });

    expect(glyphs).toHaveLength(1);
    expect(isPathGlyph(glyphs[0])).toBe(true);
    expect(glyphs[0].path).toBe('M15,6.8L8.5,7.5z');
    // Maki draws in a 15x15 box; the atlas cell is 96.
    expect(glyphs[0].box).toBe(15);
    expect(glyphs[0].anchor).toEqual([48, 48]);
  });

  it('reads the vendored library, transport included', () => {
    const glyphs = makiGlyphs(maki.paths);
    const names = glyphs.map((g) => g.key);

    expect(glyphs.length).toBe(215);
    expect(names).toEqual(expect.arrayContaining(['airport', 'heliport', 'bus', 'rail', 'ferry', 'harbor', 'bicycle']));
    for (const glyph of glyphs) {
      expect(glyph.path.length).toBeGreaterThan(0);
    }
  });
});
