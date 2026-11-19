import { createDataFrame, FieldType } from '@grafana/data';

import { esriImageUrl } from '../data/esriImageUrl';
import { keepRemoteDatasets } from '../data/mapConfig';
import {
  type CatalogEntry,
  entriesOf,
  featuresArea,
  featuresDataset,
  featuresLabel,
  featuresOfSource,
  serviceDataset,
  serviceLabel,
} from './catalogSource';
import { featureRequestUrl, readFeatureRequest } from './featureRequests';

const AREA: [number, number, number, number] = [2.34, 48.85, 2.35, 48.86];
const RANGE = { from: Date.UTC(2010, 0, 1), to: Date.UTC(2013, 0, 1) };
const WFS_BASE =
  'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3%3Abatiment' +
  '&OUTPUTFORMAT=application%2Fjson&SRSNAME=EPSG%3A4326';
const ARCGIS_BASE =
  'https://gis.example.org/arcgis/rest/services/Quakes/MapServer/0/query?where=1%3D1&outFields=*&outSR=4326' +
  '&f=geojson&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects';

describe('a WFS request', () => {
  it('sends the area latitude first, as EPSG::4326 has it, and reads it back', () => {
    const url = new URL(featureRequestUrl({ protocol: 'wfs', itemsHref: WFS_BASE }, AREA, null, 2000));
    expect(url.searchParams.get('BBOX')).toBe('48.85,2.34,48.86,2.35,urn:ogc:def:crs:EPSG::4326');
    expect(url.searchParams.get('COUNT')).toBe('2000');
    expect(readFeatureRequest(url.toString())).toEqual({
      target: { protocol: 'wfs', itemsHref: WFS_BASE, timeProperty: null },
      bbox: AREA,
      time: false,
      limit: 2000,
    });
  });

  it('puts the area into the filter of the time range, and reads both back', () => {
    const target = { protocol: 'wfs' as const, itemsHref: WFS_BASE, timeProperty: 'date_creation' };
    const url = new URL(featureRequestUrl(target, AREA, RANGE, 500));
    const filter = url.searchParams.get('FILTER')!;
    expect(url.searchParams.has('BBOX')).toBe(false);
    expect(filter).toContain('<gml:lowerCorner>48.85 2.34</gml:lowerCorner>');
    expect(filter).toContain('<fes:ValueReference>date_creation</fes:ValueReference>');
    expect(filter).toContain('<fes:Literal>2013-01-01T00:00:00.000Z</fes:Literal>');
    expect(readFeatureRequest(url.toString())).toEqual({ target, bbox: AREA, time: true, limit: 500 });
  });

  it('speaks WFS 1.1 when its address does', () => {
    const base = WFS_BASE.replace('VERSION=2.0.0', 'VERSION=1.1.0').replace('TYPENAMES', 'TYPENAME');
    const url = new URL(featureRequestUrl({ protocol: 'wfs', itemsHref: base, timeProperty: 't' }, null, RANGE, 9));
    expect(url.searchParams.get('MAXFEATURES')).toBe('9');
    expect(url.searchParams.get('FILTER')).toContain('<ogc:PropertyName>t</ogc:PropertyName>');
  });
});

describe('an ArcGIS layer request', () => {
  it('sends the area as an envelope and the time in milliseconds, and reads them back', () => {
    const url = new URL(featureRequestUrl({ protocol: 'arcgis', itemsHref: ARCGIS_BASE }, AREA, RANGE, 2000));
    expect(url.searchParams.get('geometry')).toBe('2.34,48.85,2.35,48.86');
    expect(url.searchParams.get('time')).toBe(`${RANGE.from},${RANGE.to}`);
    expect(url.searchParams.get('resultRecordCount')).toBe('2000');
    expect(readFeatureRequest(url.toString())).toEqual({
      target: { protocol: 'arcgis', itemsHref: ARCGIS_BASE, timeProperty: null },
      bbox: AREA,
      time: true,
      limit: 2000,
    });
  });
});

describe('features of a WFS or an ArcGIS layer from a catalog', () => {
  const frame = createDataFrame({
    fields: [
      { name: 'id', type: FieldType.string, values: ['BDTOPO_V3:batiment', 'Quakes/MapServer/0'] },
      { name: 'title', type: FieldType.string, values: ['Bâtiments', 'Earthquakes'] },
      { name: 'kind', type: FieldType.string, values: ['features', 'features'] },
      { name: 'collection', type: FieldType.string, values: ['BDTOPO_V3', 'Quakes/MapServer'] },
      { name: 'collection_title', type: FieldType.string, values: ['BDTOPO_V3', 'Quakes (MapServer)'] },
      { name: 'href', type: FieldType.string, values: ['https://data.geopf.fr/wfs/ows', 'https://gis.example.org/x'] },
      { name: 'items_href', type: FieldType.string, values: [WFS_BASE, ARCGIS_BASE] },
      { name: 'feature_protocol', type: FieldType.string, values: ['wfs', 'arcgis'] },
      { name: 'time_property', type: FieldType.string, values: [null, 'date_'] },
    ],
  });

  it('are read with their service, and named by it', () => {
    const [wfs, arcgis] = entriesOf(frame);
    expect([wfs.featureProtocol, wfs.timeProperty, arcgis.featureProtocol, arcgis.timeProperty]).toEqual([
      'wfs',
      undefined,
      'arcgis',
      'date_',
    ]);
    expect(featuresLabel(wfs)).toEqual(['WFS', 'BDTOPO_V3:batiment']);
    expect(featuresLabel(arcgis)).toEqual(['ArcGIS', 'Quakes (MapServer)']);
  });

  it('are loaded over the view, in the time range when they have time, and followed off their address', () => {
    const [wfs, arcgis] = entriesOf(frame);
    const plain = featuresDataset(wfs, 'cat', AREA, RANGE)!;
    expect(new URL(plain.data.metadata?.source as string).searchParams.has('FILTER')).toBe(false);
    const dated = featuresDataset({ ...wfs, timeProperty: 'date_creation' } as CatalogEntry, 'cat', AREA, RANGE)!;
    expect(featuresOfSource(dated.data.id, dated.data.metadata?.source)).toMatchObject({
      protocol: 'wfs',
      timeProperty: 'date_creation',
      time: true,
      bbox: AREA,
    });
    const layer = featuresDataset(arcgis, 'cat', AREA, RANGE)!;
    expect(new URL(layer.data.metadata?.source as string).searchParams.get('time')).toBe(`${RANGE.from},${RANGE.to}`);
    expect(featuresOfSource(layer.data.id, layer.data.metadata?.source)).toMatchObject({
      protocol: 'arcgis',
      time: true,
    });
  });
});

describe('an ArcGIS image or map service from a catalog', () => {
  const service = {
    protocol: 'arcgis-image' as const,
    layers: [],
    styles: [],
    transparent: true,
    dimensions: {},
    encoding: null,
    uriTemplate: null,
    variables: {},
    servers: [],
    mediaType: 'image/png',
  };
  const entry = (href: string): CatalogEntry => ({
    id: 'Land/ImageServer:image',
    title: 'Land cover',
    kind: 'map-service',
    collection: 'Land/ImageServer',
    collectionTitle: 'Land (ImageServer)',
    href,
    serverHref: null,
    painted: null,
    start: null,
    end: null,
    license: '',
    thumbnail: null,
    bbox: null,
    service,
  });

  it('is the panel own ArcGIS layer, saved with the map', async () => {
    const saved = (await serviceDataset(
      entry('https://gis.example.org/arcgis/rest/services/Land/ImageServer'),
      'cat'
    ))!;
    expect(saved.data).toMatchObject({
      id: 'catalog-Land-ImageServer-image',
      type: 'esriImage',
      metadata: { serviceUrl: 'https://gis.example.org/arcgis/rest/services/Land/ImageServer', catalogUid: 'cat' },
    });
    expect(keepRemoteDatasets([saved])).toHaveLength(1);
    expect(serviceLabel(service)).toBe('ArcGIS');
  });

  it('asks a MapServer by export and an ImageServer by exportImage, with the same parameters', () => {
    const tile = { west: 0, south: 0, east: 1, north: 1 };
    const map = esriImageUrl({ serviceUrl: 'https://g.org/rest/services/Streets/MapServer' }, tile)!;
    const image = esriImageUrl({ serviceUrl: 'https://g.org/rest/services/Land/ImageServer' }, tile)!;
    expect(new URL(map).pathname).toBe('/rest/services/Streets/MapServer/export');
    expect(new URL(image).pathname).toBe('/rest/services/Land/ImageServer/exportImage');
    expect(new URL(map).search).toBe(new URL(image).search);
  });
});

describe('the area features are asked over', () => {
  it('is the followed grid for a near view, the view itself kept to the world for a wide one', () => {
    expect(featuresArea([2.34, 48.85, 2.35, 48.86])).toEqual([2.33875, 48.84875, 2.35, 48.86]);
    expect(featuresArea([-125.004, 32.1, -114.2, 42.3])).toEqual([-125.01, 32.1, -114.2, 42.3]);
    expect(featuresArea([-200, -89, 200, 89])).toEqual([-180, -85, 180, 85]);
    expect(featuresArea(null)).toBeNull();
  });
});
