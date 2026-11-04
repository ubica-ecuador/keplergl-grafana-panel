import { createTheme, type FieldConfigSource } from '@grafana/data';

import { fromGeomapPanel, type GeomapOptions } from './fromGeomap';

const theme = createTheme({ colors: { mode: 'dark' } });

const noFieldConfig: FieldConfigSource = { defaults: {}, overrides: [] };

/** A Geomap as its editor saves it: default base map, one markers layer, a fixed view. */
const markersPanel: GeomapOptions = {
  basemap: { type: 'default', name: 'Basemap' },
  view: { id: 'coords', lat: 38.3, lon: -99.2, zoom: 3.98 },
  tooltip: { mode: 'details' },
  layers: [
    {
      type: 'markers',
      name: 'Stations',
      location: { mode: 'auto' },
      config: {
        style: {
          color: { fixed: 'red' },
          opacity: 0.6,
          size: { fixed: 7, min: 3, max: 20, field: 'magnitude' },
        },
      },
    },
  ],
};

function convert(options: GeomapOptions, fieldConfig = noFieldConfig) {
  return fromGeomapPanel('geomap', options as Record<string, unknown>, fieldConfig, theme);
}

describe('fromGeomapPanel', () => {
  it('leaves every other visualization alone', () => {
    expect(fromGeomapPanel('timeseries', { legend: {} }, noFieldConfig, theme)).toEqual({});
  });

  it('turns a markers layer into a point layer with its colour, opacity and sizes', () => {
    const layer = convert(markersPanel).geomapImport!.layers[0];

    expect(layer).toMatchObject({
      type: 'point',
      label: 'Stations',
      location: { mode: 'auto' },
      opacity: 0.6,
      radius: 7,
      radiusRange: [3, 20],
      sizeField: 'magnitude',
    });
    // Grafana's named red, resolved through the theme.
    expect(layer.color).toEqual([242, 73, 92]);
  });

  it('opens one zoom level lower, MapLibre counting on 512-pixel tiles', () => {
    expect(convert(markersPanel).geomapImport!.view).toEqual({ latitude: 38.3, longitude: -99.2, zoom: 2.98 });
  });

  it('reads a preset region and a fit-to-data view', () => {
    expect(convert({ ...markersPanel, view: { id: 'europe' } }).geomapImport!.view).toEqual({
      latitude: 46,
      longitude: 14,
      zoom: 3,
    });
    expect(convert({ ...markersPanel, view: { id: 'fit', zoom: 15 } }).geomapImport!.view).toBe('fit');
  });

  it('keeps the layer on its query and on the columns Geomap was told', () => {
    const layer = convert({
      ...markersPanel,
      layers: [
        {
          ...markersPanel.layers![0],
          filterData: { id: 'byRefId', options: 'B' },
          location: { mode: 'coords', latitude: 'lat_deg', longitude: 'lon_deg' },
        },
      ],
    }).geomapImport!.layers[0];

    expect(layer.refId).toBe('B');
    expect(layer.location).toEqual({ mode: 'coords', latitude: 'lat_deg', longitude: 'lon_deg' });
  });

  it('colours by a field from its thresholds, each colour holding up to the next step', () => {
    const fieldConfig: FieldConfigSource = {
      defaults: {
        color: { mode: 'thresholds' },
        thresholds: {
          mode: 'absolute' as never,
          steps: [
            { value: -Infinity, color: 'green' },
            { value: 50, color: 'orange' },
            { value: 80, color: 'red' },
          ],
        },
      },
      overrides: [],
    };
    const options = {
      ...markersPanel,
      layers: [{ ...markersPanel.layers![0], config: { style: { color: { field: 'pm25' } } } }],
    };

    const colorField = convert(options, fieldConfig).geomapImport!.layers[0].colorField!;

    expect(colorField.name).toBe('pm25');
    expect(colorField.scale).toBe('custom');
    expect(colorField.colorMap?.map(([bound]) => bound)).toEqual([50, 80, null]);
  });

  it('takes a continuous scheme from an override on the colour field', () => {
    const fieldConfig: FieldConfigSource = {
      defaults: { color: { mode: 'thresholds' } },
      overrides: [
        {
          matcher: { id: 'byName', options: 'pm25' },
          properties: [{ id: 'color', value: { mode: 'continuous-GrYlRd' } }],
        },
      ],
    };
    const options = {
      ...markersPanel,
      layers: [{ ...markersPanel.layers![0], config: { style: { color: { field: 'pm25' } } } }],
    };

    const colorField = convert(options, fieldConfig).geomapImport!.layers[0].colorField!;

    expect(colorField.scale).toBe('quantize');
    expect(colorField.colors.length).toBeGreaterThan(1);
  });

  it('draws a heatmap as wide as OpenLayers did, radius plus blur', () => {
    const layer = convert({
      ...markersPanel,
      layers: [{ type: 'heatmap', name: 'Heat', config: { radius: 8, blur: 20, weight: { field: 'mag' } } }],
    }).geomapImport!.layers[0];

    expect(layer).toMatchObject({ type: 'heatmap', heatRadius: 28, weightField: 'mag' });
  });

  it.each([
    [{ type: 'default' }, { basemap: 'auto' }],
    [{ type: 'carto', config: { theme: 'light' } }, { basemap: 'openfreemap-positron' }],
    [{ type: 'carto', config: { theme: 'dark' } }, { basemap: 'openfreemap-dark' }],
    [{ type: 'esri-xyz', config: { server: 'world-imagery' } }, { basemap: 'grafana-satellite' }],
    [{ type: 'osm-standard' }, { basemap: 'openfreemap-liberty' }],
    [
      { type: 'maplibre', config: { url: 'https://example.org/style.json' } },
      { basemap: 'custom', customBasemapUrl: 'https://example.org/style.json' },
    ],
  ])('maps the %j base map', (basemap, expected) => {
    expect(convert({ ...markersPanel, basemap })).toMatchObject(expected);
  });

  it('says what it could not carry over', () => {
    const result = convert({
      ...markersPanel,
      layers: [
        ...markersPanel.layers!,
        { type: 'last-point-tracker', name: 'Last point' },
        { type: 'markers', name: 'By hash', location: { mode: 'geohash', geohash: 'gh' } },
        { type: 'xyz', name: 'Nothing', config: {} },
      ],
    });

    expect(result.geomapImport!.layers).toHaveLength(1);
    expect(result.geomapImport!.dropped).toHaveLength(3);
  });

  it('keeps the map off the dashboard clock, as Geomap was', () => {
    expect(convert(markersPanel)).toMatchObject({ timeSync: 'off', showSidePanel: false });
  });

  it('turns the tooltip off when Geomap had none', () => {
    expect(convert({ ...markersPanel, tooltip: { mode: 'none' } }).geomapImport!.tooltip).toBe(false);
  });

  it('draws a tiled base map the panel has no style for as tiles under every layer', () => {
    const result = convert({
      ...markersPanel,
      basemap: { type: 'xyz', config: { url: 'https://tiles.example.org/{z}/{x}/{y}.png', maxZoom: 17 } },
    });

    expect(result.basemap).toBe('auto');
    expect(result.geomapImport!.layers.map((l) => l.type)).toEqual(['xyz', 'point']);
    expect(result.geomapImport!.layers[0]).toMatchObject({
      tileUrl: 'https://tiles.example.org/{z}/{x}/{y}.png',
      maxZoom: 17,
    });
  });

  it('reads an Esri service as its public tile cache', () => {
    const result = convert({
      ...markersPanel,
      layers: [{ type: 'esri-xyz', name: 'Ocean', config: { server: 'ocean' } }],
    });
    expect(result.geomapImport!.layers[0].tileUrl).toBe(
      'https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'
    );
  });
});
