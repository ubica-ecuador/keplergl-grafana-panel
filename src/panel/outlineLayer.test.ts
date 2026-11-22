import { FieldType, toDataFrame } from '@grafana/data';
import { registerEntry, updateMap, wrapTo } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { framesToDatasets } from '../data/framesToDatasets';
import { KEPLER_INSTANCE_ID } from './constants';
import { captureMapConfig, loadDatasets } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';
import { wantsOutline } from './outlineLayer';

/**
 * A catalog's boxes are drawn as outlines when its data source says so
 * (`meta.custom.layer.outline`), and every other polygon layer is filled as
 * kepler fills it. Run on kepler's real store.
 */

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function newMap(): Store {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
  store.dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap({ width: 800, height: 600 } as never, 0)));
  return store;
}

// GeoJSON, not the WKT a Spatial Catalog sends: kepler reads WKT through a loader jest does not run, and a shape it
// cannot read has no feature type for the layer to go by.
const box = (w: number, s: number, e: number, n: number) =>
  JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  });
const BOXES = [box(-81, -5, -75, 1.5), box(-80, -4, -78, -2)];

const frame = (values: string[], custom?: unknown) =>
  toDataFrame({
    refId: 'A',
    name: 'catalog',
    fields: [
      { name: 'title', type: FieldType.string, values: values.map((_, i) => `entry ${i}`) },
      { name: 'footprint', type: FieldType.string, values },
    ],
    ...(custom ? { meta: { custom } as never } : {}),
  });

const polygonLayers = (store: Store) => {
  const layers = (store.getState() as any).keplerGl[KEPLER_INSTANCE_ID].visState.layers as Array<{
    type: string;
    config: { visConfig: { filled?: boolean; stroked?: boolean } };
  }>;
  return layers.filter((layer) => layer.type === 'geojson').map((layer) => layer.config.visConfig);
};

describe('wantsOutline', () => {
  it('reads the flag the dataset carries, and nothing else', () => {
    expect(wantsOutline({ metadata: { outline: true } })).toBe(true);
    expect(wantsOutline({ metadata: { outline: 'true' } })).toBe(false);
    expect(wantsOutline({ metadata: { attributions: ['x'] } })).toBe(false);
    expect(wantsOutline(null)).toBe(false);
  });
});

describe('a catalog’s boxes', () => {
  it('leave points as kepler draws them', async () => {
    const store = newMap();
    const points = [JSON.stringify({ type: 'Point', coordinates: [-79, -2.9] })];
    loadDatasets(store, store.dispatch, framesToDatasets([frame(points, { layer: { outline: true } })]));
    await settle();

    const [visConfig] = polygonLayers(store);
    expect(visConfig).toMatchObject({ filled: true, stroked: false });
  });

  it('are drawn as outlines when the frame says they are', async () => {
    const store = newMap();
    loadDatasets(store, store.dispatch, framesToDatasets([frame(BOXES, { layer: { outline: true } })]));
    await settle();

    const [visConfig] = polygonLayers(store);
    expect(visConfig).toMatchObject({ filled: false, stroked: true });
  });

  it('are filled, as kepler fills polygons, when the frame says nothing', async () => {
    const store = newMap();
    loadDatasets(store, store.dispatch, framesToDatasets([frame(BOXES)]));
    await settle();

    const [visConfig] = polygonLayers(store);
    expect(visConfig).toMatchObject({ filled: true });
  });

  it('keep the fill a saved map turned back on', async () => {
    const outlined = () => framesToDatasets([frame(BOXES, { layer: { outline: true } })]);
    const first = newMap();
    loadDatasets(first, first.dispatch, outlined());
    await settle();
    const saved = captureMapConfig(first)!;
    const layer = (saved.config as any).visState.layers.find((l: { type: string }) => l.type === 'geojson');
    layer.config.visConfig.filled = true;

    const store = newMap();
    loadDatasets(store, store.dispatch, outlined(), {}, saved);
    await settle();

    const [visConfig] = polygonLayers(store);
    expect(visConfig).toMatchObject({ filled: true });
  });
});
