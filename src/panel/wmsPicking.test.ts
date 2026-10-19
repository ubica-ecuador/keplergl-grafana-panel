import { LayerClasses } from '@kepler.gl/layers';

import { withWmsPicking } from './wmsPicking';

/**
 * A WMS layer answers clicks unless the map says otherwise: the panel's click
 * variables read `GetFeatureInfo`, which kepler only asks for on a pickable
 * layer, and kepler.gl 3.3.0-alpha.16 made picking follow a switch that starts
 * off.
 */

type WmsLayer = {
  config: { visConfig: Record<string, unknown> };
  visConfigSettings: Record<string, { defaultValue?: unknown } | undefined>;
  updateLayerVisConfig(change: Record<string, unknown>): void;
};

const WMS = LayerClasses.wms as unknown as new (props: Record<string, unknown>) => WmsLayer;
const PickableWMS = withWmsPicking(WMS);
const PROPS = { dataId: 'wms', label: 'WMS' };

describe('withWmsPicking', () => {
  it("is needed: kepler's own WMS layer starts with Allow hover off", () => {
    expect(new WMS(PROPS).config.visConfig.allowHover).toBe(false);
  });

  it('starts the switch on, in the layer and in what the side panel offers', () => {
    const layer = new PickableWMS(PROPS);
    expect(layer.config.visConfig.allowHover).toBe(true);
    expect(layer.visConfigSettings.allowHover?.defaultValue).toBe(true);
  });

  it('still lets the map turn it off', () => {
    const layer = new PickableWMS(PROPS);
    layer.updateLayerVisConfig({ allowHover: false });
    expect(layer.config.visConfig.allowHover).toBe(false);
  });

  it('is still a WMS layer', () => {
    expect(new PickableWMS(PROPS)).toBeInstanceOf(WMS);
  });
});
