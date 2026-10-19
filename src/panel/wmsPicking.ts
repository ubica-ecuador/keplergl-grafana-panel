/**
 * The WMS layer picking as it did before kepler.gl 3.3.0-alpha.16.
 *
 * alpha.16 gave the WMS layer the **Allow hover** switch the point, GeoJSON and
 * raster tile layers already had, but off by default where theirs is on
 * (keplergl/kepler.gl#3791), and made the layer pickable only while it is on.
 * In this panel a click on a WMS layer is what asks the service for the value
 * under the pointer (`GetFeatureInfo`) and writes it to the dashboard's click
 * variables. With the switch off by default, every saved map with a queryable
 * WMS would have stopped answering clicks, with nothing on screen to say why.
 *
 * So the panel's WMS layer starts with the switch on, as kepler's other layers
 * do. A saved map that turned it off keeps it off; one saved before the switch
 * existed gets it on, which is how it behaved when it was saved.
 */

interface VisConfigurable {
  visConfigSettings: Record<string, Record<string, unknown> | undefined>;
  registerVisConfig(settings: Record<string, unknown>): void;
}

// The usual mixin constructor type; see `wmsTimeLayer.ts` for why `any[]`.
type Constructor<T> = new (...args: any[]) => T;

/** Wraps a WMS layer class so its **Allow hover** switch, and with it picking, starts on. */
export function withWmsPicking<C extends Constructor<object>>(WMSLayer: C): C {
  class PickableWMSLayer extends (WMSLayer as Constructor<VisConfigurable>) {
    constructor(...args: any[]) {
      super(...args);
      const allowHover = this.visConfigSettings.allowHover;
      if (allowHover) {
        this.registerVisConfig({ allowHover: { ...allowHover, defaultValue: true } });
      }
    }
  }

  return PickableWMSLayer as unknown as C;
}
