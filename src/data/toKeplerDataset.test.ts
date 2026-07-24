import { FieldType, toDataFrame } from '@grafana/data';

import { toKeplerRows } from './toKeplerDataset';

describe('toKeplerRows', () => {
  it('turns frame columns into row objects', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'latitude', type: FieldType.number, values: [-2.9, -2.8] },
        { name: 'longitude', type: FieldType.number, values: [-79.0, -78.9] },
      ],
    });

    expect(toKeplerRows(frame, { latitude: 'latitude', longitude: 'longitude' })).toEqual([
      { latitude: -2.9, longitude: -79.0 },
      { latitude: -2.8, longitude: -78.9 },
    ]);
  });

  it('renames mapped columns to the names kepler auto-detects', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'pickup_y', type: FieldType.number, values: [-2.9] },
        { name: 'pickup_x', type: FieldType.number, values: [-79.0] },
      ],
    });

    expect(toKeplerRows(frame, { latitude: 'pickup_y', longitude: 'pickup_x' })).toEqual([
      { latitude: -2.9, longitude: -79.0 },
    ]);
  });

  it('keeps unmapped columns so they show up in tooltips', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'latitude', type: FieldType.number, values: [-2.9] },
        { name: 'longitude', type: FieldType.number, values: [-79.0] },
        { name: 'driver', type: FieldType.string, values: ['ana'] },
      ],
    });

    expect(toKeplerRows(frame, { latitude: 'latitude', longitude: 'longitude' })).toEqual([
      { latitude: -2.9, longitude: -79.0, driver: 'ana' },
    ]);
  });

  it('decodes a PostGIS EWKB geometry column into GeoJSON, which kepler renders', () => {
    // POINT (1 2), SRID=4326 — raw EWKB hex, as `SELECT geom` returns it.
    const frame = toDataFrame({
      fields: [{ name: 'geom', type: FieldType.string, values: ['0101000020E6100000000000000000F03F0000000000000040'] }],
    });

    expect(toKeplerRows(frame, { geometry: 'geom' })).toEqual([
      { _geojson: '{"type":"Point","coordinates":[1,2]}' },
    ]);
  });

  it('leaves a GeoJSON geometry column alone', () => {
    const geojson = '{"type":"Point","coordinates":[1,2]}';
    const frame = toDataFrame({
      fields: [{ name: 'geom', type: FieldType.string, values: [geojson] }],
    });

    expect(toKeplerRows(frame, { geometry: 'geom' })).toEqual([{ _geojson: geojson }]);
  });

  it('maps origin/destination roles onto the flow layer column names', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'origin_lat', type: FieldType.number, values: [-2.9] },
        { name: 'origin_lon', type: FieldType.number, values: [-79.0] },
        { name: 'dest_lat', type: FieldType.number, values: [-2.8] },
        { name: 'dest_lon', type: FieldType.number, values: [-78.9] },
        { name: 'trips', type: FieldType.number, values: [42] },
      ],
    });

    expect(
      toKeplerRows(frame, {
        originLat: 'origin_lat',
        originLng: 'origin_lon',
        destLat: 'dest_lat',
        destLng: 'dest_lon',
        count: 'trips',
      })
    ).toEqual([{ lat0: -2.9, lng0: -79.0, lat1: -2.8, lng1: -78.9, count: 42 }]);
  });

  it('returns no rows for an empty frame', () => {
    const frame = toDataFrame({ fields: [{ name: 'latitude', type: FieldType.number, values: [] }] });

    expect(toKeplerRows(frame, { latitude: 'latitude' })).toEqual([]);
  });

  it('preserves nulls rather than dropping the row', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'latitude', type: FieldType.number, values: [-2.9, null] },
        { name: 'longitude', type: FieldType.number, values: [-79.0, -78.9] },
      ],
    });

    expect(toKeplerRows(frame, { latitude: 'latitude', longitude: 'longitude' })).toEqual([
      { latitude: -2.9, longitude: -79.0 },
      { latitude: null, longitude: -78.9 },
    ]);
  });
});
