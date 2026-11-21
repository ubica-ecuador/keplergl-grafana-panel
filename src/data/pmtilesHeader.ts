import type { WmsBox } from './wmsDataset';

/**
 * What a PMTiles archive says about itself in its first 127 bytes: whether
 * its tiles are vector tiles or pictures, its zoom levels and its box.
 *
 * kepler draws the two with two layers, and decides between them the same way
 * (`parseMetadataTileJSON` reads the archive's tile type, through loaders.gl's
 * `PMTilesSource`); its own Add Data form asks the user first, and refuses a
 * picture archive in the vector form. A query's `tiles_url` names the archive
 * and nothing more, so the panel reads the header before it builds the layer.
 *
 * The header of version 3 (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md):
 * the magic `PMTiles` and the version, offsets, then at byte 99 the tile type,
 * 100–101 the zoom levels, 102–117 the box as four little-endian int32 of
 * degrees × 10⁷. An archive of version 2 is read by kepler too, but says what
 * it holds in its JSON metadata; it is taken for vector tiles, kepler's
 * default.
 */
export interface PmtilesHeader {
  kind: 'vector' | 'raster';
  minZoom?: number;
  maxZoom?: number;
  /** `[west, south, east, north]`, when the archive states one. */
  bbox: WmsBox | null;
}

/** The bytes of a version 3 header. */
export const PMTILES_HEADER_LENGTH = 127;

/** Tile types 2 to 5: png, jpeg, webp, avif. 1 is mvt, 0 unknown. */
const PICTURE_TYPES = new Set([2, 3, 4, 5]);

/** The header, or null when the bytes are no PMTiles archive. */
export function parsePmtilesHeader(bytes: ArrayBuffer | Uint8Array): PmtilesHeader | null {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length < 3 || view[0] !== 0x50 || view[1] !== 0x4d) {
    return null;
  }
  // Version 2 begins "PM" and a version number of 2.
  if (view[2] === 2) {
    return { kind: 'vector', bbox: null };
  }
  if (
    view.length < PMTILES_HEADER_LENGTH ||
    String.fromCharCode(...view.subarray(0, 7)) !== 'PMTiles' ||
    view[7] !== 3
  ) {
    return null;
  }
  const data = new DataView(view.buffer, view.byteOffset, view.byteLength);
  const tileType = view[99];
  const minZoom = view[100];
  const maxZoom = view[101];
  const degrees = (offset: number) => data.getInt32(offset, true) / 1e7;
  const box: WmsBox = [degrees(102), degrees(106), degrees(110), degrees(114)];
  const sane =
    box.every(Number.isFinite) &&
    box[1] < box[3] &&
    Math.abs(box[0]) <= 180 &&
    Math.abs(box[2]) <= 180 &&
    Math.abs(box[1]) <= 90 &&
    Math.abs(box[3]) <= 90 &&
    !(box[0] === 0 && box[1] === 0 && box[2] === 0 && box[3] === 0);
  return {
    kind: PICTURE_TYPES.has(tileType) ? 'raster' : 'vector',
    ...(minZoom <= maxZoom ? { minZoom, maxZoom } : {}),
    bbox: sane ? box : null,
  };
}

/**
 * Reads an archive's header: one range request for its first bytes.
 *
 * A server that ignores the range answers the whole archive, which can be a
 * gigabyte: the body is read only as far as the header and the rest is
 * cancelled. Rejects with what went wrong, for the notice over the map.
 */
export async function fetchPmtilesHeader(url: string, init: { signal?: AbortSignal } = {}): Promise<PmtilesHeader> {
  const response = await fetch(url, {
    headers: { Range: `bytes=0-${PMTILES_HEADER_LENGTH - 1}` },
    signal: init.signal,
  });
  if (!response.ok) {
    throw new Error(`the archive answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
  }
  const bytes = await firstBytes(response, PMTILES_HEADER_LENGTH);
  const header = parsePmtilesHeader(bytes);
  if (!header) {
    throw new Error('it is no PMTiles archive');
  }
  return header;
}

async function firstBytes(response: Response, length: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    return new Uint8Array(await response.arrayBuffer()).subarray(0, length);
  }
  const out = new Uint8Array(length);
  let filled = 0;
  while (filled < length) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }
    const take = Math.min(value.length, length - filled);
    out.set(value.subarray(0, take), filled);
    filled += take;
  }
  void reader.cancel().catch(() => undefined);
  return out.subarray(0, filled);
}
