import {
  glyphsFor,
  isPathGlyph,
  makiGlyphs,
  meshGlyphs,
  ownGlyphs,
  paintGlyphs,
  symbolCatalogue,
  SYMBOL_FALLBACK,
  SYMBOL_NAMES,
} from './symbolGlyphs';
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

  it('encodes all vendored paths as valid SVG — no XML entities, starts with M or m', () => {
    const glyphs = makiGlyphs(maki.paths);
    const invalidPaths = [];

    for (const glyph of glyphs) {
      const path = glyph.path;
      // Every SVG path must start with a moveto command (M or m)
      if (!path.match(/^[Mm]/)) {
        invalidPaths.push(`${glyph.key}: does not start with M or m`);
      }
      // No unescaped XML entity markers should remain (& < >)
      if (path.includes('&') || path.includes('<') || path.includes('>')) {
        invalidPaths.push(`${glyph.key}: contains XML entity markers`);
      }
    }

    if (invalidPaths.length > 0) {
      throw new Error(`Path encoding errors:\n${invalidPaths.join('\n')}`);
    }
  });
});

describe('symbolCatalogue', () => {
  it('merges the three sources under unique names', () => {
    const catalogue = symbolCatalogue();

    expect(catalogue.get('chevron')).toBeDefined(); // ours
    expect(catalogue.get('directions')).toBeDefined(); // kepler
    expect(catalogue.get('airport')).toBeDefined(); // maki
    expect(SYMBOL_NAMES.length).toBe(catalogue.size);
  });

  it('lets our own shapes win a name collision, so the basic shapes stay predictable', () => {
    // Both kepler and ours ship a `pin`. Kepler's mesh glyphs anchor at the
    // centre [48, 48]; ours drives it into the ground at [48, 92]. This assertion
    // fails if the spread order changes to let kepler win.
    expect(symbolCatalogue().get('pin')!.anchor).toEqual([48, 92]);
  });
});

describe('glyphsFor', () => {
  it('resolves the names asked for, once each and in a stable order', () => {
    expect(glyphsFor(['square', 'circle', 'square']).map((g) => g.key)).toEqual(['circle', 'square']);
  });

  it('falls back to the arrow when a saved config names a glyph this build lacks', () => {
    // A dashboard saved against a later catalogue must still draw something.
    expect(glyphsFor(['no-such-glyph']).map((g) => g.key)).toEqual([SYMBOL_FALLBACK]);
  });

  it('never resolves to nothing, because an empty atlas is a blank map', () => {
    expect(glyphsFor([]).map((g) => g.key)).toEqual([SYMBOL_FALLBACK]);
  });
});

describe('paintGlyphs', () => {
  beforeAll(() => {
    (globalThis as { Path2D?: unknown }).Path2D = class {
      constructor(public d: string) {}
    };
  });

  afterAll(() => {
    delete (globalThis as { Path2D?: unknown }).Path2D;
  });

  const painter = () => {
    const calls: string[] = [];
    return {
      calls,
      ctx: {
        lineWidth: 0,
        strokeStyle: '',
        fillStyle: '',
        lineCap: 'round' as CanvasLineCap,
        lineJoin: 'round' as CanvasLineJoin,
        beginPath: () => calls.push('beginPath'),
        closePath: () => calls.push('closePath'),
        moveTo: () => calls.push('moveTo'),
        lineTo: () => calls.push('lineTo'),
        arc: () => calls.push('arc'),
        stroke: () => calls.push('stroke'),
        fill: () => calls.push('fill'),
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        translate: () => calls.push('translate'),
        scale: () => calls.push('scale'),
      },
    };
  };

  it('maps only the glyphs it was given, not the whole catalogue', () => {
    const { ctx } = painter();

    const mapping = paintGlyphs([symbolCatalogue().get('circle')!, symbolCatalogue().get('square')!], ctx);

    expect(Object.keys(mapping)).toEqual(['circle', 'square']);
    expect(mapping.circle).toMatchObject({ x: 0, y: 0, width: 96, height: 96, mask: true });
    expect(mapping.square.x).toBe(96);
  });

  it('scales a path glyph into the cell inside save/restore, so the next glyph is not skewed', () => {
    const { calls, ctx } = painter();

    paintGlyphs([symbolCatalogue().get('airport')!], ctx);

    expect(calls).toEqual(expect.arrayContaining(['save', 'translate', 'scale', 'restore']));
  });
});
