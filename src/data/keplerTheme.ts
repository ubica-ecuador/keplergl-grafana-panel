import { GrafanaTheme2 } from '@grafana/data';

/**
 * The subset of kepler's theme this plugin overrides.
 *
 * kepler's theme object is large; only the surfaces that would visibly clash
 * with the dashboard around the panel are touched, so kepler keeps its own
 * spacing, typography scale and component internals.
 */
export interface KeplerThemeOverride {
  name: 'dark' | 'light';
  sidePanelBg: string;
  sidePanelHeaderBg: string;
  sidePanelHeaderBorder: string;
  panelBackground: string;
  panelBackgroundHover: string;
  inputBgd: string;
  inputBgdHover: string;
  inputBgdActive: string;
  secondaryBtnBgd: string;
  secondaryBtnBgdHover: string;
  primaryBtnBgd: string;
  primaryBtnBgdHover: string;
  textColor: string;
  textColorHl: string;
  titleTextColor: string;
  subtextColor: string;
  panelHeaderIcon: string;
  panelHeaderIconActive: string;
  activeColor: string;
  borderColor: string;
  /** Not part of kepler's theme — the base map style id that suits this mode. */
  mapStyle: 'dark-matter' | 'positron';
}

/**
 * Maps a Grafana theme onto kepler's.
 *
 * Without this the panel is a slab of kepler's own grey sitting inside a
 * Grafana dashboard, and switching Grafana to light mode leaves a dark map
 * panel behind.
 */
export function toKeplerTheme(theme: GrafanaTheme2): KeplerThemeOverride {
  const isDark = theme.colors.mode === 'dark';

  return {
    name: isDark ? 'dark' : 'light',
    sidePanelBg: theme.colors.background.primary,
    // The header is a separate surface in kepler's theme. Leaving it out is
    // what made the logo strip stay dark while the panel body went light.
    sidePanelHeaderBg: theme.colors.background.canvas,
    sidePanelHeaderBorder: theme.colors.border.weak,
    panelBackground: theme.colors.background.secondary,
    panelBackgroundHover: theme.colors.action.hover,
    inputBgd: theme.components.input.background,
    inputBgdHover: theme.colors.action.hover,
    inputBgdActive: theme.colors.action.selected,
    secondaryBtnBgd: theme.colors.secondary.main,
    secondaryBtnBgdHover: theme.colors.secondary.shade,
    primaryBtnBgd: theme.colors.primary.main,
    primaryBtnBgdHover: theme.colors.primary.shade,
    textColor: theme.colors.text.primary,
    textColorHl: theme.colors.text.maxContrast,
    titleTextColor: theme.colors.text.maxContrast,
    subtextColor: theme.colors.text.secondary,
    panelHeaderIcon: theme.colors.text.secondary,
    panelHeaderIconActive: theme.colors.text.maxContrast,
    activeColor: theme.colors.primary.main,
    borderColor: theme.colors.border.weak,
    mapStyle: isDark ? 'dark-matter' : 'positron',
  };
}
