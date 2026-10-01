import { IconLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';

import { MarkerDrag } from './markerDrag';
import { DraggableMarkersLayer } from './markersDeckLayer';
import {
  anchorToTerrain,
  cachedElevation,
  centreElevation,
  terrainModelMatrix,
  type TerrainAnchor,
} from './terrainAnchor';

/**
 * Which of kepler's deck layers stand on the relief, and how: the centre's
 * elevation as a model matrix, each point's as its z. Real deck layers,
 * constructed and cloned but never drawn.
 */

const anchor: TerrainAnchor = { centre: 2500, version: 7, elevationAt: (lng) => (lng > 0 ? 2800 : 2400) };

const keplerLayers = [
  { id: 'sym', type: 'symbol' },
  { id: 'sym-2', type: 'point' },
  { id: 'refs', type: 'markers' },
];

const at = (layer: unknown, row: unknown) =>
  (layer as { props: { getPosition: (row: unknown, info: unknown) => number[] } }).props.getPosition(row, {});

describe('terrainModelMatrix', () => {
  it('lowers z by the centre elevation and leaves the rest alone', () => {
    const m = terrainModelMatrix(2500);
    // Column-major: the translation is the fourth column.
    expect(m.slice(12)).toEqual([0, 0, -2500, 1]);
    expect([m[0], m[5], m[10]]).toEqual([1, 1, 1]);
  });
});

describe('anchorToTerrain', () => {
  const rows = [{ position: [1, 0, 0] }, { position: [-1, 0, 50] }];
  const symbols = () =>
    new IconLayer({
      id: 'sym-symbol',
      data: rows,
      getPosition: (row: { position: number[] }) => row.position as [number, number, number],
      updateTriggers: { getPosition: 'kepler', getColor: 'c' },
    });

  it('lifts each symbol to the ground under it, keeping a height it already has above it', () => {
    const [lifted] = anchorToTerrain([symbols()], keplerLayers, anchor) as IconLayer[];
    expect(at(lifted, rows[0])).toEqual([1, 0, 2800]);
    expect(at(lifted, rows[1])).toEqual([-1, 0, 2450]);
    expect(lifted.props.modelMatrix).toEqual(terrainModelMatrix(2500));
  });

  it('reads the positions again when the relief changes, and keeps the triggers it had', () => {
    const [lifted] = anchorToTerrain([symbols()], keplerLayers, anchor) as IconLayer[];
    expect(lifted.props.updateTriggers).toEqual({ getPosition: { was: 'kepler', terrain: 7 }, getColor: 'c' });
  });

  it("lifts the symbols' labels, shadow and outline, which are named after the layer", () => {
    const label = new TextLayer({
      id: 'sym-label-name',
      data: rows,
      getPosition: (row: { position: number[] }) => row.position as [number, number, number],
    });
    const [lifted] = anchorToTerrain([label], keplerLayers, anchor) as TextLayer[];
    expect(at(lifted, rows[0])).toEqual([1, 0, 2800]);
  });

  it('leaves a layer whose id only begins like a symbol layer’s', () => {
    const points = new ScatterplotLayer({
      id: 'sym-2',
      data: rows,
      getPosition: (row: { position: number[] }) => row.position as [number, number, number],
    });
    const layers = [points];
    expect(anchorToTerrain(layers, keplerLayers, anchor)).toBe(layers);
  });

  it('hands the markers the relief, for them to lift their own positions', () => {
    const markers = new DraggableMarkersLayer({ id: 'refs-markers', markers: [], drag: new MarkerDrag() } as never);
    const [lifted] = anchorToTerrain([markers], keplerLayers, anchor) as DraggableMarkersLayer[];
    expect(lifted).toBeInstanceOf(DraggableMarkersLayer);
    expect(lifted.props.terrain).toBe(anchor);
    expect(lifted.props.modelMatrix).toEqual(terrainModelMatrix(2500));
  });

  it('reads the positions again once the relief is gone, without lifting them', () => {
    // kepler's symbol layer names no trigger for its positions: without one of
    // ours on a flat map, deck would keep the lifted ones and draw them
    // thousands of metres up, out of sight, once the model matrix is dropped.
    const asKepler = () =>
      new IconLayer({
        id: 'sym-symbol',
        data: rows,
        getPosition: (row: { position: number[] }) => row.position as [number, number, number],
        updateTriggers: { getColor: 'c' },
      });
    const [lifted] = anchorToTerrain([asKepler()], keplerLayers, anchor) as IconLayer[];
    const [flat] = anchorToTerrain([asKepler()], keplerLayers, null) as IconLayer[];
    // deck skips a trigger the new props leave out, so one must be there.
    expect(flat.props.updateTriggers.getPosition).toBeDefined();
    expect(flat.props.updateTriggers.getPosition).not.toEqual(lifted.props.updateTriggers.getPosition);
    expect(flat.props.modelMatrix).toBeFalsy();
    expect(at(flat, rows[1])).toEqual([-1, 0, 50]);
  });

  it('leaves every layer alone when there is nothing to stand on the relief', () => {
    const layers = [symbols()];
    expect(anchorToTerrain(layers, [{ id: 'sym-2', type: 'point' }], null)).toBe(layers);
  });
});

describe('cachedElevation', () => {
  it('asks MapLibre once per point and reads no relief as the ground at sea level', () => {
    const query = jest.fn((lngLat: [number, number]) => (lngLat[0] > 0 ? 1234 : null));
    const elevationAt = cachedElevation(query);
    expect(elevationAt(1, 2)).toBe(1234);
    expect(elevationAt(1, 2)).toBe(1234);
    expect(elevationAt(-1, 2)).toBe(0);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('centreElevation', () => {
  it('reads the ground under the centre, or 0 without a centre', () => {
    expect(centreElevation(() => 2500, -79, -2.9)).toBe(2500);
    expect(centreElevation(() => 2500, undefined, -2.9)).toBe(0);
  });
});
