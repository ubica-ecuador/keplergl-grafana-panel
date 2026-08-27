import { WMS_VALUE_FIELD, decideClickPublish, rowFieldValue, wmsFeatureValues } from './clickSync';
import type { VariableMapping } from './variableSync';

/**
 * The decision behind "the entity you clicked is now a dashboard variable".
 * Everything runs against literal values — no kepler, no store. The cases that
 * matter most are the quiet ones: a data refresh resets kepler's clicked state
 * to undefined, which must never read as the user deselecting, and a dashboard
 * opened from a shared link must keep its variable until the user actually
 * clicks something.
 */

const vehicle: VariableMapping = { field: 'vehicle_id', variable: 'vehicle', source: 'click' };
const route: VariableMapping = { field: 'route', variable: 'routeVar', source: 'click' };

describe('rowFieldValue', () => {
  it('reads a DataRow through valueAt', () => {
    const row = { valueAt: (idx: number) => ['v7', 'r1'][idx] };
    expect(rowFieldValue(row, 1)).toBe('r1');
  });

  it('reads a plain row array by index', () => {
    // Trip layers in table mode hand back the vertex row as an array.
    expect(rowFieldValue(['v7', 'r1'], 0)).toBe('v7');
  });

  it('is undefined for a missing row', () => {
    expect(rowFieldValue(null, 0)).toBeUndefined();
    expect(rowFieldValue(undefined, 0)).toBeUndefined();
  });

  it('is undefined for a row of an unknown shape', () => {
    expect(rowFieldValue({ some: 'object' }, 0)).toBeUndefined();
  });
});

describe('decideClickPublish', () => {
  it('publishes the clicked entity to the mapped variable', () => {
    expect(
      decideClickPublish({
        selection: { vehicle_id: 'v7' },
        mappings: [vehicle],
        variableValues: {},
        published: false,
      })
    ).toEqual({ writes: { vehicle: 'v7' }, published: true });
  });

  it('coerces a numeric identity to a string', () => {
    expect(
      decideClickPublish({ selection: { vehicle_id: 42 }, mappings: [vehicle], variableValues: {}, published: false })
    ).toEqual({ writes: { vehicle: '42' }, published: true });
  });

  it('serves every mapping that resolves on the clicked entity', () => {
    expect(
      decideClickPublish({
        selection: { vehicle_id: 'v7', route: 'r1' },
        mappings: [vehicle, route],
        variableValues: {},
        published: false,
      })
    ).toEqual({ writes: { vehicle: 'v7', routeVar: 'r1' }, published: true });
  });

  it('skips a mapping whose column the click did not resolve', () => {
    // The clicked layer has no `route` column; its variable must keep whatever
    // it holds rather than be blanked by an unrelated click.
    expect(
      decideClickPublish({
        selection: { vehicle_id: 'v7' },
        mappings: [vehicle, route],
        variableValues: { routeVar: 'r9' },
        published: false,
      })
    ).toEqual({ writes: { vehicle: 'v7' }, published: true });
  });

  it('skips a null identity rather than writing the string "null"', () => {
    expect(
      decideClickPublish({
        selection: { vehicle_id: null },
        mappings: [vehicle],
        variableValues: {},
        published: false,
      })
    ).toEqual({ writes: {}, published: false });
  });

  it('stays quiet when the click resolves no mapped column at all', () => {
    // A click on some other layer — a POI next to the trips — is not a
    // selection of nothing; it is no selection event for these mappings.
    expect(
      decideClickPublish({ selection: {}, mappings: [vehicle], variableValues: { vehicle: 'v7' }, published: true })
    ).toEqual({ writes: {}, published: true });
  });

  it('does not rewrite a variable that already holds the clicked value', () => {
    // Re-clicking the same entity (or clicking the entity a shared link already
    // named) must not push a redundant URL change through the dashboard.
    expect(
      decideClickPublish({
        selection: { vehicle_id: 'v7' },
        mappings: [vehicle],
        variableValues: { vehicle: 'v7' },
        published: false,
      })
    ).toEqual({ writes: {}, published: true });
  });

  it('reads 80 from the row and "80" from the URL as the same value', () => {
    expect(
      decideClickPublish({
        selection: { vehicle_id: 80 },
        mappings: [vehicle],
        variableValues: { vehicle: '80' },
        published: false,
      })
    ).toEqual({ writes: {}, published: true });
  });

  it('clears the variables when the user deselects after a publish', () => {
    // Clicking empty map (or closing the popover) is kepler's deselect gesture.
    expect(
      decideClickPublish({ selection: null, mappings: [vehicle], variableValues: { vehicle: 'v7' }, published: true })
    ).toEqual({ writes: { vehicle: '' }, published: false });
  });

  it('leaves the variables alone on deselect when this panel never published', () => {
    // The dashboard arrived at ?var-vehicle=v7 from a shared link; a stray
    // click on the map background must not clear it.
    expect(
      decideClickPublish({ selection: null, mappings: [vehicle], variableValues: { vehicle: 'v7' }, published: false })
    ).toEqual({ writes: {}, published: false });
  });

  it('does not write a clear over a variable that is already empty', () => {
    expect(
      decideClickPublish({ selection: null, mappings: [vehicle], variableValues: { vehicle: '' }, published: true })
    ).toEqual({ writes: {}, published: false });
  });

  it('ignores a system reset of the click state', () => {
    // A data refresh removes and re-merges the layers, which resets kepler's
    // clicked to undefined. That is not the user deselecting: publish nothing,
    // and keep remembering that the variables hold this panel's selection.
    expect(
      decideClickPublish({
        selection: undefined,
        mappings: [vehicle],
        variableValues: { vehicle: 'v7' },
        published: true,
      })
    ).toEqual({ writes: {}, published: true });
  });

  it('does nothing before anything is ever clicked', () => {
    expect(
      decideClickPublish({ selection: undefined, mappings: [vehicle], variableValues: {}, published: false })
    ).toEqual({ writes: {}, published: false });
  });
});

describe('wmsFeatureValues', () => {
  const clicked = {
    wmsFeatureInfo: [
      { name: 'GRAY INDEX', value: '12.5' },
      { name: 'STATION NAME', value: 'Cuenca' },
    ],
  };

  it('flattens what the service answered into publishable values', () => {
    expect(wmsFeatureValues(clicked)).toMatchObject({ 'GRAY INDEX': '12.5', 'STATION NAME': 'Cuenca' });
  });

  it('offers the server’s own spelling as well as kepler’s', () => {
    // kepler uppercases and turns underscores into spaces for its tooltip. The
    // column the service documents is `GRAY_INDEX`, and that is what someone
    // will type into a mapping.
    expect(wmsFeatureValues(clicked)).toMatchObject({ GRAY_INDEX: '12.5', STATION_NAME: 'Cuenca' });
  });

  it('publishes the first value under a name that is the same everywhere', () => {
    // A raster WMS answers with one band whose name is the server's business.
    expect(wmsFeatureValues(clicked)?.[WMS_VALUE_FIELD]).toBe('12.5');
  });

  it('is not a WMS click at all when there is no feature info', () => {
    expect(wmsFeatureValues({ vehicle_id: 'bus-1' })).toBeNull();
    expect(wmsFeatureValues(null)).toBeNull();
    expect(wmsFeatureValues(undefined)).toBeNull();
  });

  it('skips attributes with no name or no value rather than publishing blanks', () => {
    const partial = { wmsFeatureInfo: [{ name: '', value: '1' }, { name: 'GOOD', value: null }, { name: 'OK', value: '2' }] };

    expect(wmsFeatureValues(partial)).toEqual({ OK: '2', wms_value: '2' });
  });
});
