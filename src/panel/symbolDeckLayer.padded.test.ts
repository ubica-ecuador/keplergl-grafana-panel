import { CELL } from './vectorFieldGlyphs';
import { buildSymbolDeckLayer, OUTLINE_PX_PER_STEP, SHADOW_BLUR, PADDED_CELL, PAD } from './symbolDeckLayer';

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

describe('the padded atlases, for the shadow and the outline', () => {
  it('leaves the symbols’ own atlas as it was', () => {
    const layer = buildSymbolDeckLayer({ symbols: ['square'] }) as any;

    expect(layer.props.iconMapping.square).toMatchObject({ width: CELL, height: CELL });
    expect(layer.props.sizeScale).toBe(1);
    expect('shadow' in layer.props).toBe(false);
  });

  it('draws each glyph blurred into a padded cell, anchored where the glyph is', () => {
    const layer = buildSymbolDeckLayer({ symbols: ['pin'], shadow: true }) as any;
    const [sharp, soft] = canvases;

    expect(PADDED_CELL).toBe(CELL + 2 * PAD);
    // The pin is anchored at the bottom of its cell; the padding moves that too.
    expect(layer.props.iconMapping.pin).toEqual({
      x: 0,
      y: 0,
      width: PADDED_CELL,
      height: PADDED_CELL,
      anchorX: 48 + PAD,
      anchorY: 92 + PAD,
      mask: true,
    });
    expect(soft.canvas.side).toBe(PADDED_CELL);
    expect(soft.ctx.filter).toBe(`blur(${SHADOW_BLUR}px)`);
    expect(soft.ctx.drawImage).toHaveBeenCalledWith(sharp.canvas, 0, 0, CELL, CELL, PAD, PAD, CELL, CELL);
    expect(layer.props.iconAtlas).toBe(soft.canvas);
  });

  it('grows each glyph for the outline by stamping it round a circle, with no blur', () => {
    const layer = buildSymbolDeckLayer({ symbols: ['triangle'], outline: 3 }) as any;
    const [sharp, grown] = canvases;
    const radius = 3 * OUTLINE_PX_PER_STEP;

    expect(layer.props.iconMapping.triangle).toMatchObject({ width: PADDED_CELL, height: PADDED_CELL });
    expect(layer.props.sizeScale).toBeCloseTo(PADDED_CELL / CELL);
    expect(grown.ctx.filter).toBe('none');

    const stamps = grown.ctx.drawImage.mock.calls as number[][];
    expect(stamps.length).toBeGreaterThan(8);
    for (const [source, , , , , dx, dy] of stamps) {
      expect(source).toBe(sharp.canvas);
      // Every stamp within the outline's reach of the padded glyph's place...
      expect(Math.hypot(dx - PAD, dy - PAD)).toBeLessThanOrEqual(radius + 1e-9);
    }
    // ...and the outermost ring at it, all the way round.
    const outermost = stamps.filter(([, , , , , dx, dy]) => Math.abs(Math.hypot(dx - PAD, dy - PAD) - radius) < 1e-9);
    expect(outermost.some(([, , , , , dx]) => dx > PAD)).toBe(true);
    expect(outermost.some(([, , , , , dx]) => dx < PAD)).toBe(true);
    expect(outermost.some(([, , , , , , dy]) => dy > PAD)).toBe(true);
    expect(outermost.some(([, , , , , , dy]) => dy < PAD)).toBe(true);
    expect('outline' in layer.props).toBe(false);
  });

  it('never reaches past the padding, however thick the outline asked for', () => {
    buildSymbolDeckLayer({ symbols: ['chevron'], outline: 1000 });
    const [, grown] = canvases;

    for (const [, , , , , dx, dy] of grown.ctx.drawImage.mock.calls as number[][]) {
      expect(Math.hypot(dx - PAD, dy - PAD)).toBeLessThanOrEqual(PAD + 1e-9);
    }
  });

  it('scales the padded cell back up, so the glyph in it is drawn the size of the symbol', () => {
    const layer = buildSymbolDeckLayer({ symbols: ['cross'], shadow: true }) as any;

    // deck sizes an icon by its cell; a cell grown by the padding would shrink
    // the glyph inside it by the same ratio.
    expect(layer.props.sizeScale).toBeCloseTo(PADDED_CELL / CELL);
    expect('shadow' in layer.props).toBe(false);
  });
});
