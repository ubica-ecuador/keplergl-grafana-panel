import {
  glyphsFor,
  isPathGlyph,
  makiGlyphs,
  meshGlyphs,
  OCHA_ICONS,
  ochaKey,
  ownGlyphs,
  paintGlyphs,
  PathGlyph,
  resolveSymbol,
  symbolCatalogue,
  symbolNames,
  SYMBOL_FALLBACK,
  TEMAKI_ICONS,
  TEMAKI_PREFIX,
  temakiKey,
  vendoredGlyphs,
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
      {
        id: 'tri',
        mesh: {
          positions: [
            [-1, -1, 0],
            [1, -1, 0],
            [0, 1, 0],
          ],
          cells: [[0, 1, 2]],
        },
      },
    ]);

    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].key).toBe('tri');
    expect(glyphs[0].shapes).toHaveLength(1);
    // x: -1 -> left edge, 1 -> right edge. y is NOT flipped: kepler's meshes
    // come from SVG and already grow downwards, like a canvas — kepler's own
    // icon layer negates y to draw them in its y-up world.
    expect(glyphs[0].shapes[0]).toEqual({
      kind: 'polygon',
      points: [
        [0, 0],
        [96, 0],
        [48, 96],
      ],
    });
  });

  it('anchors a mesh glyph at the centre of its cell', () => {
    const glyphs = meshGlyphs([
      {
        id: 'tri',
        mesh: {
          positions: [
            [-1, -1, 0],
            [1, -1, 0],
            [0, 1, 0],
          ],
          cells: [[0, 1, 2]],
        },
      },
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
  it('carries the path as data, because curves do not fit the shape model', () => {
    const glyphs = makiGlyphs({ airport: 'M15,6.8L8.5,7.5z' });

    expect(glyphs).toHaveLength(1);
    expect(isPathGlyph(glyphs[0])).toBe(true);
    // Maki draws one path in a 15x15 box, flush with its corner; the atlas cell is 96.
    expect(glyphs[0]).toEqual({
      key: 'airport',
      anchor: [48, 48],
      box: 15,
      offset: [0, 0],
      paths: [{ d: 'M15,6.8L8.5,7.5z' }],
    });
  });

  it('tells a path glyph from a shape glyph', () => {
    expect(isPathGlyph(ownGlyphs()[0])).toBe(false);
  });

  it('reads the vendored library, transport included', () => {
    const glyphs = makiGlyphs(maki.paths);
    const names = glyphs.map((g) => g.key);

    expect(glyphs.length).toBe(215);
    expect(names).toEqual(expect.arrayContaining(['airport', 'heliport', 'bus', 'rail', 'ferry', 'harbor', 'bicycle']));
    for (const glyph of glyphs) {
      expect(glyph.paths).toHaveLength(1);
      expect(glyph.paths[0].d.length).toBeGreaterThan(0);
    }
  });

  it('encodes all vendored paths as valid SVG — no XML entities, starts with M or m', () => {
    const glyphs = makiGlyphs(maki.paths);
    const invalidPaths = [];

    for (const glyph of glyphs) {
      const path = glyph.paths[0].d;
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

describe('vendoredGlyphs', () => {
  it('keys each icon by the name given and keeps its box, offset and every path', () => {
    const [glyph] = vendoredGlyphs(
      {
        source: 'test',
        version: '1',
        license: 'CC0-1.0',
        icons: {
          latrine: { box: 48, offset: [13, 0], paths: [{ d: 'M0 0H1Z' }, { d: 'M2 2H3Z', evenOdd: true }] },
        },
      },
      (name) => `temaki:${name}`
    );

    expect(glyph).toEqual({
      key: 'temaki:latrine',
      anchor: [48, 48],
      box: 48,
      offset: [13, 0],
      paths: [{ d: 'M0 0H1Z' }, { d: 'M2 2H3Z', evenOdd: true }],
    });
    expect(isPathGlyph(glyph)).toBe(true);
  });

  it('reads Temaki whole, in the boxes it draws in, keeping icons of several paths whole', () => {
    const glyphs = vendoredGlyphs(TEMAKI_ICONS, (name) => TEMAKI_PREFIX + name);

    // 557 in the npm package, minus `crossing_markings-zebra_bicolour`: its
    // stripes alternate solid and 30% opacity, which the glyph model cannot
    // carry, and `crossing_markings-zebra` draws the same crossing without it.
    expect(glyphs).toHaveLength(556);
    expect(new Set(glyphs.map((glyph) => glyph.box))).toEqual(new Set([15, 48, 50, 100]));
    expect(glyphs.filter((glyph) => glyph.paths.length > 1)).toHaveLength(116);
    for (const glyph of glyphs) {
      expect(glyph.key.startsWith('temaki:')).toBe(true);
      for (const path of glyph.paths) {
        expect(path.d).toMatch(/^[Mm]/);
      }
    }
  });

  it('reads OCHA under lower-case slugs, with its two even-odd icons', () => {
    const glyphs = vendoredGlyphs(OCHA_ICONS, ochaKey);

    expect(glyphs).toHaveLength(272);
    for (const glyph of glyphs) {
      expect(glyph.key).toMatch(/^ocha:[a-z0-9-]+$/);
      expect(glyph.box).toBeGreaterThan(0);
      expect(glyph.paths.length).toBeGreaterThan(0);
    }
    const evenOdd = glyphs.filter((glyph) => glyph.paths.some((path) => path.evenOdd)).map((glyph) => glyph.key);
    expect(evenOdd.sort()).toEqual(['ocha:mobile-clinic', 'ocha:water-trucking']);
  });
});

describe('temakiKey', () => {
  it('prefixes a Temaki file name with temaki:', () => {
    expect(temakiKey('power_tower')).toBe('temaki:power_tower');
  });
});

describe('ochaKey', () => {
  it('lower-cases an OCHA file name and turns its spaces into hyphens', () => {
    // The same rule as `ochaSlug` in scripts/svg-paths.mjs.
    expect(ochaKey('Indigenous people')).toBe('ocha:indigenous-people');
    expect(ochaKey('Flood')).toBe('ocha:flood');
  });
});

describe('symbolCatalogue', () => {
  it('merges the five sources, the vendored ones under their prefixes', () => {
    const catalogue = symbolCatalogue();

    expect(catalogue.get('chevron')).toBeDefined(); // ours
    expect(catalogue.get('directions')).toBeDefined(); // kepler
    expect(catalogue.get('airport')).toBeDefined(); // maki
    expect(catalogue.get('temaki:power_tower')).toBeDefined();
    expect(catalogue.get('ocha:flood')).toBeDefined();
    // Everything offered, plus kepler's 151 interface icons.
    expect(catalogue.size).toBe(symbolNames().length + 151);
  });

  it('lets our own shapes win a name collision, so the basic shapes stay predictable', () => {
    // Both kepler and ours ship a `pin`. Kepler's mesh glyphs anchor at the
    // centre [48, 48]; ours drives it into the ground at [48, 92]. This assertion
    // fails if the spread order changes to let kepler win.
    expect(symbolCatalogue().get('pin')!.anchor).toEqual([48, 92]);
  });
});

describe('symbolNames', () => {
  it('caches the list rather than rebuilding it on every call', () => {
    // Same array instance back, not just equal contents: this is what makes
    // a getter built on top of it cheap after the first read.
    expect(symbolNames()).toBe(symbolNames());
  });

  it('offers our shapes first, then Maki, Temaki and OCHA, each in alphabetical order', () => {
    const names = symbolNames();
    const own = ownGlyphs().map((glyph) => glyph.key);
    const makiOnly = Object.keys(maki.paths)
      .filter((name) => !own.includes(name))
      .sort();

    expect(names).toHaveLength(7 + 210 + 556 + 272);
    expect(new Set(names).size).toBe(names.length);
    expect(names.slice(0, 7)).toEqual(['arrow', 'circle', 'square', 'triangle', 'chevron', 'pin', 'cross']);
    expect(names.slice(7, 217)).toEqual(makiOnly);
    const temaki = names.slice(217, 773);
    expect(temaki.every((name) => name.startsWith('temaki:'))).toBe(true);
    expect(temaki).toEqual([...temaki].sort());
    const ocha = names.slice(773);
    expect(ocha.every((name) => name.startsWith('ocha:'))).toBe(true);
    expect(ocha).toEqual([...ocha].sort());
  });

  it('leaves out the names only kepler has, which still draw', () => {
    const own = new Set(ownGlyphs().map((glyph) => glyph.key));
    const keplerOnly = (keplerIcons.svgIcons as Array<{ id: string }>)
      .map((icon) => icon.id)
      .filter((id) => !(id in maki.paths) && !own.has(id));
    const offered = new Set(symbolNames());

    expect(keplerOnly).toHaveLength(151);
    expect(keplerOnly.filter((id) => offered.has(id))).toEqual([]);
    // Hidden, not deleted: a dashboard that draws one keeps drawing it.
    expect(resolveSymbol('directions')).toBe('directions');
    expect(glyphsFor(['directions']).map((glyph) => glyph.key)).toEqual(['directions']);
  });

  it('still draws every name the repository’s dashboards save', () => {
    for (const name of ['arrow', 'marker', 'bus']) {
      expect(resolveSymbol(name)).toBe(name);
    }
    expect(resolveSymbol('temaki:power_tower')).toBe('temaki:power_tower');
    expect(resolveSymbol('ocha:flood')).toBe('ocha:flood');
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

describe('resolveSymbol', () => {
  it('keeps a name this build can draw', () => {
    expect(resolveSymbol('airport')).toBe('airport');
  });

  it('answers the same fallback the atlas paints, for a name it cannot', () => {
    // The two must agree: deck looks the icon up by this name in that atlas.
    expect(resolveSymbol('no-such-glyph')).toBe(SYMBOL_FALLBACK);
    expect(glyphsFor([resolveSymbol('no-such-glyph')]).map((g) => g.key)).toEqual([resolveSymbol('no-such-glyph')]);
    expect(resolveSymbol(undefined)).toBe(SYMBOL_FALLBACK);
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

  it('fills each path of a glyph on its own, with its own rule, in the glyph box', () => {
    const calls: unknown[][] = [];
    const ctx = {
      ...painter().ctx,
      save: () => calls.push(['save']),
      restore: () => calls.push(['restore']),
      translate: (x: number, y: number) => calls.push(['translate', x, y]),
      scale: (x: number, y: number) => calls.push(['scale', x, y]),
      fill: (path?: unknown, rule?: string) => calls.push(['fill', (path as { d?: string } | undefined)?.d, rule]),
    };
    const one: PathGlyph = { key: 'one', anchor: [48, 48], box: 15, offset: [0, 0], paths: [{ d: 'M0 0H15V15Z' }] };
    // Two outlines that overlap: joined in one Path2D, opposite windings would
    // cancel where they meet, so each is filled on its own.
    const two: PathGlyph = {
      key: 'two',
      anchor: [48, 48],
      box: 50,
      offset: [3, 4],
      paths: [{ d: 'M0 0H40V40H0Z' }, { d: 'M10 10H30V30H10Z', evenOdd: true }],
    };

    paintGlyphs([one, two], ctx);

    expect(calls).toEqual([
      ['save'],
      ['translate', 0, 0],
      ['scale', 96 / 15, 96 / 15],
      ['translate', 0, 0],
      ['fill', 'M0 0H15V15Z', 'nonzero'],
      ['restore'],
      ['save'],
      ['translate', 96, 0],
      ['scale', 96 / 50, 96 / 50],
      ['translate', 3, 4],
      ['fill', 'M0 0H40V40H0Z', 'nonzero'],
      ['fill', 'M10 10H30V30H10Z', 'evenodd'],
      ['restore'],
    ]);
  });
});
