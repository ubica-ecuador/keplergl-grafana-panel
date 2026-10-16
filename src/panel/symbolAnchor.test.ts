import {
  anchorFractions,
  cellBox,
  inkBoxIn,
  pivotOffset,
  placeIn,
  SYMBOL_ANCHORS,
  symbolAnchorOf,
  turnAboutOf,
} from './symbolAnchor';

/** The arrow as the atlas paints it: a shaft and a head, 24 px wide, from 8 to 80 down its cell of 96. */
const arrowInk = { left: 36, top: 8, right: 60, bottom: 80 };
const cellCentre: [number, number] = [48, 48];

describe('symbolAnchorOf and turnAboutOf', () => {
  it('reads the nine points, and anything else as the centre', () => {
    for (const anchor of SYMBOL_ANCHORS) {
      expect(symbolAnchorOf(anchor)).toBe(anchor);
    }
    expect(symbolAnchorOf('middle')).toBe('center');
    expect(symbolAnchorOf(undefined)).toBe('center');
  });

  it('turns about the anchor unless the centre is asked for', () => {
    expect(turnAboutOf('centre')).toBe('centre');
    expect(turnAboutOf('center')).toBe('anchor');
    expect(turnAboutOf(undefined)).toBe('anchor');
  });
});

describe('anchorFractions', () => {
  it.each([
    ['center', [0.5, 0.5]],
    ['top', [0.5, 0]],
    ['bottom', [0.5, 1]],
    ['left', [0, 0.5]],
    ['right', [1, 0.5]],
    ['top-left', [0, 0]],
    ['top-right', [1, 0]],
    ['bottom-left', [0, 1]],
    ['bottom-right', [1, 1]],
  ] as const)('puts %s at %p of the box', (anchor, fractions) => {
    expect(anchorFractions(anchor)).toEqual(fractions);
  });
});

describe('placeIn', () => {
  it('keeps the point a glyph was drawn to sit on at the centre, as before there was a choice', () => {
    expect(placeIn(arrowInk, cellCentre, 'center', 'anchor')).toEqual({ pivot: [48, 48], shift: [0, 0], lift: [0, 0] });
    // A pin is driven in at its tip; its centre is still its tip.
    expect(placeIn({ left: 30, top: 12, right: 66, bottom: 94 }, [48, 92], 'center', 'anchor').pivot).toEqual([48, 92]);
  });

  it('stands a shape on its own edge, not on the empty margin of its cell', () => {
    const placement = placeIn(arrowInk, cellCentre, 'bottom', 'anchor');

    expect(placement.pivot).toEqual([48, 80]);
    expect(placement.shift).toEqual([0, 0]);
    // Labels go about the middle of the arrow, 36 px above its tail.
    expect(placement.lift).toEqual([0, -36]);
  });

  it('pins a corner of the box', () => {
    expect(placeIn(arrowInk, cellCentre, 'top-left', 'anchor').pivot).toEqual([36, 8]);
    expect(placeIn(arrowInk, cellCentre, 'bottom-right', 'anchor').pivot).toEqual([60, 80]);
  });

  it('turning about the centre pins the middle and pushes it back off the anchor', () => {
    const placement = placeIn(arrowInk, cellCentre, 'bottom', 'centre');

    expect(placement.pivot).toEqual([48, 44]);
    // The middle sits 36 px above the anchor, so the anchor lands on the position unturned.
    expect(placement.shift).toEqual([0, -36]);
    expect(placement.lift).toEqual([0, -36]);
  });

  it('places a picture by its cell, which it fills along the anchor’s sides', () => {
    expect(placeIn(cellBox(128), [64, 64], 'bottom', 'anchor').pivot).toEqual([64, 128]);
    expect(placeIn(cellBox(128), [64, 64], 'top-right', 'centre')).toEqual({
      pivot: [64, 64],
      shift: [-64, 64],
      lift: [-64, 64],
    });
  });
});

describe('inkBoxIn', () => {
  /** An atlas two cells of 4 px wide, with ink only where `drawn` says, in the second cell. */
  const atlas = (drawn: Array<[number, number, number]>) => {
    const width = 8;
    const rgba = new Uint8ClampedArray(width * 4 * 4);
    for (const [x, y, alpha] of drawn) {
      rgba[(y * width + 4 + x) * 4 + 3] = alpha;
    }
    return rgba;
  };
  const secondCell = { x: 4, y: 0, width: 4, height: 4 };

  it('bounds the drawn pixels of one cell, right and bottom one past the last', () => {
    expect(
      inkBoxIn(
        atlas([
          [1, 0, 255],
          [2, 3, 200],
        ]),
        8,
        secondCell
      )
    ).toEqual({ left: 1, top: 0, right: 3, bottom: 4 });
  });

  it('leaves a faint antialiased fringe out', () => {
    expect(
      inkBoxIn(
        atlas([
          [1, 1, 255],
          [3, 3, 10],
        ]),
        8,
        secondCell
      )
    ).toEqual({ left: 1, top: 1, right: 2, bottom: 2 });
  });

  it('finds nothing in an empty cell', () => {
    expect(inkBoxIn(atlas([]), 8, secondCell)).toBeNull();
  });
});

describe('pivotOffset', () => {
  it('is nothing at all when the symbol turns about its anchor', () => {
    expect(pivotOffset([0, 0], 96, () => 20)).toBeNull();
  });

  it('scales the push as deck scales the icon: the row’s size over the cell, and the zoom’s shrinking', () => {
    const offset = pivotOffset([0, -36], 96, (row) => (row as { size: number }).size, 0.5);

    expect(offset?.({ size: 48 })).toEqual([0, -9]);
    expect(offset?.({ size: 96 })).toEqual([0, -18]);
  });
});
