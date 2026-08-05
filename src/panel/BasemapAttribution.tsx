import React from 'react';

/**
 * The Esri credit kepler does not render.
 *
 * kepler's own `Attribution` component (`@kepler.gl/components/map-container.js`)
 * replaces MapLibre's attribution control with a hardcoded bar of its own —
 * "© kepler.gl", an optional OpenStreetMap credit, and the base map library
 * name — and never reads a raster source's `attribution` field, so nothing
 * about Esri ever reaches the screen on its own. Esri's terms for the free
 * tile service require the credit, so the panel renders it itself.
 *
 * Positioned to sit just above kepler's own bar (which occupies the bottom
 * ~18px of the map, right-aligned with a 10px margin — see `StyledAttribution`
 * in `@kepler.gl/components`) rather than on top of it, and `pointerEvents:
 * 'none'` so it never steals a click or drag meant for the map underneath.
 */
export function BasemapAttribution() {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 22,
        right: 10,
        zIndex: 1,
        fontSize: 10,
        lineHeight: '14px',
        color: 'rgba(255, 255, 255, 0.75)',
        textShadow: '0 0 2px rgba(0, 0, 0, 0.85)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community
    </div>
  );
}

export default BasemapAttribution;
