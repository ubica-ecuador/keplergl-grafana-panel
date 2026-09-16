import { ownGlyphs, SYMBOL_FALLBACK } from './symbolGlyphs';

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
