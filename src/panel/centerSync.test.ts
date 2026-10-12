import { centerOnLoad, decideCenter, withLoadCenter } from './centerSync';
import type { VariableMapping } from './variableSync';

/**
 * The decision behind "the dashboard centres the map from outside".
 * Everything runs against literal values — no kepler, no store. The case that
 * carries the design is the echo: the coordinate channel writes the map's own
 * clicks into the same variable pair, and centring on those would make the
 * map jump under the pointer — so a pair that matches the map's own pin is
 * the map talking to itself, never a request to move.
 */

const mapping: VariableMapping = { field: '', variable: 'lat', variableTo: 'lng', source: 'center', zoom: 6 };

describe('decideCenter', () => {
  it('centres on a fresh pair from the variables', () => {
    expect(
      decideCenter({ variableValues: { lat: '-4.2', lng: '-79.7' }, mapping, pinned: undefined, lastCentered: undefined })
    ).toEqual({ target: [-4.2, -79.7], key: '-4.2,-79.7' });
  });

  it('stays put while either variable is blank or missing', () => {
    expect(
      decideCenter({ variableValues: { lat: '-4.2', lng: '' }, mapping, pinned: undefined, lastCentered: undefined })
    ).toEqual({ target: null, key: undefined });
    expect(
      decideCenter({ variableValues: {}, mapping, pinned: undefined, lastCentered: undefined })
    ).toEqual({ target: null, key: undefined });
  });

  it('stays put on a value that is not a number', () => {
    expect(
      decideCenter({
        variableValues: { lat: 'Cuenca', lng: '-79.7' },
        mapping,
        pinned: undefined,
        lastCentered: undefined,
      })
    ).toEqual({ target: null, key: undefined });
  });

  it('does not re-centre when the pair has not moved since the last pass', () => {
    // Any unrelated variable change re-runs the reconcile; jumping back to a
    // stale pair would fight the user's own panning.
    expect(
      decideCenter({
        variableValues: { lat: '-4.2', lng: '-79.7' },
        mapping,
        pinned: undefined,
        lastCentered: '-4.2,-79.7',
      })
    ).toEqual({ target: null, key: '-4.2,-79.7' });
  });

  it('suppresses the echo of the map publishing its own click', () => {
    // The pin is kepler's [lng, lat]; the coordinate channel wrote it into the
    // pair at six decimals, so the same spot must read as the map itself.
    expect(
      decideCenter({
        variableValues: { lat: '-4.208897', lng: '-79.721135' },
        mapping,
        pinned: [-79.721135, -4.208897],
        lastCentered: undefined,
      })
    ).toEqual({ target: null, key: '-4.208897,-79.721135' });
  });

  it('compares against the pin at the six decimals the coordinate channel writes', () => {
    expect(
      decideCenter({
        variableValues: { lat: '-4.208897', lng: '-79.721135' },
        mapping,
        pinned: [-79.72113519012, -4.20889680055],
        lastCentered: undefined,
      })
    ).toEqual({ target: null, key: '-4.208897,-79.721135' });
  });

  it('centres when the pair genuinely differs from the pin', () => {
    expect(
      decideCenter({
        variableValues: { lat: '35.7', lng: '139.7' },
        mapping,
        pinned: [-79.721135, -4.208897],
        lastCentered: '-4.208897,-79.721135',
      })
    ).toEqual({ target: [35.7, 139.7], key: '35.7,139.7' });
  });

  it('reads the first entry of a URL-repeated variable', () => {
    expect(
      decideCenter({
        variableValues: { lat: ['-4.2', 'stale'], lng: '-79.7' },
        mapping,
        pinned: undefined,
        lastCentered: undefined,
      })
    ).toEqual({ target: [-4.2, -79.7], key: '-4.2,-79.7' });
  });

  it('only adopts on a first pass that has a saved viewport to restore', () => {
    expect(
      decideCenter({
        variableValues: { lat: '-4.2', lng: '-79.7' },
        mapping,
        pinned: undefined,
        lastCentered: undefined,
        adoptOnly: true,
      })
    ).toEqual({ target: null, key: '-4.2,-79.7' });
  });

  it('centres on a first pass with no viewport to restore', () => {
    // The drill-down case: the panel mounts with the pair already in the URL,
    // so this pass is the only chance to honour it.
    expect(
      decideCenter({
        variableValues: { lat: '-7.58', lng: '24.4' },
        mapping,
        pinned: undefined,
        lastCentered: undefined,
        adoptOnly: false,
      })
    ).toEqual({ target: [-7.58, 24.4], key: '-7.58,24.4' });
  });

  it('needs both halves of the pair named on the mapping', () => {
    const latOnly: VariableMapping = { field: '', variable: 'lat', source: 'center' };
    expect(
      decideCenter({ variableValues: { lat: '-4.2' }, mapping: latOnly, pinned: undefined, lastCentered: undefined })
    ).toEqual({ target: null, key: undefined });
  });
});

describe('centerOnLoad', () => {
  const read = (values: Record<string, string>) => (name: string) => values[name];

  it('reads the pair a link carries, with the mapping’s zoom', () => {
    expect(centerOnLoad([mapping], read({ lat: '34.02', lng: '-118.47' }))).toEqual({
      latitude: 34.02,
      longitude: -118.47,
      zoom: 6,
    });
  });

  it('asks for nothing when the link carries no pair, or no mapping is a center one', () => {
    expect(centerOnLoad([mapping], read({ lat: '34.02' }))).toBeNull();
    expect(centerOnLoad([{ field: 'site', variable: 'site' }], read({ site: 'a' }))).toBeNull();
  });

  it('leaves the zoom out when the mapping names none', () => {
    const { zoom, ...noZoom } = mapping;
    expect(centerOnLoad([noZoom], read({ lat: '1', lng: '2' }))).toEqual({ latitude: 1, longitude: 2 });
  });
});

describe('withLoadCenter', () => {
  const saved = {
    version: 'v1',
    config: { mapState: { latitude: 34, longitude: -118, zoom: 11, bearing: 20, pitch: 40 } },
  } as never;
  const mapStateOf = (config: unknown) => (config as { config: { mapState: unknown } }).config.mapState;

  it('moves the saved viewport to the link’s centre, keeping bearing and pitch', () => {
    expect(mapStateOf(withLoadCenter(saved, { latitude: 34.02, longitude: -118.47, zoom: 14 }))).toEqual({
      latitude: 34.02,
      longitude: -118.47,
      zoom: 14,
      bearing: 20,
      pitch: 40,
    });
  });

  it('keeps the author’s zoom when the mapping names none', () => {
    expect(mapStateOf(withLoadCenter(saved, { latitude: 1, longitude: 2 }))).toMatchObject({ zoom: 11 });
  });

  it('hands back the config untouched with no centre, or no saved viewport to move', () => {
    expect(withLoadCenter(saved, null)).toBe(saved);
    const noViewport = { version: 'v1', config: {} } as never;
    expect(withLoadCenter(noViewport, { latitude: 1, longitude: 2 })).toBe(noViewport);
    expect(withLoadCenter(null, { latitude: 1, longitude: 2 })).toBeNull();
  });
});
