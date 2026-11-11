import { runTool, type MapActions, type TableView } from './askMapTools';
import { profileTable, recipeCatalog, type Recipe } from './recipes';

function table(fields: Array<[string, string]>, rows: unknown[][], points: Array<[string, string]> = []): TableView {
  return {
    id: 'A',
    label: 'data',
    fields: fields.map(([name, type]) => ({ name, type })),
    numRows: rows.length,
    valueAt: (r, c) => rows[r][c],
    points,
  };
}

/** 6 sensors × 24 hourly readings. */
const sensors = table(
  [['station', 'string'], ['latitude', 'real'], ['longitude', 'real'], ['time', 'timestamp'], ['temperature', 'real']],
  Array.from({ length: 6 * 24 }, (_, i) => {
    const s = i % 6;
    return [`S${s}`, -2 + s * 0.3, -79 + s * 0.2, Date.UTC(2026, 10, 10, Math.floor(i / 6)), 10 + s + (i % 5)];
  }),
  [['latitude', 'longitude']]
);

/** 4 vehicles, each at 20 different places. */
const vehicles = table(
  [['vehicle_id', 'string'], ['lat', 'real'], ['lon', 'real'], ['time', 'timestamp'], ['speed', 'real']],
  Array.from({ length: 80 }, (_, i) => [`V${i % 4}`, 40 + i * 0.01, -3 + i * 0.01, Date.UTC(2026, 10, 10, 0, i), 30 + (i % 7)])
);

/** 400 distinct events. */
const events = table(
  [['latitude', 'real'], ['longitude', 'real'], ['mag', 'real'], ['type', 'string']],
  Array.from({ length: 400 }, (_, i) => [-30 + (i % 40), -70 + Math.floor(i / 40) * 3, 4 + (i % 30) / 10, i % 3 ? 'earthquake' : 'explosion']),
  [['latitude', 'longitude']]
);

const od = table(
  [['origin_lat', 'real'], ['origin_lon', 'real'], ['dest_lat', 'real'], ['dest_lon', 'real'], ['trips', 'integer']],
  [[0, 0, 1, 1, 5], [1, 1, 2, 2, 7]]
);

describe('profileTable', () => {
  it('tells fixed sensors with series from moving assets, dense events and OD pairs', () => {
    const s = profileTable(sensors);
    expect(s).toMatchObject({ places: 6, rowsPerPlace: 24, idField: 'station', positionsPerId: 1, valueFields: ['temperature'] });
    expect(s.shapes).toContain('sensor-series');
    expect(s.shapes).not.toContain('moving-assets');

    const v = profileTable(vehicles);
    expect(v).toMatchObject({ idField: 'vehicle_id', positionsPerId: 20 });
    expect(v.shapes).toContain('moving-assets');

    const e = profileTable(events);
    expect(e.shapes).toEqual(expect.arrayContaining(['dense-events', 'categories']));
    expect(e.categoryFields).toEqual(['type']);
    expect(e.valueFields[0]).toBe('mag');

    expect(profileTable(od)).toMatchObject({ od: { lat0: 'origin_lat', lng0: 'origin_lon', lat1: 'dest_lat', lng1: 'dest_lon' } });
  });
});

describe('recipes', () => {
  const actions = (): MapActions & { calls: unknown[][] } => {
    const calls: unknown[][] = [];
    const none = () => undefined;
    return {
      calls,
      filterRange: () => true,
      filterValues: () => true,
      clearFilter: none,
      clearAllFilters: () => [],
      fitBounds: none,
      addLayer: () => ({ id: 'x' }),
      addLayerConfig: (c) => (calls.push(['add', c]), { id: `${String(c.id)}-1` }),
      visibleLayersOf: () => ['auto-1'],
      updateLayer: (ref, change) => (calls.push(['update', ref, change]), { id: ref, type: 'point' }),
      removeLayer: () => ({ id: 'x' }),
      setView: (v) => void calls.push(['view', v]),
      pitch: () => 0,
      setBasemap: () => true,
      flyTo: none,
      fadeByZoom: (ref, stops) => (calls.push(['fade', ref, stops]), { id: ref }),
      filterArea: () => true,
      clearAreas: () => 0,
      drawnAreas: () => [],
      setTimeRange: none,
      undo: () => null,
    };
  };

  it('ranks Plus surface + sparklines first for sensors, marked unavailable in the free panel', () => {
    const out = runTool('suggest_visualizations', {}, { tables: [sensors], actions: actions() }).result as Array<{ recipes: Array<{ recipe: string; available: boolean }> }>;
    expect(out[0].recipes.map((r) => [r.recipe, r.available])).toEqual([
      ['sensor-surface-sparklines', false],
      ['sensor-points', true],
      ['sensor-gauges', false],
    ]);
    expect(runTool('apply_recipe', { recipe: 'sensor-surface-sparklines' }, { tables: [sensors], actions: actions() }).result).toMatchObject({
      error: expect.stringContaining('needs Kepler Geospatial Maps Plus'),
    });
  });

  it('builds hexagons that hand over to points by zoom, hides the old layer and tilts', () => {
    const a = actions();
    const out = runTool('apply_recipe', { recipe: 'dense-events' }, { tables: [events], actions: a });
    const added = a.calls.filter((c) => c[0] === 'add').map((c) => (c[1] as { type: string }).type);
    expect(added).toEqual(['hexagon', 'point']);
    const fades = a.calls.filter((c) => c[0] === 'fade').map((c) => c[2] as { fade: number; full: number });
    expect(fades[0].fade).toBeLessThan(fades[1].full + 1);
    expect(a.calls).toContainEqual(['update', 'auto-1', { visible: false }]);
    expect(a.calls).toContainEqual(['view', { pitch: 40 }]);
    expect(out.mapChange).toBe('Recipe "3D hexagons far, points near": 2 layers, hid 1 earlier, tilted to 40°');
  });

  it('lets a host replace a stub with a buildable recipe', () => {
    const plus: Recipe = { ...recipeCatalog().find((r) => r.id === 'fleet')!, build: () => ({ layers: [] }) };
    const catalog = recipeCatalog([plus]);
    expect(catalog.filter((r) => r.id === 'fleet')).toHaveLength(1);
    expect(catalog.find((r) => r.id === 'fleet')?.build).toBeDefined();
  });
});
