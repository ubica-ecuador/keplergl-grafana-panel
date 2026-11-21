import { toDataFrame } from '@grafana/data';

import { frameLayerOf, layerBoxOf } from './frameLayer';

const frameWith = (custom: unknown) => toDataFrame({ refId: 'A', fields: [], meta: { custom } as never });

describe('frameLayerOf', () => {
  it('reads the key and the box a frame names', () => {
    expect(frameLayerOf(frameWith({ layer: { key: 'cat|vector|a', bbox: [-81, -5, -75, 1.5] } }))).toEqual({
      key: 'cat|vector|a',
      bbox: [-81, -5, -75, 1.5],
    });
  });

  it('takes a layer with no box, or a null one', () => {
    expect(frameLayerOf(frameWith({ layer: { key: 'k' } }))).toEqual({ key: 'k', bbox: null });
    expect(frameLayerOf(frameWith({ layer: { key: 'k', bbox: null } }))).toEqual({ key: 'k', bbox: null });
  });

  it('names no layer without a key', () => {
    expect(frameLayerOf(toDataFrame({ refId: 'A', fields: [] }))).toBeNull();
    expect(frameLayerOf(frameWith({ tileServerUrl: 'https://tiles.example.org' }))).toBeNull();
    expect(frameLayerOf(frameWith({ layer: { key: '' } }))).toBeNull();
    expect(frameLayerOf(frameWith({ layer: { key: 3, bbox: [0, 0, 1, 1] } }))).toBeNull();
    expect(frameLayerOf(frameWith({ layer: 'k' }))).toBeNull();
  });
});

describe('layerBoxOf', () => {
  it('keeps a point, and a box across the antimeridian', () => {
    expect(layerBoxOf([-79, -2.9, -79, -2.9])).toEqual([-79, -2.9, -79, -2.9]);
    expect(layerBoxOf([170, -20, -170, -10])).toEqual([170, -20, -170, -10]);
  });

  it('pulls a box a hair outside the world back to its edge', () => {
    expect(layerBoxOf([-180.0000001, -90, 180, 90.0000001])).toEqual([-180, -90, 180, 90]);
  });

  it('refuses what is not a box in degrees', () => {
    expect(layerBoxOf([0, 10, 1, 5])).toBeNull();
    expect(layerBoxOf([0, 0, 1])).toBeNull();
    expect(layerBoxOf([0, 0, 1, Number.NaN])).toBeNull();
    expect(layerBoxOf([500000, 4000000, 600000, 4100000])).toBeNull();
    expect(layerBoxOf('0 0 1 1')).toBeNull();
  });
});
