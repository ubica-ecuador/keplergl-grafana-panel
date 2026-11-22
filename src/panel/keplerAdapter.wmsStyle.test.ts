import type { Store } from 'redux';

import type { WmsDataset } from '../data/wmsDataset';
import { KEPLER_INSTANCE_ID } from './constants';
import { applyWmsStyle, readLayersShown, refreshWms } from './keplerAdapter';

const SERVICE = 'https://maps.dwd.de/geoserver/ows';
const LAYER = 'dwd:Autowarn_Analyse';

/** A store holding a WMS dataset and kepler's layer on it, as far as these functions read them. */
function fakeStore(
  layer: { visConfig?: Record<string, unknown>; isVisible?: boolean; label?: string } = {},
  more: Array<{ dataId: string; isVisible?: boolean; label?: string }> = []
): Store {
  return {
    getState: () => ({
      keplerGl: {
        [KEPLER_INSTANCE_ID]: {
          visState: {
            layers: [
              {
                id: 'grafana-A-wms-layer',
                type: 'wms',
                config: {
                  dataId: 'grafana-A-wms',
                  label: layer.label ?? 'Warnings',
                  isVisible: layer.isVisible ?? true,
                  visConfig: { wmsLayer: { name: LAYER }, ...layer.visConfig },
                },
              },
              ...more.map((other, index) => ({
                id: `layer-${index}`,
                config: { dataId: other.dataId, label: other.label, isVisible: other.isVisible ?? true, visConfig: {} },
              })),
            ],
            datasets: { 'grafana-A-wms': { type: 'wms-tile', metadata: { tilesetDataUrl: SERVICE } } },
          },
        },
      },
    }),
  } as unknown as Store;
}

const wms = (style?: string): WmsDataset => ({
  id: 'grafana-A-wms',
  label: 'A',
  serviceUrl: SERVICE,
  layerName: LAYER,
  times: [],
  bbox: null,
  ...(style ? { style } : {}),
});

describe('applyWmsStyle', () => {
  it('puts the style on the layer it draws with, in one visConfig change', () => {
    const dispatch = jest.fn();

    expect(applyWmsStyle(fakeStore(), dispatch, 'grafana-A-wms', 'autowarn_analyse_severity')).toBe(true);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(dispatch.mock.calls[0][0])).toContain('"wmsStyle":"autowarn_analyse_severity"');
  });

  it('is quiet when the layer already draws that style, an absent one and an empty one alike', () => {
    const dispatch = jest.fn();

    applyWmsStyle(fakeStore({ visConfig: { wmsStyle: 'severity' } }), dispatch, 'grafana-A-wms', 'severity');
    applyWmsStyle(fakeStore(), dispatch, 'grafana-A-wms', undefined);
    applyWmsStyle(fakeStore({ visConfig: { wmsStyle: '' } }), dispatch, 'grafana-A-wms', '');

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('goes back to the service default when the query stops naming one', () => {
    const dispatch = jest.fn();

    applyWmsStyle(fakeStore({ visConfig: { wmsStyle: 'severity' } }), dispatch, 'grafana-A-wms', undefined);

    expect(JSON.stringify(dispatch.mock.calls[0][0])).toContain('"wmsStyle":""');
  });

  it('reports that there is no layer yet, so the caller asks again', () => {
    const dispatch = jest.fn();

    expect(applyWmsStyle(fakeStore(), dispatch, 'grafana-B-wms', 'severity')).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('refreshWms', () => {
  it('rebuilds nothing when only the style changed: the layer and the view stay as they are', () => {
    const dispatch = jest.fn();

    refreshWms(fakeStore({ visConfig: { wmsStyle: 'types' } }), dispatch, [wms('severity')]);

    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('readLayersShown', () => {
  it('says whether each dataset has a layer shown, under its label, and leaves out one with none yet', () => {
    const store = fakeStore({ label: 'Storm warnings' }, [{ dataId: 'grafana-B-esri', isVisible: false }]);

    expect(readLayersShown(store, ['grafana-A-wms', 'grafana-B-esri', 'grafana-C-wms'])).toEqual([
      { dataId: 'grafana-A-wms', label: 'Storm warnings', visible: true },
      { dataId: 'grafana-B-esri', label: '', visible: false },
    ]);
  });
});
