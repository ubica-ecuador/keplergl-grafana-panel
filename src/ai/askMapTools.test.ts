import { runTool, toComparable, type MapActions, type TableView } from './askMapTools';

const ROWS: unknown[][] = [
  ['2026-11-01T03:00:00Z', -33.4, -70.6, 6.1, '10 km N of Santiago, Chile'],
  ['2026-11-01T09:00:00Z', -12.0, -77.0, 4.6, 'Lima, Peru'],
  ['2026-11-02T12:00:00Z', 35.7, 139.7, 5.4, 'Tokyo, Japan'],
  ['2026-11-03T01:00:00Z', -20.2, -70.1, 7.0, 'Iquique, Chile'],
  ['2026-11-03T02:00:00Z', null, null, 4.5, null],
];

function table(): TableView {
  return {
    id: 'A',
    label: 'quakes',
    fields: [
      { name: 'time', type: 'timestamp' },
      { name: 'latitude', type: 'real' },
      { name: 'longitude', type: 'real' },
      { name: 'mag', type: 'real' },
      { name: 'place', type: 'string' },
    ],
    numRows: ROWS.length,
    valueAt: (r, c) => ROWS[r][c],
    points: [['latitude', 'longitude']],
  };
}

let drawn: Array<{ id: string; geometry: { type: string; coordinates?: unknown } }> = [];

function actions(): MapActions & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    filterRange: (...a) => (calls.push(['range', ...a]), true),
    filterValues: (...a) => (calls.push(['values', ...a]), true),
    clearFilter: (...a) => void calls.push(['clear', ...a]),
    clearAllFilters: () => (calls.push(['clearAll']), ['mag']),
    fitBounds: (...a) => void calls.push(['fit', ...a]),
    addLayer: (...a) => (calls.push(['add', ...a]), { id: 'ask-1' }),
    updateLayer: (...a) => (calls.push(['update', ...a]), { id: 'L1', type: 'hexagon' }),
    removeLayer: (ref) => (calls.push(['remove', ref]), ref === 'ask-1' ? { id: 'ask-1' } : { error: 'came with the panel' }),
    setView: (...a) => void calls.push(['view', ...a]),
    pitch: () => 0,
    setBasemap: (id) => (calls.push(['basemap', id]), id === 'dark-matter'),
    flyTo: (...a) => void calls.push(['fly', ...a]),
    fadeByZoom: (ref, stops) => (calls.push(['fade', ref, stops]), ref === 'L1' ? { id: 'L1' } : { error: 'No layer' }),
    filterArea: (g) => (calls.push(['area', g]), true),
    clearAreas: () => (calls.push(['clearAreas']), 1),
    drawnAreas: () => drawn,
    setTimeRange: (...a) => void calls.push(['time', ...a]),
    addLayerConfig: (c) => (calls.push(['addConfig', c]), { id: `${String(c.id)}-1` }),
    visibleLayersOf: () => ['L1'],
    undo: () => (calls.push(['undo']), { timeRange: { from: 'now-30d', to: 'now' }, areaFilter: true }),
  };
}

const run = (name: string, args: Record<string, unknown>, a = actions()) => runTool(name, args, { tables: [table()], actions: a });

describe('askMapTools', () => {
  it('describes a numeric column and a text column', () => {
    expect(run('describe_field', { field: 'mag' }).result).toMatchObject({ rows: 5, nulls: 0, min: 4.5, max: 7, median: 5.4 });
    const text = run('describe_field', { field: 'place' }).result as { distinct: number; nulls: number };
    expect(text).toMatchObject({ distinct: 4, nulls: 1 });
  });

  it('filters rows, sorts and limits', () => {
    const out = run('query_rows', {
      where: [{ field: 'place', op: 'contains', value: 'chile' }],
      order_by: 'mag',
      descending: true,
      columns: ['place', 'mag'],
    }).result as { matched: number; rows: unknown[] };
    expect(out.matched).toBe(2);
    expect(out.rows).toEqual([
      { place: 'Iquique, Chile', mag: 7 },
      { place: '10 km N of Santiago, Chile', mag: 6.1 },
    ]);
  });

  it('compares timestamps given as ISO strings', () => {
    const out = run('query_rows', {
      where: [{ field: 'time', op: 'gte', value: '2026-11-02T00:00:00Z' }],
      aggregate: { op: 'max', field: 'mag' },
    }).result;
    expect(out).toMatchObject({ matched: 3, max: 7 });
  });

  it('groups by time bucket largest first or in time order, and by column largest first', () => {
    const top = run('query_rows', { group_by_time: { field: 'time', bucket: 'day' }, limit: 1 }).result as { rows: unknown[] };
    expect(top.rows).toEqual([{ group: '2026-11-01', count: 2 }]);
    const byDay = run('query_rows', { group_by_time: { field: 'time', bucket: 'day', chronological: true } }).result as {
      rows: unknown[];
    };
    expect(byDay.rows).toEqual([
      { group: '2026-11-01', count: 2 },
      { group: '2026-11-02', count: 1 },
      { group: '2026-11-03', count: 2 },
    ]);
    const avg = run('query_rows', {
      where: [{ field: 'place', op: 'not_null' }],
      group_by: 'place',
      aggregate: { op: 'avg', field: 'mag' },
      limit: 1,
    }).result as { rows: unknown[]; truncated: boolean };
    expect(avg.rows).toEqual([{ group: 'Iquique, Chile', count: 1, avg: 7 }]);
    expect(avg.truncated).toBe(true);
  });

  it('turns a numeric filter with an open side into a range over the data', () => {
    const a = actions();
    const out = run('filter_map', { field: 'mag', min: 6 }, a);
    expect(a.calls).toEqual([['range', 'mag', [6, 7]]]);
    expect(out.mapChange).toBe('Filtered mag 6 – 7');
    expect(out.result).toMatchObject({ rowsInRange: 2 });
  });

  it('filters a time column in epoch milliseconds', () => {
    const a = actions();
    run('filter_map', { field: 'time', min: '2026-11-02T00:00:00Z', max: '2026-11-03T00:00:00Z' }, a);
    expect(a.calls[0]).toEqual(['range', 'time', [Date.parse('2026-11-02T00:00:00Z'), Date.parse('2026-11-03T00:00:00Z')]]);
  });

  it('filters a text column on values, and asks for values when none are given', () => {
    const a = actions();
    run('filter_map', { field: 'place', values: ['Lima, Peru'] }, a);
    expect(a.calls).toEqual([['values', 'place', ['Lima, Peru']]]);
    expect(run('filter_map', { field: 'place' }).result).toMatchObject({ error: expect.stringContaining('give values') });
  });

  it('frames the matching rows, skipping rows without coordinates', () => {
    const a = actions();
    const out = run('zoom_to', { where: [{ field: 'place', op: 'contains', value: 'Chile' }] }, a);
    expect(out.result).toMatchObject({ rows: 2 });
    const [, bounds] = a.calls[0] as [string, number[]];
    expect(bounds[0]).toBeLessThan(-70.6);
    expect(bounds[1]).toBeLessThan(-33.4);
    expect(bounds[2]).toBeGreaterThan(-70.1);
    expect(bounds[3]).toBeGreaterThan(-20.2);
  });

  it('answers a wrong column or dataset with an error the model can act on', () => {
    expect(run('describe_field', { field: 'Mag' }).result).toEqual({ error: 'No column "Mag"; did you mean "mag"?' });
    expect(run('query_rows', { dataset: 'nope' }).result).toMatchObject({ error: expect.stringContaining('Datasets: quakes') });
    expect(run('nope', {}).result).toEqual({ error: 'Unknown tool nope.' });
  });

  it('adds a 3D hexagon layer coloured by a column and tilts the flat map', () => {
    const a = actions();
    const out = run('add_layer', { type: 'hexagon', color_by: 'mag', three_d: true, palette: 'viridis' }, a);
    const [, spec, extentKm] = a.calls[0] as [string, Record<string, unknown>, number];
    expect(spec).toMatchObject({
      type: 'hexagon',
      dataId: 'A',
      lat: 'latitude',
      lng: 'longitude',
      colorBy: { name: 'mag', type: 'real' },
      threeD: true,
      palette: 'viridis',
    });
    expect(extentKm).toBeGreaterThan(10000);
    expect(a.calls[1]).toEqual(['view', { pitch: 45 }]);
    expect(out.mapChange).toBe('Added hexagon layer "quakes hexagon 3D", tilted the map to 45°');
    expect(out.result).toMatchObject({ encoding: 'colour: average mag per cell; height: number of rows per cell' });
  });

  it('refuses an unknown layer type, column or palette with a usable message', () => {
    expect(run('add_layer', { type: 'pie' }).result).toMatchObject({ error: expect.stringContaining('point, heatmap') });
    expect(run('add_layer', { type: 'point', color_by: 'nope' }).result).toMatchObject({ error: expect.stringContaining('No column') });
    expect(run('add_layer', { type: 'point', palette: 'Plaid' }).result).toMatchObject({ error: expect.stringContaining('Global Warming') });
  });

  it('updates a layer, removes only added ones, moves the camera and switches base maps', () => {
    const a = actions();
    run('update_layer', { layer: 'L1', visible: false, size_by: 'mag' }, a);
    expect(a.calls[0]).toEqual(['update', 'L1', expect.objectContaining({ visible: false, sizeBy: { name: 'mag', type: 'real' } })]);
    expect(run('remove_layer', { layer: 'ask-1' }, a).mapChange).toBe('Removed layer "ask-1"');
    expect(run('remove_layer', { layer: 'L1' }, a).result).toEqual({ error: 'came with the panel' });
    expect(run('set_view', { pitch: 80, bearing: 30 }, a).result).toMatchObject({ pitch: 60, bearing: 30 });
    expect(run('set_basemap', { id: 'nope' }, a).result).toMatchObject({ error: expect.stringContaining('No base map') });
  });

  it('counts and filters rows inside a circle, a box and the drawn area', () => {
    // 1000 km around Santiago reaches Iquique? No: ~1400 km. 500 km keeps Santiago only.
    const near = run('query_rows', { area: { shape: 'circle', latitude: -33.4, longitude: -70.6, radius_km: 500 }, aggregate: { op: 'count' } });
    expect(near.result).toMatchObject({ matched: 1 });
    const a = actions();
    const out = run('filter_area', { area: { shape: 'box', west: -80, south: -40, east: -60, north: -10 } }, a);
    expect(out.result).toMatchObject({ inside: [{ dataset: 'quakes', rowsInside: 3 }] });
    expect((a.calls[0] as [string, { type: string }])[1].type).toBe('Polygon');
    expect(run('query_rows', { area: { shape: 'drawn' } }).result).toMatchObject({ error: expect.stringContaining('No area is drawn') });
    drawn = [{ id: 'd1', geometry: { type: 'Polygon', coordinates: [[[130, 30], [150, 30], [150, 40], [130, 40], [130, 30]]] } }];
    expect(run('query_rows', { area: { shape: 'drawn' }, columns: ['place'] }).result).toMatchObject({ matched: 1, rows: [{ place: 'Tokyo, Japan' }] });
    drawn = [];
  });

  it('flies, fades by zoom, sets the dashboard time and undoes', () => {
    const a = actions();
    run('fly_to', { latitude: 35.7, longitude: 139.7, zoom: 8 }, a);
    expect(a.calls[0]).toEqual(['fly', { latitude: 35.7, longitude: 139.7, zoom: 8 }, 3]);
    run('fade_by_zoom', { layer: 'L1', appear: 5, full: 6 }, a);
    expect(a.calls[1]).toEqual(['fade', 'L1', { appear: 5, full: 6, fade: 24, gone: 24 }]);
    expect(run('fade_by_zoom', { layer: 'L1', appear: 8, full: 6 }).result).toMatchObject({ error: expect.stringContaining('appear ≤ full') });
    run('set_time_range', { from: 'now-7d', to: 'now' }, a);
    run('set_time_range', { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' }, a);
    expect(a.calls.slice(2, 4)).toEqual([
      ['time', 'now-7d', 'now'],
      ['time', String(Date.parse('2026-11-01T00:00:00Z')), String(Date.parse('2026-11-02T00:00:00Z'))],
    ]);
    expect(run('set_time_range', { from: 'last week', to: 'now' }).result).toMatchObject({ error: expect.stringContaining('relative time') });
    const undone = run('undo', {}, a);
    expect(undone.mapChange).toBe('Undid the previous changes');
    expect(undone.result).toMatchObject({ dashboardTimeRange: { from: 'now-30d', to: 'now' }, areaFilter: true });
  });

  it('reads seconds and milliseconds as the same instant', () => {
    expect(toComparable(1_700_000_000, 'timestamp')).toBe(1_700_000_000_000);
    expect(toComparable(1_700_000_000_000, 'timestamp')).toBe(1_700_000_000_000);
  });
});
