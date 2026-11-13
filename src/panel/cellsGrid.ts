import { cellArea as a5CellArea, cellToParent as a5Parent, lonLatToCell } from 'a5-js';
import { cellArea as h3CellArea, cellToParent as h3Parent, getHexagonAreaAvg, latLngToCell } from 'h3-js';
import { S2 } from 's2-geometry';

/**
 * The discrete global grids a Cells layer bins points into.
 *
 * Each row is given its cell once, at the system's finest level here (FINE), and every coarser cell is its parent:
 * a zoom change then costs a parent per row (a bit operation or a string prefix), not a new cell per row. That
 * matters most for A5, whose a5-js 0.7.3 placed only about 25,000 points a second (H3 about 660,000); 0.10.1, which
 * deck.gl 9.4 brings, places about three times as many, with the same cells.
 */
export type CellSystem = 'h3' | 'a5' | 's2' | 'geohash';
export const CELL_SYSTEMS: CellSystem[] = ['h3', 'a5', 's2', 'geohash'];

export type CellId = string | bigint;

const EARTH_RADIUS_M = 6371008.8;
const EARTH_AREA_M2 = 4 * Math.PI * EARTH_RADIUS_M ** 2;
const METRES_PER_DEGREE = (2 * Math.PI * EARTH_RADIUS_M) / 360;
/** The earth's circumference over a 512-pixel world at zoom 0: deck's metres per pixel at the equator. */
const EQUATOR_M_PER_PX = (2 * Math.PI * 6378137) / 512;

interface System {
  minRes: number;
  /** The level each row is placed at once; coarser cells are its parents. */
  fine: number;
  /** A point's cell at the fine level. */
  fineCellOf(lat: number, lng: number): CellId;
  /** The ancestor at `res` (res ≤ fine) of a fine cell. */
  parentOf(fine: CellId, res: number): CellId;
  /** A cell's side, the square root of its area in m², at `res` near `lat`. */
  sideM(res: number, lat: number): number;
  /** One cell's area in km² (exact where the library knows it, else the level's mean). */
  areaKm2(cell: CellId, res: number): number;
}

/** Geohash in its usual base 32, one character per level. */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohashOf(lat: number, lng: number, chars: number): string {
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < chars) {
    if (even) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngLo = mid;
      } else {
        ch <<= 1;
        lngHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latLo = mid;
      } else {
        ch <<= 1;
        latHi = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** A geohash cell's width and height in degrees for `chars` characters. */
function geohashSpanDeg(chars: number): [number, number] {
  const bits = 5 * chars;
  const lngBits = Math.ceil(bits / 2);
  const latBits = Math.floor(bits / 2);
  return [360 / 2 ** lngBits, 180 / 2 ** latBits];
}

function geohashAreaM2(chars: number, lat: number): number {
  const [w, h] = geohashSpanDeg(chars);
  return w * METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180) * h * METRES_PER_DEGREE;
}

const SYSTEMS: Record<CellSystem, System> = {
  h3: {
    minRes: 0,
    fine: 12,
    fineCellOf: (lat, lng) => latLngToCell(lat, lng, 12),
    parentOf: (fine, res) => (res >= 12 ? fine : h3Parent(fine as string, res)),
    sideM: (res) => Math.sqrt(getHexagonAreaAvg(res, 'm2')),
    areaKm2: (cell) => h3CellArea(cell as string, 'km2'),
  },
  a5: {
    minRes: 0,
    fine: 20,
    // a5-js brands its degrees; plain numbers are degrees here.
    fineCellOf: (lat, lng) => lonLatToCell([lng, lat] as never, 20),
    parentOf: (fine, res) => (res >= 20 ? fine : a5Parent(fine as bigint, res)),
    sideM: (res) => Math.sqrt(a5CellArea(res)),
    areaKm2: (_cell, res) => a5CellArea(res) / 1e6,
  },
  s2: {
    // Level 0 is a whole cube face, a key with no digits.
    minRes: 1,
    fine: 20,
    // "face/digits", one quadtree digit per level: a parent is a prefix.
    fineCellOf: (lat, lng) => S2.latLngToKey(lat, lng, 20),
    parentOf: (fine, res) => (fine as string).slice(0, 2 + res),
    sideM: (res) => Math.sqrt(EARTH_AREA_M2 / (6 * 4 ** res)),
    areaKm2: (_cell, res) => EARTH_AREA_M2 / (6 * 4 ** res) / 1e6,
  },
  geohash: {
    minRes: 1,
    fine: 10,
    fineCellOf: (lat, lng) => geohashOf(lat, lng, 10),
    parentOf: (fine, res) => (fine as string).slice(0, res),
    sideM: (res, lat) => Math.sqrt(geohashAreaM2(res, lat)),
    areaKm2: (cell, res) => {
      const [, h] = geohashSpanDeg(res);
      // The cell's own latitude: geohash cells shrink towards the poles.
      const lat = geohashCentreLat(cell as string, h);
      return geohashAreaM2(res, lat) / 1e6;
    },
  },
};

function geohashCentreLat(hash: string, heightDeg: number): number {
  let latLo = -90;
  let latHi = 90;
  let even = true;
  for (const c of hash) {
    const v = BASE32.indexOf(c);
    for (let b = 4; b >= 0; b--) {
      if (!even) {
        const mid = (latLo + latHi) / 2;
        if ((v >> b) & 1) {
          latLo = mid;
        } else {
          latHi = mid;
        }
      }
      even = !even;
    }
  }
  return Math.min(90 - heightDeg / 2, Math.max(-90 + heightDeg / 2, (latLo + latHi) / 2));
}

export function systemOf(name: unknown): CellSystem {
  return CELL_SYSTEMS.includes(name as CellSystem) ? (name as CellSystem) : 'h3';
}

export function fineCellOf(system: CellSystem, lat: number, lng: number): CellId {
  return SYSTEMS[system].fineCellOf(lat, lng);
}

export function parentOf(system: CellSystem, fine: CellId, res: number): CellId {
  return SYSTEMS[system].parentOf(fine, res);
}

export function cellAreaKm2(system: CellSystem, cell: CellId, res: number): number {
  return SYSTEMS[system].areaKm2(cell, res);
}

/** deck's ground metres per screen pixel at `zoom` and `lat`. */
export function metresPerPixel(zoom: number, lat: number): number {
  return (EQUATOR_M_PER_PX * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * The level whose cells come closest to `cellPx` pixels across at this zoom and latitude, compared in log scale (a
 * cell twice too big is as far as one half too small). Clamped to the system's levels, the fine one at most.
 */
export function resolutionFor(system: CellSystem, cellPx: number, zoom: number, lat: number): number {
  const def = SYSTEMS[system];
  const target = cellPx * metresPerPixel(zoom, lat);
  let best = def.minRes;
  let bestError = Infinity;
  for (let res = def.minRes; res <= def.fine; res++) {
    const error = Math.abs(Math.log(def.sideM(res, lat) / target));
    if (error < bestError) {
      best = res;
      bestError = error;
    }
  }
  return best;
}

/** An S2 cell's token (hex id without trailing zeros), which deck's S2Layer reads, from its "face/digits" key. */
export function s2TokenOf(key: string): string {
  const hex = BigInt(S2.keyToId(key)).toString(16).padStart(16, '0');
  return hex.replace(/0+$/, '') || '0';
}
