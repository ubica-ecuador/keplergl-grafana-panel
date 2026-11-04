import { type DataFrame, FieldType } from '@grafana/data';

import type { FieldRoles } from './detectFields';

/**
 * Rows placed by something other than coordinates: a geohash, or a name or
 * code looked up in a gazetteer. Geomap's `geohash` and `lookup` location modes.
 *
 * Either way the frame gains a latitude and a longitude column, under names no
 * query uses, and the roles point at them; everything downstream then sees an
 * ordinary table of points. Rows whose place is unknown keep null coordinates:
 * they stay in the table and the tooltip, and kepler draws no point for them,
 * as Geomap draws none.
 */

/** The columns a placed frame gains; renamed to kepler's latitude and longitude like any other. */
export const PLACED_LATITUDE = '__placed_latitude';
export const PLACED_LONGITUDE = '__placed_longitude';

/** Grafana's own gazetteers, as Geomap names them. */
export const GAZETTEERS = {
  countries: 'public/gazetteer/countries.json',
  usaStates: 'public/gazetteer/usa-states.json',
  airports: 'public/gazetteer/airports.geojson',
};

/** A place name or code → [latitude, longitude]. */
export type Gazetteer = Map<string, [number, number]>;

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** A geohash's centre, or null for anything that is not one. */
export function decodeGeohash(hash: unknown): [number, number] | null {
  if (typeof hash !== 'string' || !hash) {
    return null;
  }
  let [latMin, latMax, lngMin, lngMax] = [-90, 90, -180, 180];
  let even = true;
  for (const char of hash.toLowerCase()) {
    const bits = BASE32.indexOf(char);
    if (bits < 0) {
      return null;
    }
    for (let mask = 16; mask > 0; mask >>= 1) {
      const on = (bits & mask) !== 0;
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        [lngMin, lngMax] = on ? [mid, lngMax] : [lngMin, mid];
      } else {
        const mid = (latMin + latMax) / 2;
        [latMin, latMax] = on ? [mid, latMax] : [latMin, mid];
      }
      even = !even;
    }
  }
  return [(latMin + latMax) / 2, (lngMin + lngMax) / 2];
}

/**
 * A gazetteer from the file Geomap would read: Worldmap's list of
 * `{key | keys, name, latitude, longitude}` (Grafana's countries and US states),
 * or a GeoJSON collection (its airports), keyed by the properties Geomap keys
 * on — `id`, `uid`, `key`, `code` and anything ending `_id` or `_code`, else the
 * first text one — and placed at a point, or at the middle of a shape's extent.
 */
export function parseGazetteer(data: unknown): Gazetteer {
  const places: Gazetteer = new Map();
  const add = (key: unknown, at: [number, number]) => {
    if (key === null || key === undefined || key === '') {
      return;
    }
    const text = String(key);
    places.set(text, at);
    places.set(text.toUpperCase(), at);
  };

  if (Array.isArray(data)) {
    for (const entry of data as Array<Record<string, unknown>>) {
      const lat = Number(entry?.latitude);
      const lng = Number(entry?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }
      add(entry.name, [lat, lng]);
      add(entry.key, [lat, lng]);
      for (const key of Array.isArray(entry.keys) ? entry.keys : []) {
        add(key, [lat, lng]);
      }
    }
    return places;
  }

  const features = (data as { type?: string; features?: unknown[] })?.features;
  if ((data as { type?: string })?.type !== 'FeatureCollection' || !Array.isArray(features)) {
    return places;
  }
  for (const feature of features as Array<{
    id?: unknown;
    properties?: Record<string, unknown>;
    geometry?: Geometry;
  }>) {
    const at = centre(feature?.geometry);
    if (!at) {
      continue;
    }
    const properties = feature.properties ?? {};
    const keys = Object.keys(properties).filter((name) => {
      const upper = name.toUpperCase();
      return ['ID', 'UID', 'KEY', 'CODE'].includes(upper) || upper.endsWith('_ID') || upper.endsWith('_CODE');
    });
    const firstText = Object.keys(properties).find((name) => typeof properties[name] === 'string');
    for (const key of keys.length ? keys : firstText ? [firstText] : []) {
      add(properties[key], at);
    }
    add(feature.id, at);
  }
  return places;
}

interface Geometry {
  type?: string;
  coordinates?: unknown;
}

/** A point's position, or the middle of a shape's extent, as [latitude, longitude]. */
function centre(geometry: Geometry | undefined): [number, number] | null {
  const positions: number[][] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value) && typeof value[0] === 'number') {
      positions.push(value as number[]);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    }
  };
  walk(geometry?.coordinates);
  if (!positions.length) {
    return null;
  }
  const lngs = positions.map((p) => p[0]);
  const lats = positions.map((p) => p[1]);
  return [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
}

/** Whether a frame is placed by geohash or lookup rather than by its own coordinates. */
export function placedByName(roles: FieldRoles): boolean {
  return !(roles.latitude && roles.longitude) && Boolean(roles.geohash || roles.lookup);
}

/**
 * The frame with a latitude and longitude for every row it can place, and the
 * roles pointing at them. A frame with coordinates of its own, or with neither
 * a geohash nor a lookup column, comes back as it was. A lookup waits for its
 * gazetteer: without one the frame is returned unplaced.
 */
export function placeFrame(
  frame: DataFrame,
  roles: FieldRoles,
  gazetteer: Gazetteer | null | undefined
): { frame: DataFrame; roles: FieldRoles } {
  if (!placedByName(roles)) {
    return { frame, roles };
  }
  const byHash = roles.geohash ? frame.fields.find((f) => f.name === roles.geohash) : undefined;
  const byName = !byHash && roles.lookup ? frame.fields.find((f) => f.name === roles.lookup) : undefined;
  if (!byHash && !(byName && gazetteer)) {
    return { frame, roles };
  }
  const lat: Array<number | null> = [];
  const lng: Array<number | null> = [];
  for (let i = 0; i < frame.length; i++) {
    const value = (byHash ?? byName)!.values[i];
    const at = byHash ? decodeGeohash(value) : findPlace(gazetteer!, value);
    lat.push(at ? at[0] : null);
    lng.push(at ? at[1] : null);
  }
  return {
    frame: {
      ...frame,
      fields: [
        ...frame.fields,
        { name: PLACED_LATITUDE, type: FieldType.number, config: {}, values: lat },
        { name: PLACED_LONGITUDE, type: FieldType.number, config: {}, values: lng },
      ],
    },
    roles: { ...roles, latitude: PLACED_LATITUDE, longitude: PLACED_LONGITUDE },
  };
}

/** kepler's GeoHash layer for a dataset, drawn on its geohash column. */
export interface GeohashLayerConfig {
  id: string;
  type: 'geohash';
  config: { dataId: string; label: string; columns: { token: string }; isVisible: boolean };
  visualChannels: Record<string, unknown>;
}

/**
 * The GeoHash layer of a frame placed by its geohash column and nothing else,
 * or null. Such a frame is a table of cells: kepler draws each cell, where the
 * placed centres alone would be a Point layer of dots. Built by the panel so
 * that it can stand in for both of kepler's guesses on that dataset — the Point
 * on the placed centres, and since 3.3.0-alpha.19 a GeoHash of its own whenever
 * a column is named `geohash` — and so that a geohash column under another
 * name, mapped by hand, draws its cells too. The centres stay in the dataset:
 * click variables, framing and a Point or Heatmap added by hand read them.
 */
export function buildGeohashLayer(roles: FieldRoles, dataId: string, label: string): GeohashLayerConfig | null {
  if (!roles.geohash || roles.latitude !== PLACED_LATITUDE || roles.longitude !== PLACED_LONGITUDE) {
    return null;
  }
  return {
    id: `${dataId}-geohash`,
    type: 'geohash',
    config: { dataId, label, columns: { token: roles.geohash }, isVisible: true },
    visualChannels: {},
  };
}

function findPlace(gazetteer: Gazetteer, value: unknown): [number, number] | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value);
  return gazetteer.get(text) ?? gazetteer.get(text.toUpperCase());
}
