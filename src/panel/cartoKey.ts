/**
 * CARTO's API key, for the three CARTO base maps.
 *
 * Since 2026-09-23 CARTO asks for a key on every tile, style, glyph and sprite
 * URL under basemaps.cartocdn.com (https://carto.com/basemaps/apikey/); its
 * raster tiles already come back as an "API key required" watermark without
 * one. The key cannot go in the style document alone — the TileJSON it points
 * at lists tile URLs without it — so it goes on the style URL kepler fetches
 * and on every URL MapLibre requests (`transformRequest`). The key is public by
 * design: it travels in every tile URL, so a panel option is the right home.
 *
 * Ported from Plus (src/plus/styles/carto.ts).
 */
const CARTO_URL = /^https:\/\/([a-z0-9-]+\.)*basemaps\.cartocdn\.com\//i;
const HAS_KEY = /[?&]key=/;

export function isCartoUrl(url: string): boolean {
  return CARTO_URL.test(url);
}

/** `url` with `key`, if it is CARTO's and has none yet. URL templates (`{z}`, `{fontstack}`) are kept. */
export function withCartoKey(url: string, key: string): string {
  if (!isCartoUrl(url) || HAS_KEY.test(url)) {
    return url;
  }
  const hash = url.indexOf('#');
  const base = hash < 0 ? url : url.slice(0, hash);
  const fragment = hash < 0 ? '' : url.slice(hash);
  return `${base}${base.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}${fragment}`;
}

/** The option as the map should use it: variables interpolated, blank meaning none. */
export function resolveCartoKey(
  raw: string | undefined,
  replaceVariables: (value: string) => string
): string | undefined {
  const key = raw ? replaceVariables(raw).trim() : '';
  return key || undefined;
}

/** MapLibre's `transformRequest`, reading the key at each call so a new key needs no new map. */
export function cartoTransformRequest(key: () => string | undefined): (url: string) => { url: string } {
  return (url) => {
    const current = key();
    return { url: current ? withCartoKey(url, current) : url };
  };
}
