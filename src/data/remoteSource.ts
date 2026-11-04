/**
 * The address of a dataset kepler fetches by URL (`externally-hosted`), as the
 * dashboard keeps it and as kepler needs it.
 *
 * kepler accepts only an absolute http(s) URL. A dashboard should not hold one
 * for a file Grafana serves itself, such as Geomap's `public/maps/countries.geojson`:
 * written out in full it names the host the map was saved on, and breaks on any
 * other Grafana the dashboard is moved to. So a path under Grafana's root is
 * stored relative to it and resolved on load, the way the custom base map URL is.
 */

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;

/** The URL kepler fetches: a relative source resolved against Grafana's root. */
export function resolveRemoteSource(source: string, base: string | undefined): string {
  if (!base || ABSOLUTE.test(source)) {
    return source;
  }
  try {
    return new URL(source, base).href;
  } catch {
    return source;
  }
}

/** The source as the dashboard stores it: relative when it lies under Grafana's root. */
export function relativeRemoteSource(source: string, base: string | undefined): string {
  if (!base || !source.startsWith(base)) {
    return source;
  }
  return source.slice(base.length);
}

/** Grafana's root as the page knows it (`<base href>`), sub-path included. */
export function documentBase(): string | undefined {
  return typeof document === 'undefined' ? undefined : document.baseURI;
}
