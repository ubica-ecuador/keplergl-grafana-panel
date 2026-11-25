import { createTheme, type GrafanaTheme2 } from '@grafana/data';
import { config } from '@grafana/runtime';

/**
 * Grafana's spacing and type for the parts of the map styled inside kepler's own theme (its side panel, popups
 * and map controls), whose styled components see kepler's theme, not Grafana's. Spacing and type are the same
 * in Grafana's light and dark themes, so they are read from the running Grafana's theme as they are drawn;
 * colours stay kepler's, which the panel maps from Grafana's.
 */
let fallback: GrafanaTheme2 | undefined;

export function grafanaTheme(): GrafanaTheme2 {
  const running = config?.theme2;
  // A theme without its helpers (a partial one, in tests) is no theme to measure with.
  if (typeof running?.spacing === 'function' && typeof running.typography?.pxToRem === 'function') {
    return running;
  }
  return (fallback ??= createTheme());
}

/** `theme.spacing(...)` as a styled-components interpolation: one to four multiples of Grafana's grid unit. */
export const space =
  (...units: [number] | [number, number] | [number, number, number] | [number, number, number, number]) =>
  () =>
    grafanaTheme().spacing(...(units as [number, number, number, number]));

/** A font size or line height on Grafana's type scale: `theme.typography.pxToRem`. */
export const typeSize = (px: number) => () => grafanaTheme().typography.pxToRem(px);
