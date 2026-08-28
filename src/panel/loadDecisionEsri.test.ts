import { splitEsriRefresh } from './loadDecision';

const SERVICE = 'https://example.test/arcgis/rest/services/LandCover/ImageServer';
const OTHER = 'https://example.test/arcgis/rest/services/Other/ImageServer';

const RULE_2017 = '{"where":"Year=2017"}';

describe('splitEsriRefresh', () => {
  it('adds a service kepler does not hold yet', () => {
    const { add, keep, replace, remove } = splitEsriRefresh([{ id: 'grafana-A-esri', serviceUrl: SERVICE }], []);

    expect(add.map((one) => one.id)).toEqual(['grafana-A-esri']);
    expect([keep, replace, remove].every((list) => list.length === 0)).toBe(true);
  });

  it('keeps a service whose endpoint has not moved', () => {
    const { keep, replace } = splitEsriRefresh(
      [{ id: 'grafana-A-esri', serviceUrl: SERVICE }],
      [{ id: 'grafana-A-esri', serviceUrl: SERVICE }]
    );

    expect(keep.map((one) => one.id)).toEqual(['grafana-A-esri']);
    expect(replace).toHaveLength(0);
  });

  it('keeps a service whose mosaic rule moved, because that is not a rebuild', () => {
    // The rule chooses the year, and the year changes constantly — it rides in
    // the layer's visConfig, like the Zarr layer's time label. Rebuilding for
    // it would throw away whatever the user had named or faded, on every step.
    // The known side carries no rule at all, and that is the assertion: the
    // identity a refresh compares on simply does not look at it.
    const { keep, replace } = splitEsriRefresh(
      [{ id: 'grafana-A-esri', serviceUrl: SERVICE, mosaicRule: RULE_2017 }],
      [{ id: 'grafana-A-esri', serviceUrl: SERVICE }]
    );

    expect(keep).toHaveLength(1);
    expect(replace).toHaveLength(0);
  });

  it('rebuilds a service whose endpoint changed', () => {
    const { replace } = splitEsriRefresh(
      [{ id: 'grafana-A-esri', serviceUrl: OTHER }],
      [{ id: 'grafana-A-esri', serviceUrl: SERVICE }]
    );

    expect(replace.map((one) => one.serviceUrl)).toEqual([OTHER]);
  });

  it('rebuilds when the rendering rule changed, because that is what is drawn', () => {
    const { replace } = splitEsriRefresh(
      [{ id: 'grafana-A-esri', serviceUrl: SERVICE, renderingRule: '{"rasterFunction":"B"}' }],
      [{ id: 'grafana-A-esri', serviceUrl: SERVICE, renderingRule: '{"rasterFunction":"A"}' }]
    );

    expect(replace).toHaveLength(1);
  });

  it('drops only the layers the panel minted', () => {
    // A tileset the user added by hand lives in the same store and must survive
    // every refresh the query does.
    const { remove } = splitEsriRefresh(
      [],
      [{ id: 'grafana-A-esri', serviceUrl: SERVICE }, { id: 'mine-by-hand', serviceUrl: OTHER }]
    );

    expect(remove).toEqual(['grafana-A-esri']);
  });
});
