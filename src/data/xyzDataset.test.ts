import { FieldType, toDataFrame } from '@grafana/data';

import { framesToEsri } from './esriDataset';
import { framesToRasters } from './rasterDataset';
import { serviceKindOf } from './serviceKind';
import { detectFields } from './detectFields';
import { framesToWms } from './wmsDataset';
import { framesToXyz, isPanelXyzId, parseZoomIds, tilesFormatOf, xyzDatasetId } from './xyzDataset';

/** PDOK's background map, a WMTS whose matrices are named "00" to "19", as the Spatial Catalog gives it. */
const PDOK = 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png';
const PDOK_ZOOM_IDS = '0:00,1:01,2:02,3:03,4:04,5:05,6:06,7:07,8:08';
const NETHERLANDS = '3.2 50.7 7.3 53.6';
/** 3D BAG's buildings, vector tiles. */
const BAG = 'https://data.3dbag.nl/api/BAG3D/tiles/{z}/{x}/{y}.mvt';

type Row = Partial<Record<string, string | number | null>>;

/** A frame shaped like the catalog's Services frame: every column on every row, empty where it does not apply. */
function servicesFrame(rows: Row[], refId = 'A') {
  const columns: Array<[string, FieldType]> = [
    ['entry', FieldType.string],
    ['wms_url', FieldType.string],
    ['wms_layer', FieldType.string],
    ['tiles_url', FieldType.string],
    ['tiles_format', FieldType.string],
    ['tiles_metadata_url', FieldType.string],
    ['tiles_min_zoom', FieldType.number],
    ['tiles_max_zoom', FieldType.number],
    ['tiles_zoom_ids', FieldType.string],
    ['tiles_bbox', FieldType.string],
    ['esri_url', FieldType.string],
  ];
  return toDataFrame({
    refId,
    name: 'services',
    fields: columns.map(([name, type]) => ({ name, type, values: rows.map((row) => row[name] ?? null) })),
  });
}

const pdokRow: Row = {
  entry: 'pdok-brt',
  tiles_url: PDOK,
  tiles_format: 'raster',
  tiles_min_zoom: 0,
  tiles_max_zoom: 8,
  tiles_zoom_ids: PDOK_ZOOM_IDS,
  tiles_bbox: NETHERLANDS,
};

describe('framesToXyz', () => {
  it('draws a raster template from a catalog row, with its zoom levels, their names and its box', () => {
    const [tiles] = framesToXyz([servicesFrame([pdokRow])]);

    expect(tiles).toEqual({
      id: 'grafana-A-tiles',
      label: 'services',
      url: PDOK,
      minZoom: 0,
      maxZoom: 8,
      zoomIds: { 0: '00', 1: '01', 2: '02', 3: '03', 4: '04', 5: '05', 6: '06', 7: '07', 8: '08' },
      bbox: [3.2, 50.7, 7.3, 53.6],
    });
  });

  it('reads the same columns from any query, by name: a DuckDB SELECT draws the same layer', () => {
    const frame = toDataFrame({
      refId: 'B',
      fields: [
        { name: 'tiles_url', type: FieldType.string, values: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
      ],
    });

    expect(framesToXyz([frame])).toEqual([
      { id: 'grafana-B-tiles', label: 'Query B', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', bbox: null },
    ]);
  });

  it('takes one layer per query, from the first row with an address', () => {
    const [tiles, ...rest] = framesToXyz([
      servicesFrame([{ entry: 'none' }, pdokRow, { ...pdokRow, tiles_url: 'https://other.test/{z}/{x}/{y}.png' }]),
    ]);

    expect(rest).toEqual([]);
    expect(tiles.url).toBe(PDOK);
  });

  it('draws vector tiles with their TileJSON, and a PMTiles archive, which describes itself', () => {
    const tilejson = 'https://tiles.test/3dbag-lod13.json';
    expect(
      framesToXyz([
        servicesFrame([
          {
            tiles_url: BAG,
            tiles_format: 'mvt',
            tiles_metadata_url: tilejson,
            tiles_min_zoom: 10,
            tiles_max_zoom: 14,
            tiles_zoom_ids: PDOK_ZOOM_IDS,
            tiles_bbox: NETHERLANDS,
          },
        ]),
      ])
    ).toEqual([
      {
        id: 'grafana-A-tiles',
        label: 'services',
        url: BAG,
        format: 'mvt',
        metadataUrl: tilejson,
        minZoom: 10,
        maxZoom: 14,
        bbox: [3.2, 50.7, 7.3, 53.6],
      },
    ]);

    const archive = 'https://data.test/3dbag-lod13.pmtiles';
    expect(
      framesToXyz([servicesFrame([{ tiles_url: archive, tiles_format: 'pmtiles', tiles_metadata_url: archive }])])
    ).toEqual([
      { id: 'grafana-A-tiles', label: 'services', url: archive, format: 'pmtiles', metadataUrl: archive, bbox: null },
    ]);
    // Told by the address alone, and an archive whatever the column says: kepler reads it as one.
    expect(framesToXyz([servicesFrame([{ tiles_url: archive }])])[0].format).toBe('pmtiles');
    expect(framesToXyz([servicesFrame([{ tiles_url: archive, tiles_format: 'mvt' }])])[0].format).toBe('pmtiles');
    expect(framesToXyz([servicesFrame([{ tiles_url: `${BAG.replace('.mvt', '.pbf')}` }])])[0].format).toBe('mvt');
  });

  it('leaves an address with no tile in it, and a format it does not know, off the map', () => {
    expect(framesToXyz([servicesFrame([{ tiles_url: 'https://x.test/tiles.png', tiles_format: 'raster' }])])).toEqual(
      []
    );
    expect(framesToXyz([servicesFrame([{ tiles_url: 'https://x.test/tiles.mvt', tiles_format: 'mvt' }])])).toEqual([]);
    expect(framesToXyz([servicesFrame([{ tiles_url: PDOK, tiles_format: 'image/png' }])])).toEqual([]);
  });

  it('says why the tiles it leaves off are not on the map', () => {
    const undrawn: string[] = [];
    const onUndrawn = (text: string) => undrawn.push(text);
    framesToXyz(
      [
        servicesFrame([{ tiles_url: BAG, tiles_format: 'mvt' }], 'A'),
        servicesFrame([{ tiles_url: 'https://x.test/a.pmtiles' }], 'B'),
        servicesFrame([{ tiles_url: 'https://x.test/tiles.png' }], 'C'),
        servicesFrame([{ tiles_url: PDOK, tiles_format: 'image/png' }], 'D'),
        servicesFrame([pdokRow], 'E'),
        servicesFrame([{ tiles_url: 'https://x.test/tiles.mvt', tiles_format: 'mvt' }], 'F'),
      ],
      {},
      { onUndrawn }
    );

    expect(undrawn).toEqual([
      'services (query C) gives a tiles_url with no {z}, {x} and {y} in it, so there is no tile to ask for.',
      'services (query D) gives tiles in a format this map does not know (tiles_format "image/png").',
      'services (query F) gives a tiles_url with no {z}, {x} and {y} in it, so there is no tile to ask for.',
    ]);
  });

  it('ignores a frame with no tiles column, and zoom levels that are no levels', () => {
    const plain = toDataFrame({ refId: 'A', fields: [{ name: 'value', type: FieldType.number, values: [1] }] });
    expect(framesToXyz([plain])).toEqual([]);

    const [tiles] = framesToXyz([servicesFrame([{ tiles_url: PDOK, tiles_min_zoom: -1, tiles_bbox: 'nowhere' }])]);
    expect(tiles).not.toHaveProperty('minZoom');
    expect(tiles.bbox).toBeNull();
  });
});

describe('the tiles’ legend and layer', () => {
  /** DWD's states, a GeoWebCache WMTS: each style its own template and its own GetLegendGraphic. */
  const DWD_TILES =
    'https://maps.dwd.de/geoserver/gwc/service/wmts/rest/dwd:Laender/Laender_ocker/EPSG:900913/EPSG:900913:{z}/{y}/{x}?format=image/png';
  const DWD_LEGEND =
    'https://maps.dwd.de/geoserver/ows?service=WMS&request=GetLegendGraphic&format=image/png&width=20&height=20&layer=dwd:Laender&style=Laender_ocker';
  const withLegend = (row: Row, legend: string) => {
    const frame = servicesFrame([row]);
    frame.fields.push({ name: 'legend_url', type: FieldType.string, config: {}, values: [legend] });
    return frame;
  };

  it('carries the row’s legend_url for pictures, the style’s legend', () => {
    const [tiles] = framesToXyz([withLegend({ tiles_url: DWD_TILES, tiles_format: 'raster' }, ` ${DWD_LEGEND} `)]);
    expect(tiles.legendUrl).toBe(DWD_LEGEND);
  });

  it('reads legend_graphic_url too, by detection', () => {
    const frame = toDataFrame({
      refId: 'B',
      fields: [
        { name: 'tiles_url', type: FieldType.string, values: [DWD_TILES] },
        { name: 'legend_graphic_url', type: FieldType.string, values: [DWD_LEGEND] },
      ],
    });
    expect(framesToXyz([frame])[0].legendUrl).toBe(DWD_LEGEND);
  });

  it('carries no legend for vector tiles, kepler’s own legend explains those, nor an empty one', () => {
    expect(framesToXyz([withLegend({ tiles_url: BAG, tiles_format: 'mvt' }, DWD_LEGEND)])[0]).not.toHaveProperty(
      'legendUrl'
    );
    expect(framesToXyz([withLegend({ tiles_url: DWD_TILES }, '  ')])[0]).not.toHaveProperty('legendUrl');
  });

  it('names the layer its frame names (meta.custom.layer.key), and none without one', () => {
    const frame = servicesFrame([{ tiles_url: DWD_TILES }]);
    frame.meta = { custom: { layer: { key: 'dwd:Laender' } } };
    expect(framesToXyz([frame])[0].layerKey).toBe('dwd:Laender');
    expect(framesToXyz([servicesFrame([{ tiles_url: DWD_TILES }])])[0]).not.toHaveProperty('layerKey');
  });
});

describe("the layer's own zoom levels and credits", () => {
  it('takes the zoom levels from meta.custom.layer when the row has none, and the row wins', () => {
    const frame = servicesFrame([{ ...pdokRow, tiles_min_zoom: null, tiles_max_zoom: 8 }]);
    frame.meta = {
      custom: { layer: { minZoom: 3, maxZoom: 12, attribution: { title: 'PDOK', url: 'https://www.pdok.nl' } } },
    };
    const [tiles] = framesToXyz([frame]);
    expect(tiles.minZoom).toBe(3);
    expect(tiles.maxZoom).toBe(8);
    expect(tiles.attributions).toEqual(['<a href="https://www.pdok.nl/" title="PDOK">PDOK</a>']);
  });
});

describe('one service per query', () => {
  const wms = { wms_url: 'https://data.geopf.fr/wms-r', wms_layer: 'CASSINI' };

  it('draws a WMS over tiles in the same row, and the tiles alone without one', () => {
    const both = servicesFrame([{ ...pdokRow, ...wms }]);

    expect(serviceKindOf(both, detectFields(both))).toBe('wms');
    expect(framesToWms([both])).toHaveLength(1);
    expect(framesToXyz([both])).toEqual([]);
  });

  it('draws an Image Service over tiles in the same row', () => {
    const both = servicesFrame([{ ...pdokRow, esri_url: 'https://x.test/arcgis/rest/services/a/ImageServer' }]);

    expect(framesToEsri([both])).toHaveLength(1);
    expect(framesToXyz([both])).toEqual([]);
  });

  it('draws tiles over a raster in the same row', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'tiles_url', type: FieldType.string, values: [PDOK] },
        { name: 'raster_url', type: FieldType.string, values: ['https://x.test/a.pmtiles'] },
      ],
    });

    expect(framesToXyz([frame])).toHaveLength(1);
    expect(framesToRasters([frame], {}, { tileServerUrls: [] })).toEqual([]);
  });

  it('lets the first row that names a service decide, whatever later rows name', () => {
    // As the catalog lists a collection's services: the one meant first.
    const frame = servicesFrame([pdokRow, { entry: 'cassini', ...wms }]);

    expect(serviceKindOf(frame, detectFields(frame))).toBe('tiles');
    expect(framesToXyz([frame])).toHaveLength(1);
    expect(framesToWms([frame])).toEqual([]);
  });

  it('names no kind for a frame that names no service', () => {
    const frame = servicesFrame([{ entry: 'a' }]);
    expect(serviceKindOf(frame, detectFields(frame))).toBeNull();
  });
});

describe('the pieces', () => {
  it('reads a WMTS’s names for its levels, colons in them included', () => {
    expect(parseZoomIds('0:00,1:01')).toEqual({ 0: '00', 1: '01' });
    expect(parseZoomIds('5:EPSG:3857:5, 06:EPSG:3857:6')).toEqual({ 5: 'EPSG:3857:5', 6: 'EPSG:3857:6' });
    expect(parseZoomIds('a:b,7')).toBeUndefined();
    expect(parseZoomIds(null)).toBeUndefined();
    expect(parseZoomIds('')).toBeUndefined();
  });

  it('tells the tiles’ format, from the column or else from the address', () => {
    expect(tilesFormatOf('Raster', PDOK)).toBe('raster');
    expect(tilesFormatOf(null, PDOK)).toBe('raster');
    expect(tilesFormatOf(null, BAG)).toBe('mvt');
    expect(tilesFormatOf('', 'https://x.test/{z}/{x}/{y}.pbf?key=1')).toBe('mvt');
    expect(tilesFormatOf(undefined, 'https://x.test/world.pmtiles')).toBe('pmtiles');
    expect(tilesFormatOf('webp', PDOK)).toBe('webp');
  });

  it('mints an id the panel knows as its own, and a Geomap’s XYZ layer’s as not', () => {
    expect(xyzDatasetId('A')).toBe('grafana-A-tiles');
    expect(isPanelXyzId('grafana-A-tiles')).toBe(true);
    expect(isPanelXyzId('geomap-xyz-0')).toBe(false);
    expect(isPanelXyzId('grafana-A-wms')).toBe(false);
  });
});
