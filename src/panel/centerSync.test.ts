import { decideCenter } from './centerSync';
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
