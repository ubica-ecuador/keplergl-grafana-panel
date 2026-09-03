/**
 * Resolving the self-hosted `style.json` a dashboard points the map at.
 *
 * Two things the raw option value cannot do on its own, both learned the hard
 * way against a real deployment:
 *
 * - **It cannot follow a dashboard variable.** Nothing in Grafana interpolates
 *   panel options; a plugin has to ask. Without this, a style URL is frozen at
 *   whatever was typed, so a dashboard cannot let a variable choose between
 *   `style-2017.json` and `style-2025.json`, nor keep one dashboard portable
 *   between a bench on `localhost` and a published instance.
 * - **It cannot be relative.** kepler fetches the style itself, and a path like
 *   `/public/plugins/…/style.json` came back as Grafana's SPA shell — the only
 *   symptom being `Error: Map style response is empty` in the console and a
 *   silent fall back to the default base map. Resolving against the page turns
 *   that into the file the author meant.
 *
 * Free of React and @grafana/runtime so both rules can be tested with literals.
 */

/** What Grafana's `replaceVariables` does, narrowed to what is needed here. */
export type Interpolate = (value: string) => string;

/**
 * The style URL to hand kepler, or `''` when there is nothing usable.
 *
 * @param raw   the `customBasemapUrl` option, as authored
 * @param interpolate  Grafana's `replaceVariables`, or undefined to skip it
 * @param base  the page URL a relative value is resolved against; pass
 *              undefined (or run without a DOM) to leave relative values alone
 */
export function resolveCustomBasemapUrl(raw: string | undefined, interpolate?: Interpolate, base?: string): string {
  const authored = (raw ?? '').trim();
  if (!authored) {
    return '';
  }

  // Interpolating is only worth a call when there is something to interpolate,
  // and a value with no `$` is by far the common case.
  const resolved = interpolate && authored.includes('$') ? interpolate(authored).trim() : authored;
  if (!resolved) {
    return '';
  }

  // `data:` styles never load — kepler issues no request at all for them — so
  // there is nothing to resolve, and nothing to gain by pretending otherwise.
  if (!base || /^[a-z][a-z0-9+.-]*:/i.test(resolved)) {
    return resolved;
  }

  try {
    return new URL(resolved, base).toString();
  } catch {
    // A value that is neither absolute nor resolvable is handed through
    // unchanged: the map falls back to its default rather than throwing.
    return resolved;
  }
}
