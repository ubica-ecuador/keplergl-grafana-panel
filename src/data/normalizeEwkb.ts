const SRID_FLAG = 0x20000000;
const Z_FLAG = 0x80000000;
const M_FLAG = 0x40000000;
const BASE_TYPE_MASK = 0x0fffffff;

/**
 * Converts PostGIS EWKB hex into ISO WKB hex.
 *
 * Grafana's Postgres data source returns geometry columns exactly as PostGIS
 * emits them: EWKB hex like `0101000020E6100000...`. loaders.gl (which kepler
 * delegates parsing to) reads the ISO WKB type code before clearing the EWKB
 * flag bits, so the SRID flag is misread as an invalid dimension and parsing
 * fails. A plain `SELECT *` against a PostGIS table renders nothing.
 *
 * The two encodings differ in how they carry the same information:
 *
 * | | EWKB | ISO WKB |
 * |---|---|---|
 * | Z | `0x80000000` flag | type + 1000 |
 * | M | `0x40000000` flag | type + 2000 |
 * | SRID | `0x20000000` flag + 4 bytes | not represented |
 *
 * Anything that is not WKB hex — GeoJSON, WKT, free text — is returned as-is,
 * so this is safe to run over every value of a column of unknown shape.
 */
export function normalizeEwkb(value: string): string {
  if (!looksLikeWkbHex(value)) {
    return value;
  }

  try {
    const bytes = hexToBytes(value);
    const out: number[] = [];
    const consumed = rewriteGeometry(bytes, 0, out);
    // A trailing-byte mismatch means we misread the structure; rather than emit
    // a corrupted geometry, hand back the original untouched.
    return consumed === bytes.length ? bytesToHex(out) : value;
  } catch {
    return value;
  }
}

/**
 * Rewrites one geometry at `offset`, appending ISO WKB bytes to `out`, and
 * returns the offset just past it.
 *
 * Multi-geometries and geometry collections nest full geometries, each with its
 * own byte-order marker and type code carrying its own Z/M flags, so this has to
 * recurse rather than only fix the outermost header.
 */
function rewriteGeometry(bytes: Uint8Array, offset: number, out: number[]): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = bytes[offset] === 1;

  const rawType = view.getUint32(offset + 1, littleEndian);
  const hasSrid = (rawType & SRID_FLAG) !== 0;
  const hasZ = (rawType & Z_FLAG) !== 0;
  const hasM = (rawType & M_FLAG) !== 0;
  const baseType = rawType & BASE_TYPE_MASK;
  const isoType = baseType + (hasZ ? 1000 : 0) + (hasM ? 2000 : 0);

  out.push(bytes[offset]);
  pushUint32(out, isoType, littleEndian);

  // Skip past the byte-order marker, the type, and the SRID if one is present.
  let cursor = offset + 5 + (hasSrid ? 4 : 0);

  const coordSize = 8 * (2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0));

  switch (baseType) {
    case 1: // Point
      cursor = copyBytes(bytes, cursor, coordSize, out);
      break;

    case 2: // LineString
    case 15: // Triangle-ish rings are handled by the ring reader below
      cursor = copyRing(bytes, cursor, view, littleEndian, coordSize, out);
      break;

    case 3: { // Polygon
      const numRings = readUint32(bytes, cursor, view, littleEndian, out);
      cursor += 4;
      for (let i = 0; i < numRings; i++) {
        cursor = copyRing(bytes, cursor, view, littleEndian, coordSize, out);
      }
      break;
    }

    case 4: // MultiPoint
    case 5: // MultiLineString
    case 6: // MultiPolygon
    case 7: { // GeometryCollection
      const numGeoms = readUint32(bytes, cursor, view, littleEndian, out);
      cursor += 4;
      for (let i = 0; i < numGeoms; i++) {
        cursor = rewriteGeometry(bytes, cursor, out);
      }
      break;
    }

    default:
      throw new Error(`unsupported WKB type ${baseType}`);
  }

  return cursor;
}

/** Reads a point count then copies that many coordinates verbatim. */
function copyRing(
  bytes: Uint8Array,
  offset: number,
  view: DataView,
  littleEndian: boolean,
  coordSize: number,
  out: number[]
): number {
  const numPoints = readUint32(bytes, offset, view, littleEndian, out);
  return copyBytes(bytes, offset + 4, numPoints * coordSize, out);
}

/** Reads a uint32 at `offset` and copies its 4 bytes to the output unchanged. */
function readUint32(
  bytes: Uint8Array,
  offset: number,
  view: DataView,
  littleEndian: boolean,
  out: number[]
): number {
  const n = view.getUint32(offset, littleEndian);
  copyBytes(bytes, offset, 4, out);
  return n;
}

function copyBytes(bytes: Uint8Array, offset: number, length: number, out: number[]): number {
  const end = offset + length;
  if (end > bytes.length) {
    throw new Error('truncated WKB');
  }
  for (let i = offset; i < end; i++) {
    out.push(bytes[i]);
  }
  return end;
}

function pushUint32(out: number[], value: number, littleEndian: boolean): void {
  const buf = new DataView(new ArrayBuffer(4));
  buf.setUint32(0, value, littleEndian);
  for (let i = 0; i < 4; i++) {
    out.push(buf.getUint8(i));
  }
}

/**
 * A WKB hex string is an even number of hex digits opening with a byte-order
 * marker of `00` (big-endian) or `01` (little-endian), long enough to hold at
 * least a byte-order byte and a 4-byte type code. Everything else — GeoJSON,
 * WKT, plain text — is left alone.
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
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}
