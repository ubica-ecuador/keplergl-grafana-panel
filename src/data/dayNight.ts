import type { PanelDataset } from './framesToDatasets';
import { KEPLER_COLUMN } from './toKeplerDataset';

/**
 * The night side of the Earth at a moment, and the point the sun stands over.
 *
 * The sun's position comes from NOAA's general solar position formulas
 * (declination and equation of time from the fractional year), good to about a
 * quarter of a degree, which a map shading half the planet cannot show. The
 * terminator is where the sun's elevation is zero: for a longitude λ,
 * tan φ = −cos(λ − λs) / tan δ, with δ the declination and λs the subsolar
 * longitude. The night is the side of that line away from the sun.
 */

/** Where the panel draws the night: at the end of the dashboard range, at its start, or not at all. */
export type DayNightMode = 'off' | 'to' | 'from';

export const NIGHT_DATASET_ID = 'day-night';
export const SUN_DATASET_ID = 'day-night-sun';

/** Web Mercator stops short of the poles; a polygon reaching ±90° projects to infinity. */
const POLE = 85.0511;
const STEP_DEGREES = 2;

export function subsolarPoint(at: Date): { latitude: number; longitude: number } {
  const start = Date.UTC(at.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((at.getTime() - start) / 86_400_000) + 1;
  const hours = at.getUTCHours() + at.getUTCMinutes() / 60 + at.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);
  const declination =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const longitude = -15 * (hours - 12 + equationOfTime / 60);
  return { latitude: (declination * 180) / Math.PI, longitude: wrap(longitude) };
}

/** The night side as one polygon, from the terminator to the pole the sun does not light. */
export function nightPolygon(at: Date): { type: 'Polygon'; coordinates: number[][][] } {
  const sun = subsolarPoint(at);
  // At an equinox the terminator is a meridian pair; a hair of declination keeps
  // the formula finite and the polygon on the right side.
  const declination = toRadians(Math.abs(sun.latitude) < 1e-4 ? 1e-4 : sun.latitude);
  const terminator: number[][] = [];
  for (let lng = -180; lng <= 180; lng += STEP_DEGREES) {
    const lat = Math.atan(-Math.cos(toRadians(lng - sun.longitude)) / Math.tan(declination));
    terminator.push([lng, clamp((lat * 180) / Math.PI)]);
  }
  // The sun north of the equator lights the north pole: the night closes over the south one.
  const pole = declination > 0 ? -POLE : POLE;
  return { type: 'Polygon', coordinates: [[...terminator, [180, pole], [-180, pole], terminator[0]]] };
}

/**
 * The night once per copy of the world a zoomed-out map shows side by side.
 * kepler draws a polygon only where its coordinates are, so without the copies
 * a map wider than the world cut the night off at the antimeridian.
 */
export function nightShape(at: Date): { type: 'MultiPolygon'; coordinates: number[][][][] } {
  const ring = nightPolygon(at).coordinates[0];
  return {
    type: 'MultiPolygon',
    coordinates: [-360, 0, 360].map((shift) => [ring.map(([lng, lat]) => [lng + shift, lat])]),
  };
}

/** The panel's own datasets for the night shading, and the sun when asked. */
export function dayNightDatasets(at: Date, sun: boolean, color: [number, number, number]): PanelDataset[] {
  const datasets: PanelDataset[] = [
    {
      id: NIGHT_DATASET_ID,
      label: 'Night',
      // No time column: a time filter on the map must not hide the night it is showing.
      rows: [{ _geojson: nightShape(at), name: 'Night' }],
      fixedLayer: {
        id: `night-${NIGHT_DATASET_ID}`,
        type: 'geojson',
        config: {
          dataId: NIGHT_DATASET_ID,
          label: 'Night',
          color,
          columns: { geojson: '_geojson' },
          isVisible: true,
          visConfig: { opacity: 0.3, filled: true, stroked: false },
        },
        visualChannels: {},
      },
    },
  ];
  if (sun) {
    const { latitude, longitude } = subsolarPoint(at);
    datasets.push({
      id: SUN_DATASET_ID,
      label: 'Sun',
      rows: [{ [KEPLER_COLUMN.latitude]: latitude, [KEPLER_COLUMN.longitude]: longitude, name: 'Sun' }],
      fixedLayer: {
        id: `sun-${SUN_DATASET_ID}`,
        type: 'point',
        config: {
          dataId: SUN_DATASET_ID,
          label: 'Sun',
          color: SUN_COLOR,
          columns: { lat: KEPLER_COLUMN.latitude, lng: KEPLER_COLUMN.longitude },
          isVisible: true,
          visConfig: { radius: 40, opacity: 1, filled: true },
        },
        visualChannels: {},
      },
    });
  }
  return datasets;
}

/** Geomap's sun. */
export const SUN_COLOR: [number, number, number] = [253, 184, 19];
/** Geomap's night, `#a7a6ba` at 30 %. */
export const NIGHT_COLOR: [number, number, number] = [167, 166, 186];

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function wrap(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function clamp(latitude: number): number {
  return Math.max(-POLE, Math.min(POLE, latitude));
}
