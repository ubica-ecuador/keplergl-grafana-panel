import { coordinateWrites } from './coordinateSync';
import type { VariableMapping } from './variableSync';

/**
 * The decision behind "the point you clicked is now a $lat/$lng pair".
 * Everything runs against literal values — no kepler, no store. The quiet
 * cases carry the semantics: kepler's pin *toggles*, so the second click on
 * the map unpins (null) and must not touch the variables — the coverage query
 * keeps its last centre until the user pins somewhere else — and an entry
 * reset (undefined) is the system's doing, never a gesture.
 */

const pair: VariableMapping = { field: '', variable: 'lat', variableTo: 'lng', source: 'coordinate' };

describe('coordinateWrites', () => {
  it('writes the pinned coordinate as a lat/lng variable pair', () => {
    // kepler hands the pin in [lng, lat] order; the variables are named the
    // other way round, which is the order people write coordinates in.
    expect(coordinateWrites({ coordinate: [-78.9836, -2.8949], mappings: [pair], variableValues: {} })).toEqual({
      lat: '-2.8949',
      lng: '-78.9836',
    });
  });

  it('rounds to six decimals so a pin does not smear picking noise into the URL', () => {
    expect(
      coordinateWrites({ coordinate: [-78.98362719012345, -2.89491234567], mappings: [pair], variableValues: {} })
    ).toEqual({ lat: '-2.894912', lng: '-78.983627' });
  });

  it('writes nothing on an unpin — the variables keep the last coordinate', () => {
    expect(coordinateWrites({ coordinate: null, mappings: [pair], variableValues: { lat: '-2.8949' } })).toEqual({});
  });

  it('writes nothing when there is no pin state at all', () => {
    expect(coordinateWrites({ coordinate: undefined, mappings: [pair], variableValues: {} })).toEqual({});
  });

  it('skips a variable that already holds the value', () => {
    expect(
      coordinateWrites({
        coordinate: [-78.9836, -2.8949],
        mappings: [pair],
        variableValues: { lat: '-2.8949', lng: '-79.01' },
      })
    ).toEqual({ lng: '-78.9836' });
  });

  it('compares numerically, so a re-pin on the same spot is quiet whatever the URL format', () => {
    expect(
      coordinateWrites({
        coordinate: [-78.98360000001, -2.89490000001],
        mappings: [pair],
        variableValues: { lat: '-2.8949', lng: '-78.9836' },
      })
    ).toEqual({});
  });

  it('serves a mapping that names only the lat variable', () => {
    const latOnly: VariableMapping = { field: '', variable: 'lat', source: 'coordinate' };
    expect(coordinateWrites({ coordinate: [-78.9836, -2.8949], mappings: [latOnly], variableValues: {} })).toEqual({
      lat: '-2.8949',
    });
  });

  it('skips a mapping with no variable named', () => {
    const empty: VariableMapping = { field: '', variable: '', source: 'coordinate' };
    expect(coordinateWrites({ coordinate: [-78.9836, -2.8949], mappings: [empty], variableValues: {} })).toEqual({});
  });

  it('serves several coordinate mappings at once', () => {
    const second: VariableMapping = { field: '', variable: 'centerLat', variableTo: 'centerLng', source: 'coordinate' };
    expect(
      coordinateWrites({ coordinate: [-78.9836, -2.8949], mappings: [pair, second], variableValues: {} })
    ).toEqual({ lat: '-2.8949', lng: '-78.9836', centerLat: '-2.8949', centerLng: '-78.9836' });
  });

  it('ignores a malformed pin rather than writing garbage into SQL', () => {
    expect(
      coordinateWrites({ coordinate: [Number.NaN, -2.89] as [number, number], mappings: [pair], variableValues: {} })
    ).toEqual({});
  });
});
