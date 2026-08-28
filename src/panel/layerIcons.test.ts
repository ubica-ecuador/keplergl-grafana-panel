import { makeCogPaintedLayer } from './cogPaintedLayer';
import { makeEsriImageLayer } from './esriImageLayer';
import { makeFlowFieldLayer } from './flowFieldLayer';
import { makeZarrLayer } from './zarrTileLayer';

/**
 * The icon each of the plugin's own layers shows in kepler's panel.
 *
 * kepler picks one from a layer's `layerIcon`, and a layer that declares none
 * gets the base class's placeholder — which is what all four of these were
 * showing, indistinguishable from each other in the layer list and in "Add
 * Layer".
 *
 * The icon is handed to the factory rather than imported, for the reason the
 * base class and the deck factory already are: these modules stay free of
 * kepler so they can be exercised with stubs.
 */

/** A stand-in for kepler's base Layer, with only what the subclasses touch. */
class FakeBaseLayer {
  config: { visConfig: Record<string, unknown>; isVisible?: boolean } = { visConfig: {}, isVisible: true };
  id = 'layer-1';
  visConfigSettings: Record<string, unknown> = {};
  constructor(_props?: unknown) {}
  registerVisConfig(configs: Record<string, string>) {
    for (const key of Object.keys(configs)) {
      this.visConfigSettings[key] = {};
    }
  }
  shouldRenderLayer(): boolean {
    return false;
  }
}

const RasterIcon = () => null;
const ArcIcon = () => null;
const build = () => ({});
const camera = () => ({}) as never;

const make = (Klass: unknown) => new (Klass as new (p?: unknown) => { layerIcon: unknown })();

describe('the icon each own layer shows', () => {
  it('gives the painted COG the icon it was handed', () => {
    expect(make(makeCogPaintedLayer(FakeBaseLayer, build, RasterIcon)).layerIcon).toBe(RasterIcon);
  });

  it('gives the Image Service the icon it was handed', () => {
    expect(make(makeEsriImageLayer(FakeBaseLayer, build, RasterIcon)).layerIcon).toBe(RasterIcon);
  });

  it('gives the Zarr layer the icon it was handed', () => {
    expect(make(makeZarrLayer(FakeBaseLayer, build, RasterIcon)).layerIcon).toBe(RasterIcon);
  });

  it('gives the flow field the icon it was handed', () => {
    expect(make(makeFlowFieldLayer(FakeBaseLayer, build, camera, ArcIcon)).layerIcon).toBe(ArcIcon);
  });

  it('leaves the base class’s icon alone when none is given', () => {
    // The factories are called without an icon in the tests that predate this,
    // and a layer that suddenly reported `undefined` would render a blank space
    // where kepler draws its placeholder.
    const Klass = makeZarrLayer(
      class extends FakeBaseLayer {
        get layerIcon() {
          return 'placeholder';
        }
      },
      build
    );

    expect(make(Klass).layerIcon).toBe('placeholder');
  });
});
