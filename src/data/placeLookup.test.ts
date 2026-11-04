import { FieldType, toDataFrame } from '@grafana/data';

import { decodeGeohash, parseGazetteer, placeFrame } from './placeLookup';
import { detectFields } from './detectFields';
import { framesToDatasets } from './framesToDatasets';

describe('rows placed by geohash or by name', () => {
  it('decodes a geohash to its cell’s centre', () => {
    // Quito's cell, and the classic example from the geohash article.
    const [lat, lng] = decodeGeohash('6rbny')!;
    expect(lat).toBeCloseTo(-0.2, 1);
    expect(lng).toBeCloseTo(-78.5, 1);
    const [lat2, lng2] = decodeGeohash('ezs42')!;
    expect(lat2).toBeCloseTo(42.6, 1);
    expect(lng2).toBeCloseTo(-5.6, 1);
    expect(decodeGeohash('not a hash!')).toBeNull();
  });

  it('reads Worldmap’s list of places by name, key and keys, any case', () => {
    const places = parseGazetteer([
      { keys: ['EC', 'ECU'], latitude: -1.8, longitude: -78.2, name: 'Ecuador' },
      { key: 'TX', latitude: 31.1, longitude: -97.6, name: 'Texas' },
    ]);
    expect(places.get('ECU')).toEqual([-1.8, -78.2]);
    expect(places.get('ECUADOR')).toEqual([-1.8, -78.2]);
    expect(places.get('TX')).toEqual([31.1, -97.6]);
  });

  it('reads a GeoJSON gazetteer by its id and code properties', () => {
    const places = parseGazetteer({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-78.36, -0.12] },
          properties: { name: 'Mariscal Sucre', iata_code: 'UIO', gps_code: 'SEQM' },
        },
      ],
    });
    expect(places.get('UIO')).toEqual([-0.12, -78.36]);
    expect(places.get('SEQM')).toEqual([-0.12, -78.36]);
  });

  it('gives a frame coordinates from its geohash column, and leaves unknown rows unplaced', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'geohash', type: FieldType.string, values: ['6rbny', '??'] },
        { name: 'count', type: FieldType.number, values: [3, 4] },
      ],
    });
    const placed = placeFrame(frame, detectFields(frame), null);
    const lat = placed.frame.fields.find((f) => f.name === placed.roles.latitude)!;
    expect(lat.values[0]).toBeCloseTo(-0.2, 1);
    expect(lat.values[1]).toBeNull();
  });

  it('places named rows once the gazetteer has loaded, and draws them as points', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'lookup', type: FieldType.string, values: ['ec', 'PER'] },
        { name: 'cases', type: FieldType.number, values: [10, 20] },
      ],
    });
    const gazetteer = parseGazetteer([
      { keys: ['EC'], latitude: -1.8, longitude: -78.2, name: 'Ecuador' },
      { keys: ['PER'], latitude: -9.2, longitude: -75, name: 'Peru' },
    ]);

    expect(framesToDatasets([frame])[0].rows[0]).not.toHaveProperty('latitude');
    const [dataset] = framesToDatasets([frame], {}, { gazetteer });
    expect(dataset.rows.map((r) => [r.latitude, r.longitude])).toEqual([
      [-1.8, -78.2],
      [-9.2, -75],
    ]);
  });

  it('keeps a query’s own coordinates over its geohash', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'lat', type: FieldType.number, values: [1] },
        { name: 'lon', type: FieldType.number, values: [2] },
        { name: 'geohash', type: FieldType.string, values: ['6rbny'] },
      ],
    });
    expect(placeFrame(frame, detectFields(frame), null).frame).toBe(frame);
  });
});
