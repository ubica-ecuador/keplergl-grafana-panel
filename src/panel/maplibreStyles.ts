import { css } from '@emotion/css';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css?raw';

/**
 * MapLibre's own stylesheet, confined to the element this class is put on.
 *
 * The map needs it — it positions the canvas and sets the pan and zoom
 * cursors and touch actions — but importing the file for its side effect
 * injects all of it into Grafana's page, where it applies to anything else
 * there that uses MapLibre's class names. The plugin catalog rejects exactly
 * that (`no-direct-css-imports`), so the file comes in as text (`?raw`, see
 * the root webpack config) and emotion nests every rule under this class.
 *
 * `*:where(&)` rather than plain nesting: `:where()` weighs nothing, so each
 * rule keeps the specificity it had as a global, and every override that beat
 * it before — kepler hiding MapLibre's logo and attribution among them — still
 * beats it for the same reason.
 */
export const maplibreStyles = css`
  *:where(&) {
    ${maplibreCss}
  }
`;
