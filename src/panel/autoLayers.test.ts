import { supersededTripLayerIds } from './autoLayers';

/**
 * kepler builds a default Trip layer whenever a dataset has a column literally
 * named `id` alongside coordinates and a timestamp — which `SELECT *` on a
 * trajectory table routinely has. It groups by that per-row id, so every GPS
 * ping becomes its own one-point "trip": thousands of degenerate features next
 * to the layer the panel built from the real trip id.
 */
describe('supersededTripLayerIds', () => {
  const ours = { id: 'trip-grafana-A', type: 'trip', dataId: 'grafana-A' };

  it("drops kepler's own trip layer for the same dataset", () => {
    const layers = [
      { id: 'auto1', type: 'point', config: { dataId: 'grafana-A' } },
      { id: 'auto2', type: 'trip', config: { dataId: 'grafana-A' } },
      { id: 'trip-grafana-A', type: 'trip', config: { dataId: 'grafana-A' } },
    ];

    expect(supersededTripLayerIds(layers, ours)).toEqual(['auto2']);
  });

  it('keeps trip layers belonging to another query', () => {
    const layers = [
      { id: 'auto2', type: 'trip', config: { dataId: 'grafana-B' } },
      { id: 'trip-grafana-A', type: 'trip', config: { dataId: 'grafana-A' } },
    ];

    expect(supersededTripLayerIds(layers, ours)).toEqual([]);
  });

  it('never drops layers of another type, whatever kepler inferred', () => {
    const layers = [
      { id: 'auto1', type: 'point', config: { dataId: 'grafana-A' } },
      { id: 'auto3', type: 'geojson', config: { dataId: 'grafana-A' } },
    ];

    expect(supersededTripLayerIds(layers, ours)).toEqual([]);
  });

  it('leaves flow layers alone — kepler never guesses those', () => {
    const layers = [
      { id: 'auto2', type: 'trip', config: { dataId: 'grafana-A' } },
      { id: 'flow-grafana-A', type: 'flow', config: { dataId: 'grafana-A' } },
    ];

    expect(supersededTripLayerIds(layers, { id: 'flow-grafana-A', type: 'flow', dataId: 'grafana-A' })).toEqual([]);
  });
});
