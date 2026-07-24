const SRID_FLAG = 0x20000000;
const Z_FLAG = 0x80000000;
const M_FLAG = 0x40000000;
const BASE_TYPE_MASK = 0x0fffffff;

type Position = number[];

interface GeoJsonGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: GeoJsonGeometry[];
}

/**
 * Decodes WKB/EWKB hex into a GeoJSON geometry string.
 *
 * kepler.gl's geojson layer renders GeoJSON and WKT strings, but **not** WKB —
 * verified end-to-end: a hex WKB column produces a blank map. Yet raw geometry
 * arrives as WKB hex from the two sources that matter here: the Grafana Postgres
 * data source returns PostGIS geometry as EWKB hex, and DuckDB's `ST_AsHEXWKB`
 * over GeoParquet returns ISO WKB hex. Decoding it here lets `SELECT geom` work
 * without the user wrapping every query in `ST_AsGeoJSON`.
 *
 * Returns null for anything that is not WKB hex — GeoJSON, WKT, free text — so
 * the caller keeps those values untouched for kepler to parse directly.
 *
 * Reads a cursor through the byte array; the structure walk (byte order, type,
 * SRID/Z/M flags, nested multi-geometries) mirrors the WKB spec.
 */
export function wkbToGeoJson(value: string): string | null {
  if (!looksLikeWkbHex(value)) {
    return null;
  }
  try {
    const bytes = hexToBytes(value);
    const reader = new WkbReader(bytes);
    const geometry = reader.readGeometry();
    // A trailing-byte mismatch means we misread the structure; treat it as
    // "not WKB" rather than emit a half-parsed geometry.
    return reader.done() ? JSON.stringify(geometry) : null;
  } catch {
    return null;
  }
}

class WkbReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  done(): boolean {
    return this.offset === this.bytes.length;
  }

  readGeometry(): GeoJsonGeometry {
    const littleEndian = this.bytes[this.offset] === 1;
    this.offset += 1;

    const rawType = this.view.getUint32(this.offset, littleEndian);
    this.offset += 4;

    const hasZ = (rawType & Z_FLAG) !== 0;
    const hasM = (rawType & M_FLAG) !== 0;
    if ((rawType & SRID_FLAG) !== 0) {
      // SRID is carried in the EWKB header but has no place in GeoJSON.
      this.offset += 4;
    }
    const dims = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);
    const baseType = rawType & BASE_TYPE_MASK;

    switch (baseType) {
      case 1:
        return { type: 'Point', coordinates: this.readPosition(dims, littleEndian) };
      case 2:
        return { type: 'LineString', coordinates: this.readPositions(dims, littleEndian) };
      case 3:
        return { type: 'Polygon', coordinates: this.readRings(dims, littleEndian) };
      case 4:
        return { type: 'MultiPoint', coordinates: this.readGeometryArray(littleEndian).map(pointCoords) };
      case 5:
        return { type: 'MultiLineString', coordinates: this.readGeometryArray(littleEndian).map(lineCoords) };
      case 6:
        return { type: 'MultiPolygon', coordinates: this.readGeometryArray(littleEndian).map(polygonCoords) };
      case 7:
        return { type: 'GeometryCollection', geometries: this.readGeometryArray(littleEndian) };
      default:
        throw new Error(`unsupported WKB type ${baseType}`);
    }
  }

  /** A run of geometries, each with its own header (multi-geometries, collections). */
  private readGeometryArray(littleEndian: boolean): GeoJsonGeometry[] {
    const count = this.view.getUint32(this.offset, littleEndian);
    this.offset += 4;
    const out: GeoJsonGeometry[] = [];
    for (let i = 0; i < count; i++) {
      out.push(this.readGeometry());
    }
    return out;
  }

  private readRings(dims: number, littleEndian: boolean): Position[][] {
    const count = this.view.getUint32(this.offset, littleEndian);
    this.offset += 4;
    const rings: Position[][] = [];
    for (let i = 0; i < count; i++) {
      rings.push(this.readPositions(dims, littleEndian));
    }
    return rings;
  }

  private readPositions(dims: number, littleEndian: boolean): Position[] {
    const count = this.view.getUint32(this.offset, littleEndian);
    this.offset += 4;
    const positions: Position[] = [];
    for (let i = 0; i < count; i++) {
      positions.push(this.readPosition(dims, littleEndian));
    }
    return positions;
  }

  private readPosition(dims: number, littleEndian: boolean): Position {
    const pos: Position = [];
    for (let d = 0; d < dims; d++) {
      pos.push(this.view.getFloat64(this.offset, littleEndian));
      this.offset += 8;
    }
    return pos;
  }
}

function pointCoords(g: GeoJsonGeometry): unknown {
  return g.coordinates;
}
function lineCoords(g: GeoJsonGeometry): unknown {
  return g.coordinates;
}
function polygonCoords(g: GeoJsonGeometry): unknown {
  return g.coordinates;
}

/**
 * A WKB hex string is an even number of hex digits opening with a byte-order
 * marker of `00` (big-endian) or `01` (little-endian), long enough to hold at
 * least a byte-order byte and a 4-byte type code.
 */
function looksLikeWkbHex(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length >= 10 &&
    value.length % 2 === 0 &&
    (value.startsWith('00') || value.startsWith('01')) &&
    /^[0-9a-fA-F]+$/.test(value)
  );
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
