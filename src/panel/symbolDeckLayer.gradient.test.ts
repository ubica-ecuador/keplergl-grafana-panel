import { buildSymbolDeckLayer, SymbolGradientExtension } from './symbolDeckLayer';

/**
 * The tail-to-tip gradient, as far as jest can see it: that the extension is
 * attached with its value and kepler's own extensions are kept. The shader
 * itself needs WebGL, and what it looks like is for the browser.
 */

jest.mock('./symbolGlyphs', () => ({
  ...jest.requireActual('./symbolGlyphs'),
  paintGlyphs: (glyphs: Array<{ key: string }>) =>
    Object.fromEntries(glyphs.map((glyph) => [glyph.key, { x: 0, y: 0, width: 96, height: 96, mask: true }])),
}));

jest.mock('./vectorFieldGlyphs', () => ({
  ...jest.requireActual('./vectorFieldGlyphs'),
  createAtlasCanvas: () => ({ canvas: {}, ctx: {} }),
}));

/** Stands in for kepler's data filter extension, which must survive. */
const keplerFilter = { name: 'kepler-filter' };

describe('the tail-to-tip gradient', () => {
  it('adds its extension after kepler’s, with the tail’s lightness', () => {
    const layer = buildSymbolDeckLayer({ symbols: ['arrow'], gradient: 0.6, extensions: [keplerFilter] }) as any;

    expect(layer.props.extensions[0]).toBe(keplerFilter);
    expect(layer.props.extensions[1]).toBeInstanceOf(SymbolGradientExtension);
    expect(layer.props.gradientTail).toBe(0.6);
    expect('gradient' in layer.props).toBe(false);
  });

  it('hands deck the same extension every time, so its shaders are not rebuilt on every render', () => {
    const first = buildSymbolDeckLayer({ symbols: ['arrow'], gradient: 0.6, extensions: [] }) as any;
    const second = buildSymbolDeckLayer({ symbols: ['arrow'], gradient: 0.3, extensions: [] }) as any;

    expect(second.props.extensions[0]).toBe(first.props.extensions[0]);
  });

  it('attaches nothing when no gradient is asked for', () => {
    const layer = buildSymbolDeckLayer({ symbols: ['arrow'], extensions: [keplerFilter] }) as any;

    expect(layer.props.extensions).toEqual([keplerFilter]);
  });

  it('lightens along the icon’s own vertical axis, which turns with the symbol', () => {
    // `geometry.uv` is the icon quad's corner, -1 at the top of the glyph — its
    // tip, since every glyph points north — and +1 at the bottom, its tail.
    const { inject, modules } = (SymbolGradientExtension.prototype.getShaders as () => any).call({});
    const shader = inject['fs:DECKGL_FILTER_COLOR'];

    expect(shader).toContain('geometry.uv.y');
    expect(modules[0].uniformTypes).toEqual({ tail: 'f32' });
  });
});
