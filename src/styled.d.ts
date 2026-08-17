/**
 * kepler.gl components read their theme tokens (rightPanelMarginTop,
 * bottomWidgetPaddingBottom, …) off styled-components' ThemeProvider context,
 * and so do the panel's own styled components that extend kepler's chrome.
 * styled-components v6 types that context as the empty `DefaultTheme`
 * interface unless the app augments it, and kepler's published packages ship
 * no augmentation (only its untranspiled source does) — without this file
 * every `props.theme.<token>` access fails to typecheck. Mirrors kepler.gl's
 * own `src/styles/src/styled.d.ts`.
 */
import 'styled-components';

declare module 'styled-components' {
  export interface DefaultTheme {
    [key: string]: any;
  }
}
