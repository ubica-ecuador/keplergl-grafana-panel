import { FieldType, toDataFrame } from '@grafana/data';

import { detectFields, resolveRoles } from './detectFields';

describe('resolveRoles', () => {
  it('falls back to autodetection for roles the user has not touched', () => {
    expect(resolveRoles({ latitude: 'lat', longitude: 'lng' }, undefined)).toEqual({
      latitude: 'lat',
      longitude: 'lng',
    });
  });

  it('lets an override replace a detected column', () => {
    expect(resolveRoles({ latitude: 'lat' }, { latitude: 'y' })).toEqual({ latitude: 'y' });
  });

  it('drops a role the user has explicitly switched off', () => {
    // `null` is the third state the editor needs: an absent key means "keep
    // detecting", which is why clearing the field could never disable a role.
    expect(resolveRoles({ latitude: 'lat', tripId: 'track_id' }, { tripId: null })).toEqual({ latitude: 'lat' });
  });
});

describe('detectFields', () => {
  it('recognises latitude and longitude by name', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'latitude', type: FieldType.number, values: [-2.9] },
        { name: 'longitude', type: FieldType.number, values: [-79.0] },
      ],
    });

    expect(detectFields(frame)).toEqual({ latitude: 'latitude', longitude: 'longitude' });
  });

  it('accepts the common abbreviations', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [-2.9] },
        { name: 'lng', type: FieldType.number, values: [-79.0] },
      ],
    });

    expect(detectFields(frame)).toEqual({ latitude: 'lat', longitude: 'lng' });
  });

  it('picks the time field by type, whatever it is called', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'latitude', type: FieldType.number, values: [-2.9] },
        { name: 'longitude', type: FieldType.number, values: [-79.0] },
        { name: 'recorded_at', type: FieldType.time, values: [1] },
      ],
    });

    expect(detectFields(frame).time).toBe('recorded_at');
  });

  it('recognises a geometry column', () => {
    const frame = toDataFrame({
      fields: [{ name: 'geom', type: FieldType.string, values: ['0101000020E6100000'] }],
    });

    expect(detectFields(frame).geometry).toBe('geom');
  });

  it('recognises an H3 column', () => {
    const frame = toDataFrame({
      fields: [{ name: 'h3_index', type: FieldType.string, values: ['8a2a1072b59ffff'] }],
    });

    expect(detectFields(frame).h3).toBe('h3_index');
  });

  it('recognises a trip identifier', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'latitude', type: FieldType.number, values: [-2.9] },
        { name: 'longitude', type: FieldType.number, values: [-79.0] },
        { name: 'trip_id', type: FieldType.string, values: ['a'] },
      ],
    });

    expect(detectFields(frame).tripId).toBe('trip_id');
  });

  it('recognises origin/destination columns for the flow layer', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'origin_lat', type: FieldType.number, values: [-2.9] },
        { name: 'origin_lon', type: FieldType.number, values: [-79.0] },
        { name: 'dest_lat', type: FieldType.number, values: [-2.8] },
        { name: 'dest_lon', type: FieldType.number, values: [-78.9] },
        { name: 'trips', type: FieldType.number, values: [42] },
      ],
    });

    expect(detectFields(frame)).toMatchObject({
      originLat: 'origin_lat',
      originLng: 'origin_lon',
      destLat: 'dest_lat',
      destLng: 'dest_lon',
      count: 'trips',
    });
  });

  it('leaves altitude unmapped even when the query carries an elevation column', () => {
    // GPS traces routinely carry elevation above sea level. Feeding it to the
    // trip layer draws the trail kilometres above the ground, where deck.gl's
    // camera loses it as soon as the user zooms past that height — the trip
    // simply vanishes. Height on a trip path has to be an explicit choice.
    const frame = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [-2.88] },
        { name: 'lng', type: FieldType.number, values: [-79.01] },
        { name: 'elevation', type: FieldType.number, values: [2650] },
        { name: 'track_id', type: FieldType.string, values: ['a'] },
      ],
    });

    expect(detectFields(frame).altitude).toBeUndefined();
  });

  it('claims no roles at all for a non-geospatial frame', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'cpu', type: FieldType.number, values: [0.4] },
        { name: 'memory', type: FieldType.number, values: [128] },
      ],
    });

    expect(detectFields(frame)).toEqual({});
  });

  it('does not mistake a plain latitude column for an origin latitude', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'latitude', type: FieldType.number, values: [-2.9] },
        { name: 'longitude', type: FieldType.number, values: [-79.0] },
      ],
    });

    const roles = detectFields(frame);
    expect(roles.originLat).toBeUndefined();
    expect(roles.destLat).toBeUndefined();
  });
});
