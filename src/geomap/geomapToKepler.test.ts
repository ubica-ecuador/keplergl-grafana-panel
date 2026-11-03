import { createTheme, FieldType, toDataFrame } from '@grafana/data';
import KeplerGlSchema from '@kepler.gl/schemas';

import { fromGeomapPanel, type GeomapImport, type GeomapOptions } from './fromGeomap';
import { geomapToKepler } from './geomapToKepler';

const theme = createTheme({ colors: { mode: 'dark' } });

function importOf(options: GeomapOptions): GeomapImport {
  return fromGeomapPanel('geomap', options as Record<string, unknown>, { defaults: {}, overrides: [] }, theme)
    .geomapImport!;
}

const stations = toDataFrame({
  refId: 'A',
  fields: [
    { name: 'name', type: FieldType.string, values: ['Quito', 'Cuenca'] },
    { name: 'lat', type: FieldType.number, values: [-0.18, -2.9] },
    { name: 'lon', type: FieldType.number, values: [-78.47, -79] },
    { name: 'magnitude', type: FieldType.number, values: [3, 5] },
  ],
});

const sites = toDataFrame({
  refId: 'B',
  fields: [
    { name: 'y', type: FieldType.number, values: [1] },
    { name: 'x', type: FieldType.number, values: [2] },
  ],
});

const markers: GeomapOptions = {
  view: { id: 'coords', lat: -1.5, lon: -78.5, zoom: 7 },
  layers: [
    {
      type: 'markers',
      name: 'Stations',
      location: { mode: 'auto' },
      config: {
        style: { size: { fixed: 5, min: 2, max: 15, field: 'magnitude' }, text: { field: 'name', mode: 'field' } },
      },
    },
  ],
};

describe('geomapToKepler', () => {
  it('waits for rows before converting', () => {
    expect(geomapToKepler(importOf(markers), [])).toBeNull();
  });

  it('builds a point layer on the detected coordinates of the first query', () => {
    const result = geomapToKepler(importOf(markers), [stations])!;
    const [layer] = (result.mapConfig.config.visState as { layers: any[] }).layers;

    expect(layer.type).toBe('point');
    expect(layer.config.dataId).toBe('grafana-A');
    // The panel renames the coordinate columns it detected.
    expect(layer.config.columns).toEqual({ lat: 'latitude', lng: 'longitude' });
    expect(layer.visualChannels.sizeField).toEqual({ name: 'magnitude', type: 'real' });
    expect(layer.config.textLabel[0].field).toEqual({ name: 'name', type: 'string' });
    expect(result.mapConfig.config.mapState).toMatchObject({ latitude: -1.5, longitude: -78.5, zoom: 6 });
  });

  it('maps the columns Geomap was told, on the query it was told', () => {
    const result = geomapToKepler(
      importOf({
        ...markers,
        layers: [
          {
            type: 'markers',
            name: 'Sites',
            filterData: { id: 'byRefId', options: 'B' },
            location: { mode: 'coords', latitude: 'y', longitude: 'x' },
          },
        ],
      }),
      [stations, sites]
    )!;
    const [layer] = (result.mapConfig.config.visState as { layers: any[] }).layers;

    expect(layer.config.dataId).toBe('grafana-B');
    expect(result.fieldMappings).toEqual({ B: { latitude: 'y', longitude: 'x' } });
  });

  it('leaves the viewport out for fit-to-data, so the panel frames the rows', () => {
    const result = geomapToKepler(importOf({ ...markers, view: { id: 'fit' } }), [stations])!;
    expect(result.mapConfig.config.mapState).toBeUndefined();
  });

  it('notes a layer whose rows have no coordinates', () => {
    const noCoords = toDataFrame({ refId: 'A', fields: [{ name: 'v', type: FieldType.number, values: [1] }] });
    const result = geomapToKepler(importOf(markers), [noCoords])!;

    expect((result.mapConfig.config.visState as { layers: unknown[] }).layers).toHaveLength(0);
    expect(result.dropped).toEqual(['“Stations”: no latitude and longitude columns found']);
  });

  it('produces a config kepler parses with its layers and tooltip intact', () => {
    const imported = importOf({
      ...markers,
      tooltip: { mode: 'none' },
      layers: [...markers.layers!, { type: 'heatmap', name: 'Heat', config: { weight: { field: 'magnitude' } } }],
    });
    const parsed = KeplerGlSchema.parseSavedConfig(geomapToKepler(imported, [stations])!.mapConfig);

    expect(parsed?.visState?.layers?.map((l: { type: string }) => l.type)).toEqual(['point', 'heatmap']);
    expect(parsed?.visState?.interactionConfig?.tooltip?.enabled).toBe(false);
  });

  it('sizes points and heat as Geomap drew them on screen', () => {
    const imported = importOf({
      view: { id: 'coords', lat: -1.5, lon: -78.5, zoom: 7 },
      layers: [
        { type: 'markers', name: 'Dots', config: { style: { size: { fixed: 10, min: 2, max: 20 } } } },
        { type: 'heatmap', name: 'Heat', config: { radius: 5, blur: 15 } },
      ],
    });
    const [points, heat] = (geomapToKepler(imported, [stations])!.mapConfig.config.visState as { layers: any[] })
      .layers;

    // About 0.21 px per kepler radius unit.
    expect(points.config.visConfig.radius).toBeCloseTo(47.8, 0);
    expect(points.config.visConfig.radiusRange).toEqual([9.6, 95.5]);
    // 20 px at the opening zoom 6, on kepler's 2 px (zoom 0) to radius (zoom 18) ramp.
    expect(heat.config.visConfig.radius).toBe(56);
  });

  it('opens the legend when a markers layer is coloured or sized by a field', () => {
    const legendOf = (options: GeomapOptions) =>
      (geomapToKepler(importOf(options), [stations])!.mapConfig.config.uiState as any).mapControls.mapLegend.active;

    expect(legendOf(markers)).toBe(true);
    expect(legendOf({ ...markers, layers: [{ type: 'markers', name: 'Plain' }] })).toBe(false);
  });

  it('draws a route as a line layer on the query’s segments, arrows and width included', () => {
    const imported = importOf({
      view: { id: 'fit' },
      layers: [
        {
          type: 'route',
          name: 'Track',
          config: { arrow: 1, style: { color: { field: 'magnitude' }, size: { fixed: 4 }, lineWidth: 2 } },
        },
      ],
    });
    const result = geomapToKepler(imported, [stations])!;
    const [line] = (result.mapConfig.config.visState as { layers: any[] }).layers;

    expect(result.routeQueries).toEqual(['A']);
    expect(line.type).toBe('line');
    expect(line.config.dataId).toBe('grafana-A-route');
    expect(line.config.columns).toEqual({ lat0: 'lat0', lng0: 'lng0', lat1: 'lat1', lng1: 'lng1' });
    // 4 px at kepler's 2/3 px per unit of thickness.
    expect(line.config.visConfig.thickness).toBe(6);
    expect(line.config.visConfig).toMatchObject({ targetArrowEnabled: true, targetArrowSize: 12 });
    expect(line.visualChannels.colorField).toEqual({ name: 'magnitude', type: 'real' });

    const parsed = KeplerGlSchema.parseSavedConfig(result.mapConfig);
    expect(parsed?.visState?.layers?.[0]).toMatchObject({ type: 'line' });
  });

  it('reverses the segments for arrows at their start', () => {
    const imported = importOf({ layers: [{ type: 'route', name: 'Back', config: { arrow: -1 } }] });
    const [line] = (geomapToKepler(imported, [stations])!.mapConfig.config.visState as { layers: any[] }).layers;

    expect(line.config.columns).toEqual({ lat0: 'lat1', lng0: 'lng1', lat1: 'lat0', lng1: 'lng0' });
  });
});
