import { makeCogPaintedLayer } from './cogPaintedLayer';
import { makeEsriImageLayer } from './esriImageLayer';
import { makeZarrLayer } from './zarrTileLayer';

/**
 * The id kepler gives a layer this plugin's datasets produce.
 *
 * Left alone, kepler mints a random hash — and a random id cannot be written
 * down. That is what stopped a saved map configuration from addressing one of
 * these layers at all: `splitMaps`, which says which layers each half of a
 * split map draws, is keyed by layer id, so a dashboard could not open already
 * split. Deriving the id from the dataset makes it something a dashboard can
 * name.
 *
 * kepler uses `props.id` when `findDefaultLayerProps` provides one — its base
 * layer constructor is `this.id = props.id || generateHashId(...)`.
 */
class FakeBaseLayer {
  config: Record<string, unknown> = { visConfig: {} };
  id = 'x';
  visConfigSettings: Record<string, unknown> = {};
  constructor(_props?: unknown) {}
  registerVisConfig() {}
  shouldRenderLayer() {
    return false;
  }
}

const build = () => ({});

const CASOS: Array<[string, any, string]> = [
  ['painted COG', makeCogPaintedLayer(FakeBaseLayer, build), 'cogPainted'],
  ['Image Service', makeEsriImageLayer(FakeBaseLayer, build), 'esriImage'],
  ['Zarr', makeZarrLayer(FakeBaseLayer, build), 'zarr'],
];

describe('the id each own layer proposes', () => {
  it.each(CASOS)('derives a %s layer id from its dataset', (_name, Klass, type) => {
    const { props } = Klass.findDefaultLayerProps({ type, id: 'grafana-A-esri', label: 'Cobertura' });

    expect(props[0].id).toBe('grafana-A-esri-layer');
  });

  it.each(CASOS)('gives a %s layer the same id every time, so it can be written down', (_name, Klass, type) => {
    const once = Klass.findDefaultLayerProps({ type, id: 'grafana-B-esri' }).props[0].id;
    const twice = Klass.findDefaultLayerProps({ type, id: 'grafana-B-esri' }).props[0].id;

    expect(once).toBe(twice);
  });

  it('keeps two datasets apart', () => {
    const [Klass, type] = [CASOS[1][1], CASOS[1][2]];
    const a = Klass.findDefaultLayerProps({ type, id: 'grafana-A-esri' }).props[0].id;
    const b = Klass.findDefaultLayerProps({ type, id: 'grafana-B-esri' }).props[0].id;

    expect(a).not.toBe(b);
  });
});
