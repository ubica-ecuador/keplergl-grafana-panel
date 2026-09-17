import { symbolNames } from './symbolGlyphs';

/**
 * The atlas cache, with a canvas that paints.
 *
 * `symbolDeckLayer.test.ts` covers the path where no 2D context exists, which is
 * what jsdom gives for free. The cache itself needs the other path, so the
 * canvas factory and the painter are replaced with recorders: what is under
 * test is how often an atlas is painted, not what it looks like.
 */

const mockPaint = jest.fn((glyphs: Array<{ key: string }>) =>
  Object.fromEntries(glyphs.map((glyph) => [glyph.key, { x: 0, y: 0, width: 1, height: 1 }]))
);
const mockCanvas = { contexts: true, made: 0 };

jest.mock('./symbolGlyphs', () => ({
  ...jest.requireActual('./symbolGlyphs'),
  paintGlyphs: (glyphs: Array<{ key: string }>) => mockPaint(glyphs),
}));

jest.mock('./vectorFieldGlyphs', () => ({
  ...jest.requireActual('./vectorFieldGlyphs'),
  createAtlasCanvas: () => (mockCanvas.contexts ? { canvas: { atlas: ++mockCanvas.made }, ctx: {} } : null),
}));

jest.mock('@deck.gl/layers', () => ({
  IconLayer: class {
    constructor(public props: Record<string, unknown>) {}
  },
}));

type Build = (props: { symbols?: string[] }) => { props: { iconAtlas: unknown } } | null;

/** A fresh copy of the module, so each test starts with an empty cache. */
function freshBuild(): Build {
  let build: Build | undefined;
  jest.isolateModules(() => {
    build = require('./symbolDeckLayer').buildSymbolDeckLayer;
  });
  return build!;
}

beforeEach(() => {
  mockPaint.mockClear();
  mockCanvas.contexts = true;
  mockCanvas.made = 0;
});

describe('the symbol atlas cache', () => {
  it('paints each set of glyphs once, however two layers interleave', () => {
    // Two panels on one page, one drawing arrows and one airports: a single
    // cache slot repainted on every render of either.
    const build = freshBuild();

    const arrows = build({ symbols: ['arrow'] });
    build({ symbols: ['airport'] });
    const arrowsAgain = build({ symbols: ['arrow'] });
    build({ symbols: ['airport'] });

    expect(mockPaint).toHaveBeenCalledTimes(2);
    // The same canvas, so deck has no new texture to upload.
    expect(arrowsAgain!.props.iconAtlas).toBe(arrows!.props.iconAtlas);
  });

  it('never caches a failed 2D context as a built atlas', () => {
    const build = freshBuild();

    mockCanvas.contexts = false;
    expect(build({ symbols: ['circle'] })).toBeNull();

    mockCanvas.contexts = true;
    expect(build({ symbols: ['circle'] })).not.toBeNull();
    expect(mockPaint).toHaveBeenCalledTimes(1);
  });

  it('stays bounded, letting go of the set used longest ago', () => {
    const build = freshBuild();
    const names = symbolNames().slice(0, 17);

    for (const name of names.slice(0, 16)) {
      build({ symbols: [name] });
    }
    // The first set is used again, so it is no longer the oldest.
    build({ symbols: [names[0]] });
    // A seventeenth set pushes out the least recently used: the second.
    build({ symbols: [names[16]] });
    expect(mockPaint).toHaveBeenCalledTimes(17);

    build({ symbols: [names[0]] });
    expect(mockPaint).toHaveBeenCalledTimes(17);
    build({ symbols: [names[1]] });
    expect(mockPaint).toHaveBeenCalledTimes(18);
  });
});
