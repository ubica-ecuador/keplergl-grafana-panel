import { dropWrites, markerBounds, MarkerSpec, moveMarker, newMarker, readMarkers, reconcileMarkers } from './markers';

const marker = (overrides: Partial<MarkerSpec> = {}): MarkerSpec => ({
  id: 'm1',
  label: 'A',
  color: [1, 2, 3],
  latVariable: 'lat',
  lngVariable: 'lng',
  position: [-79, -2.9],
  ...overrides,
});

const vars =
  (values: Record<string, unknown>) =>
  (name: string): unknown =>
    values[name];

describe('readMarkers', () => {
  it('returns nothing for a missing or malformed list', () => {
    expect(readMarkers(undefined)).toEqual([]);
    expect(readMarkers({ markers: 'nope' })).toEqual([]);
  });

  it('drops entries without an id and fills in the rest', () => {
    const markers = readMarkers({
      markers: [{ label: 'no id' }, { id: 'a', latVariable: ' lat ', position: [1, 200] }, null],
    });
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ id: 'a', label: '', latVariable: 'lat', lngVariable: '', position: null });
    expect(markers[0].color).toHaveLength(3);
  });
});

describe('newMarker', () => {
  it('picks the next free id and letter', () => {
    const first = newMarker([]);
    expect(first).toMatchObject({ id: 'm1', label: 'A', position: null });
    const second = newMarker([first]);
    expect(second).toMatchObject({ id: 'm2', label: 'B' });
    expect(newMarker([marker({ id: 'm2' })]).id).toBe('m3');
  });
});

describe('moveMarker', () => {
  it('moves only the named marker', () => {
    const list = [marker(), marker({ id: 'm2' })];
    const moved = moveMarker(list, 'm2', [1, 2]);
    expect(moved[0].position).toEqual([-79, -2.9]);
    expect(moved[1].position).toEqual([1, 2]);
  });
});

describe('dropWrites', () => {
  it('writes both variables rounded to six decimals', () => {
    expect(dropWrites(marker(), [-79.123456789, -2.987654321], vars({}))).toEqual({
      'var-lat': '-2.987654',
      'var-lng': '-79.123457',
    });
  });

  it('skips a variable that already holds the value and an unbound one', () => {
    expect(dropWrites(marker({ lngVariable: '' }), [-79, -2.5], vars({ lat: '-2.500000' }))).toEqual({});
  });
});

describe('reconcileMarkers', () => {
  it('moves a marker to its variables', () => {
    const next = reconcileMarkers([marker()], vars({ lat: '-3', lng: '-78.5' }), null);
    expect(next?.[0].position).toEqual([-78.5, -3]);
  });

  it('returns null when nothing moves, so a store subscriber cannot loop', () => {
    expect(reconcileMarkers([marker()], vars({ lat: '-2.9', lng: '-79' }), [0, 0])).toBeNull();
    // Empty variables keep the last position.
    expect(reconcileMarkers([marker()], vars({ lat: '', lng: undefined }), [0, 0])).toBeNull();
  });

  it('places a marker that has never had a position at the fallback', () => {
    const next = reconcileMarkers([marker({ position: null })], vars({}), [5, 6]);
    expect(next?.[0].position).toEqual([5, 6]);
    expect(reconcileMarkers([marker({ position: null })], vars({}), null)).toBeNull();
  });

  it('ignores a pair that is not a coordinate', () => {
    expect(reconcileMarkers([marker()], vars({ lat: '120', lng: '-79' }), null)).toBeNull();
  });
});

describe('markerBounds', () => {
  it('frames the placed markers', () => {
    expect(markerBounds([marker(), marker({ id: 'b', position: [-78, -3] }), marker({ position: null })])).toEqual([
      -79, -3, -78, -2.9,
    ]);
    expect(markerBounds([])).toBeNull();
  });
});
