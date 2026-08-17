import { areaFingerprints, decideAreaPublish } from './areaSync';

/**
 * The decision behind "the figure you drew is now a dashboard variable".
 * Everything here runs against literal features — no kepler, no store — which
 * is what keeps the publish rules testable: who wins when several figures
 * exist, when an edit republishes, and above all that a dashboard opened from
 * a shared link never overwrites the variable it arrived with.
 */

const square = (id: string, offset = 0) => ({
  id,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [offset, 0],
        [offset, 1],
        [offset + 1, 1],
        [offset + 1, 0],
        [offset, 0],
      ],
    ],
  },
});

describe('areaFingerprints', () => {
  it('maps ids to their WKT', () => {
    expect(areaFingerprints([square('a')])).toEqual({
      a: 'POLYGON ((0 0, 0 1, 1 1, 1 0, 0 0))',
    });
  });

  it('skips figures that do not serialize', () => {
    expect(areaFingerprints([{ id: 'p', geometry: { type: 'Point', coordinates: [1, 2] } }])).toEqual({});
  });
});

describe('decideAreaPublish', () => {
  it('adopts silently on the first pass', () => {
    // The dashboard just loaded with a saved config that restored a polygon
    // filter. The variable may carry the value a shared link arrived with;
    // publishing now would overwrite it.
    expect(
      decideAreaPublish({ candidates: [square('a')], lastSeen: null, publishedId: null })
    ).toEqual({ action: 'none' });
  });

  it('publishes a newly drawn figure', () => {
    expect(decideAreaPublish({ candidates: [square('a')], lastSeen: {}, publishedId: null })).toEqual({
      action: 'publish',
      id: 'a',
      wkt: 'POLYGON ((0 0, 0 1, 1 1, 1 0, 0 0))',
    });
  });

  it('publishes the most recent of several new figures', () => {
    const first = areaFingerprints([square('a')]);
    expect(
      decideAreaPublish({ candidates: [square('a'), square('b', 5)], lastSeen: first, publishedId: 'a' })
    ).toEqual({ action: 'publish', id: 'b', wkt: 'POLYGON ((5 0, 5 1, 6 1, 6 0, 5 0))' });
  });

  it('republishes when a figure is edited', () => {
    // Dragging a vertex keeps the id and changes the geometry.
    const before = areaFingerprints([square('a')]);
    const edited = square('a', 2);
    expect(decideAreaPublish({ candidates: [edited], lastSeen: before, publishedId: 'a' })).toEqual({
      action: 'publish',
      id: 'a',
      wkt: 'POLYGON ((2 0, 2 1, 3 1, 3 0, 2 0))',
    });
  });

  it('stays quiet when a figure migrates from the editor to a filter', () => {
    // A finished rectangle is re-homed from editor.features into a polygon
    // filter with the same id and geometry — nothing about the area changed.
    const before = areaFingerprints([square('a')]);
    expect(decideAreaPublish({ candidates: [square('a')], lastSeen: before, publishedId: 'a' })).toEqual({
      action: 'none',
    });
  });

  it('ignores a sub-precision wiggle', () => {
    const before = areaFingerprints([square('a')]);
    const wiggled = {
      id: 'a',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [1e-8, 0],
            [0, 1],
            [1, 1.00000004],
            [1, 0],
            [1e-8, 0],
          ],
        ],
      },
    };
    expect(decideAreaPublish({ candidates: [wiggled], lastSeen: before, publishedId: 'a' })).toEqual({
      action: 'none',
    });
  });

  it('falls back to the remaining figure when the published one is deleted', () => {
    const before = areaFingerprints([square('a'), square('b', 5)]);
    expect(decideAreaPublish({ candidates: [square('a')], lastSeen: before, publishedId: 'b' })).toEqual({
      action: 'publish',
      id: 'a',
      wkt: 'POLYGON ((0 0, 0 1, 1 1, 1 0, 0 0))',
    });
  });

  it('clears when the last figure is deleted', () => {
    const before = areaFingerprints([square('a')]);
    expect(decideAreaPublish({ candidates: [], lastSeen: before, publishedId: 'a' })).toEqual({
      action: 'clear',
    });
  });

  it('stays quiet when an unpublished figure is deleted', () => {
    const before = areaFingerprints([square('a'), square('b', 5)]);
    expect(decideAreaPublish({ candidates: [square('b', 5)], lastSeen: before, publishedId: 'b' })).toEqual({
      action: 'none',
    });
  });

  it('stays quiet when nothing was ever drawn', () => {
    expect(decideAreaPublish({ candidates: [], lastSeen: {}, publishedId: null })).toEqual({ action: 'none' });
  });

  it('does not publish a figure that cannot be serialized', () => {
    expect(
      decideAreaPublish({
        candidates: [{ id: 'p', geometry: { type: 'Point', coordinates: [1, 2] } }],
        lastSeen: {},
        publishedId: null,
      })
    ).toEqual({ action: 'none' });
  });
});
