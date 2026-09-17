import { CELL } from './vectorFieldGlyphs';
import { buildSymbolDeckLayer, SHADOW_BLUR, SHADOW_CELL, SHADOW_PAD } from './symbolDeckLayer';

/**
 * The shadow's atlas: a blurred copy of each glyph, in a cell with room for the
 * blur to spread. jsdom cannot paint, so the canvases here are stand-ins that
 * record what was asked of them; how the blur looks is for the browser.
 */

const canvases: Array<{ canvas: { side: number }; ctx: Record<string, any> }> = [];

jest.mock('./vectorFieldGlyphs', () => ({
  ...jest.requireActual('./vectorFieldGlyphs'),
  createAtlasCanvas: (_count: number, cell: number) => {
    const created = { canvas: { side: cell }, ctx: { filter: 'none', drawImage: jest.fn() } };
    canvases.push(created);
    return created;
  },
}));

jest.mock('./symbolGlyphs', () => ({
  ...jest.requireActual('./symbolGlyphs'),
  paintGlyphs: (glyphs: Array<{ key: string; anchor: [number, number] }>) =>
    Object.fromEntries(
      glyphs.map((glyph, i) => [
        glyph.key,
        { x: i * 96, y: 0, width: 96, height: 96, anchorX: glyph.anchor[0], anchorY: glyph.anchor[1], mask: true },
      ])
    ),
}));

beforeEach(() => {
  canvases.length = 0;
});

describe('the shadow atlas', () => {
  it('leaves the symbols’ own atlas as it was', () => {
    const layer = buildSymbolDeckLayer({ symbols: ['square'] }) as any;

    expect(layer.props.iconMapping.square).toMatchObject({ width: CELL, height: CELL });
    expect(layer.props.sizeScale).toBe(1);
    expect('shadow' in layer.props).toBe(false);
  });

  it('draws each glyph blurred into a padded cell, anchored where the glyph is', () => {
    const layer = buildSymbolDeckLayer({ symbols: ['pin'], shadow: true }) as any;
    const [sharp, soft] = canvases;

    expect(SHADOW_CELL).toBe(CELL + 2 * SHADOW_PAD);
    // The pin is anchored at the bottom of its cell; the padding moves that too.
    expect(layer.props.iconMapping.pin).toEqual({
      x: 0,
      y: 0,
      width: SHADOW_CELL,
      height: SHADOW_CELL,
      anchorX: 48 + SHADOW_PAD,
      anchorY: 92 + SHADOW_PAD,
      mask: true,
    });
    expect(soft.canvas.side).toBe(SHADOW_CELL);
    expect(soft.ctx.filter).toBe(`blur(${SHADOW_BLUR}px)`);
    expect(soft.ctx.drawImage).toHaveBeenCalledWith(sharp.canvas, 0, 0, CELL, CELL, SHADOW_PAD, SHADOW_PAD, CELL, CELL);
    expect(layer.props.iconAtlas).toBe(soft.canvas);
  });

  it('scales the padded cell back up, so the glyph in it is drawn the size of the symbol', () => {
    const layer = buildSymbolDeckLayer({ symbols: ['cross'], shadow: true }) as any;

    // deck sizes an icon by its cell; a cell grown by the padding would shrink
    // the glyph inside it by the same ratio.
    expect(layer.props.sizeScale).toBeCloseTo(SHADOW_CELL / CELL);
    expect('shadow' in layer.props).toBe(false);
  });
});
