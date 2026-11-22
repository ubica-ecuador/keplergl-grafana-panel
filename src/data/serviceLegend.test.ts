import {
  fetchArcgisLegend,
  legendKindOf,
  MAX_LISTED_ENTRIES,
  parseArcgisLegend,
  RAMP_SWATCHES,
  serviceLegends,
  shownLegends,
} from './serviceLegend';

const WMS = 'https://maps.dwd.de/geoserver/ows';
const GRAPHIC = `${WMS}?service=WMS&request=GetLegendGraphic&format=image%2Fpng&layer=dwd%3AAutowarn_Analyse`;
const IMAGE_SERVICE = 'https://landsat2.arcgis.com/arcgis/rest/services/Landsat/MS/ImageServer';
const MAP_SERVICE = 'https://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAPklEQVQ4jWPMy8v7z0BFwAIiJk6aRBXD8vPyGJgYqAyYRg==';

const wms = (legendUrl?: string) => ({
  id: 'grafana-A-wms',
  label: 'Warnings',
  serviceUrl: WMS,
  layerName: 'dwd:Autowarn_Analyse',
  times: [],
  bbox: null,
  ...(legendUrl !== undefined ? { legendUrl } : {}),
});

/** An Image Service's reply to `legend?f=json`, as landsat2.arcgis.com answers it. */
const imageServiceReply = {
  layers: [
    {
      layerId: 0,
      layerName: 'Landsat/MS',
      layerType: 'Raster Layer',
      legendType: 'RGB Composite',
      legend: [
        { label: 'Red:    ShortWaveInfrared_1', url: 'e9759', imageData: PNG, contentType: 'image/png' },
        { label: 'Green: NearInfrared', url: '0849b', imageData: PNG, contentType: 'image/png' },
        { label: 'Blue: Blue', url: 'aa12', imageData: PNG, contentType: 'image/png' },
      ],
    },
  ],
};

describe('legendKindOf', () => {
  it('reads an ArcGIS REST legend endpoint as JSON, and anything else as a picture', () => {
    expect(legendKindOf(`${IMAGE_SERVICE}/legend?f=json`)).toBe('arcgis');
    expect(legendKindOf(`${MAP_SERVICE}/legend`)).toBe('arcgis');
    expect(legendKindOf(GRAPHIC)).toBe('image');
    expect(legendKindOf('/public/img/legend.png')).toBe('image');
    expect(legendKindOf('data:image/png;base64,AAAA')).toBe('image');
  });

  it('shows no url the map should not point an image at', () => {
    expect(legendKindOf('javascript:alert(1)')).toBeNull();
    expect(legendKindOf('data:text/html;base64,AAAA')).toBeNull();
    expect(legendKindOf('//elsewhere.example/legend.png')).toBeNull();
    expect(legendKindOf('')).toBeNull();
  });
});

describe('serviceLegends', () => {
  it('gives one legend per layer whose query named one, in the order they came', () => {
    const legends = serviceLegends(
      [wms(GRAPHIC), { ...wms(), id: 'grafana-B-wms' }],
      [{ id: 'grafana-C-esri', label: 'Landsat', serviceUrl: IMAGE_SERVICE, legendUrl: `${IMAGE_SERVICE}/legend` }]
    );

    expect(legends).toEqual([
      { dataId: 'grafana-A-wms', label: 'Warnings', url: GRAPHIC, kind: 'image' },
      { dataId: 'grafana-C-esri', label: 'Landsat', url: `${IMAGE_SERVICE}/legend?f=json`, kind: 'arcgis' },
    ]);
  });

  it('asks an ArcGIS legend for JSON whatever format it named, keeping its rendering rule', () => {
    const [legend] = serviceLegends(
      [],
      [
        {
          id: 'grafana-A-esri',
          label: 'NDVI',
          serviceUrl: IMAGE_SERVICE,
          legendUrl: `${IMAGE_SERVICE}/legend?renderingRule=%7B%7D&f=pjson`,
        },
      ]
    );

    expect(legend.url).toBe(`${IMAGE_SERVICE}/legend?renderingRule=%7B%7D&f=json`);
  });

  it('shows only the layer a Map Service is drawn by, when it is drawn one layer at a time', () => {
    const [legend] = serviceLegends(
      [],
      [{ id: 'grafana-A-esri', label: 'States', serviceUrl: `${MAP_SERVICE}/2`, legendUrl: `${MAP_SERVICE}/legend` }]
    );

    expect(legend.layerId).toBe(2);
  });

  it('gives none for a url the map would not show', () => {
    expect(serviceLegends([wms('javascript:alert(1)'), wms('  ')], [])).toEqual([]);
  });
});

describe('parseArcgisLegend', () => {
  it('reads an Image Service legend as swatches and labels', () => {
    const [group] = parseArcgisLegend(imageServiceReply);

    expect(group.title).toBe('Landsat/MS');
    expect(group.ramp).toBeUndefined();
    expect(group.entries.map((entry) => entry.label)).toEqual([
      'Red:    ShortWaveInfrared_1',
      'Green: NearInfrared',
      'Blue: Blue',
    ]);
    expect(group.entries[0].image).toBe(`data:image/png;base64,${PNG}`);
  });

  it('names a single-symbol layer of a Map Service by the layer, and keeps only the layer drawn', () => {
    const reply = {
      layers: [
        { layerId: 0, layerName: 'Cities', legend: [{ label: '', imageData: PNG, contentType: 'image/png' }] },
        { layerId: 2, layerName: 'States', legend: [{ label: '', imageData: PNG, contentType: 'image/png' }] },
      ],
    };

    expect(parseArcgisLegend(reply).map((group) => group.entries[0].label)).toEqual(['Cities', 'States']);
    expect(parseArcgisLegend(reply, 2).map((group) => group.title)).toEqual(['States']);
  });

  it('draws a stretch of many values as a bar of sampled swatches with its two end labels', () => {
    const legend = Array.from({ length: 256 }, (_, i) => ({ label: `${i}`, imageData: PNG, contentType: 'image/png' }));
    const [group] = parseArcgisLegend({ layers: [{ layerId: 0, layerName: 'NDVI', legend }] });

    expect(256).toBeGreaterThan(MAX_LISTED_ENTRIES);
    expect(group.ramp).toEqual({ ends: ['0', '255'] });
    expect(group.entries).toHaveLength(RAMP_SWATCHES);
  });

  it('leaves out a swatch it cannot show, and gives nothing for an error or anything else', () => {
    const reply = {
      layers: [
        {
          layerId: 0,
          layerName: 'Mixed',
          legend: [
            { label: 'script', imageData: '<svg onload=alert(1)>', contentType: 'image/svg+xml' },
            { label: 'relative', url: 'abc123' },
            { label: 'absolute', url: 'https://example.org/swatch.png' },
            { label: 'odd type', imageData: PNG, contentType: 'text/html' },
          ],
        },
      ],
    };

    expect(parseArcgisLegend(reply)[0].entries).toEqual([
      { label: 'absolute', image: 'https://example.org/swatch.png' },
      { label: 'odd type', image: `data:image/png;base64,${PNG}` },
    ]);
    expect(parseArcgisLegend({ error: { code: 400, message: 'Unable to complete operation.' } })).toEqual([]);
    expect(parseArcgisLegend(null)).toEqual([]);
    expect(parseArcgisLegend('<html>')).toEqual([]);
  });
});

describe('shownLegends', () => {
  const legend = { dataId: 'grafana-A-wms', label: 'Query A', url: GRAPHIC, kind: 'image' as const };

  it('shows a legend while its layer is, titled with the layer’s label', () => {
    expect(shownLegends([legend], [{ dataId: 'grafana-A-wms', label: 'Warnings', visible: true }])).toEqual([
      { ...legend, title: 'Warnings' },
    ]);
    expect(shownLegends([legend], [{ dataId: 'grafana-A-wms', label: '', visible: true }])[0].title).toBe('Query A');
  });

  it('hides it while the layer is hidden, or not built yet', () => {
    expect(shownLegends([legend], [{ dataId: 'grafana-A-wms', label: 'Warnings', visible: false }])).toEqual([]);
    expect(shownLegends([legend], [])).toEqual([]);
  });
});

describe('fetchArcgisLegend', () => {
  it('fetches a legend once, without credentials, and shares the reply', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => imageServiceReply }) as unknown as Response);
    const url = `${IMAGE_SERVICE}/legend?f=json&once`;

    const [a, b] = await Promise.all([fetchArcgisLegend(url, fetchImpl), fetchArcgisLegend(url, fetchImpl)]);

    expect(a).toBe(imageServiceReply);
    expect(b).toBe(imageServiceReply);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(url, { credentials: 'omit' });
  });

  it('answers null when the service refuses, and asks again the next time', async () => {
    const refused = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const url = `${IMAGE_SERVICE}/legend?f=json&refused`;

    expect(await fetchArcgisLegend(url, refused)).toBeNull();
    expect(await fetchArcgisLegend(url, refused)).toBeNull();
    expect(refused).toHaveBeenCalledTimes(2);
  });
});
