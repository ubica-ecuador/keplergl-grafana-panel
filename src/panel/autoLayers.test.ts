import { supersededLayerIds } from './autoLayers';

/**
 * kepler builds a default Trip layer whenever a dataset has a column literally
 * named `id` alongside coordinates and a timestamp — which `SELECT *` on a
 * trajectory table routinely has. It groups by that per-row id, so every GPS
 * ping becomes its own one-point "trip": thousands of degenerate features next
 * to the layer the panel built from the real trip id.
 */
describe('supersededLayerIds', () => {
  const ours = { id: 'trip-grafana-A', type: 'trip', dataId: 'grafana-A' };

  it("drops kepler's own trip layer for the same dataset", () => {
    const layers = [
      { id: 'auto1', type: 'point', config: { dataId: 'grafana-A' } },
      { id: 'auto2', type: 'trip', config: { dataId: 'grafana-A' } },
      { id: 'trip-grafana-A', type: 'trip', config: { dataId: 'grafana-A' } },
    ];

    expect(supersededLayerIds(layers, ours)).toEqual(['auto2']);
  });

  it('keeps trip layers belonging to another query', () => {
    const layers = [
      { id: 'auto2', type: 'trip', config: { dataId: 'grafana-B' } },
      { id: 'trip-grafana-A', type: 'trip', config: { dataId: 'grafana-A' } },
    ];

    expect(supersededLayerIds(layers, ours)).toEqual([]);
  });

  it('never drops layers of another type, whatever kepler inferred', () => {
    const layers = [
      { id: 'auto1', type: 'point', config: { dataId: 'grafana-A' } },
      { id: 'auto3', type: 'geojson', config: { dataId: 'grafana-A' } },
    ];

    expect(supersededLayerIds(layers, ours)).toEqual([]);
  });

  it('leaves flow layers alone — kepler never guesses those', () => {
    const layers = [
      { id: 'auto2', type: 'trip', config: { dataId: 'grafana-A' } },
      { id: 'flow-grafana-A', type: 'flow', config: { dataId: 'grafana-A' } },
    ];

    expect(supersededLayerIds(layers, { id: 'flow-grafana-A', type: 'flow', dataId: 'grafana-A' })).toEqual([]);
  });
});

/**
 * A velocity grid is a lattice of coordinates, so kepler draws it as points. The
 * dots are the grid itself — honest, and not what the query is about: the flow
 * *through* them is, and that is the layer the panel adds.
 */
describe('supersededLayerIds — flow fields', () => {
  const ours = { id: 'flowfield-grafana-A', type: 'flowfield', dataId: 'grafana-A' };

  it("drops kepler's point layer for the same grid", () => {
    const layers = [
      { id: 'auto1', type: 'point', config: { dataId: 'grafana-A' } },
      { id: 'flowfield-grafana-A', type: 'flowfield', config: { dataId: 'grafana-A' } },
    ];

    expect(supersededLayerIds(layers, ours)).toEqual(['auto1']);
  });

  it('keeps the point layer of another query, which may be all that query is', () => {
    const layers = [{ id: 'auto1', type: 'point', config: { dataId: 'grafana-B' } }];

    expect(supersededLayerIds(layers, ours)).toEqual([]);
  });

  it('drops the Flow Field kepler guesses from the same `u`/`v` columns', () => {
    // kepler 3.3.0-alpha.12 ships a flow field of its own and creates it for
    // any dataset with columns named `u` and `v` beside coordinates — the very
    // grid this panel traces — so the map would draw two sets of streamlines.
    const layers = [
      { id: 'auto1', type: 'point', config: { dataId: 'grafana-A' } },
      { id: 'auto2', type: 'flowField', config: { dataId: 'grafana-A' } },
      { id: 'flowfield-grafana-A', type: 'flowfield', config: { dataId: 'grafana-A' } },
    ];

    expect(supersededLayerIds(layers, ours)).toEqual(['auto1', 'auto2']);
  });

  it("keeps kepler's Flow Field on another query", () => {
    const layers = [{ id: 'auto2', type: 'flowField', config: { dataId: 'grafana-B' } }];

    expect(supersededLayerIds(layers, ours)).toEqual([]);
  });

  it('never drops a second flow field on the same grid', () => {
    // Two fields over one dataset is a deliberate act: a user comparing
    // densities, or colouring one by speed and leaving the other plain.
    const layers = [
      { id: 'other', type: 'flowfield', config: { dataId: 'grafana-A' } },
      { id: 'flowfield-grafana-A', type: 'flowfield', config: { dataId: 'grafana-A' } },
    ];

    expect(supersededLayerIds(layers, ours)).toEqual([]);
  });
});

describe('supersededLayerIds: symbols', () => {
  it('replaces the point layer kepler guesses from the same coordinates', () => {
    const layers = [
      { id: 'guessed', type: 'point', config: { dataId: 'grafana-A' } },
      { id: 'symbol-grafana-A', type: 'symbol', config: { dataId: 'grafana-A' } },
    ];

    expect(supersededLayerIds(layers, { id: 'symbol-grafana-A', type: 'symbol', dataId: 'grafana-A' })).toEqual([
      'guessed',
    ]);
  });
});
