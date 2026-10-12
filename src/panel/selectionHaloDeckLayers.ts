import type { Layer } from '@deck.gl/core';
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { h3IsValid, idToPolygonGeo } from '@kepler.gl/common-utils';
import { parseGeoJsonRawFeature } from '@kepler.gl/layers';

import { RING_MIN_PX, type HaloRing, type HaloShape } from './selectionHalo';

/** `#FFB300`, the amber that marks this plugin's own layers (`OWN_LAYER_TONES`). */
export const HALO_COLOR: [number, number, number, number] = [255, 179, 0, 255];

export const HALO_LINE_PX = 3;

/**
 * A dark band under the amber, wider by this much, so the ring reads on an
 * amber or orange layer and on a light base map as well as on a dark one.
 */
export const HALO_CASING_COLOR: [number, number, number, number] = [17, 17, 17, 200];

export const HALO_CASING_PX = HALO_LINE_PX + 4;

export const HALO_LAYER_PREFIX = 'panel-selection-halo';

/**
 * A shape as a GeoJSON feature, through the converters kepler's own "Select
 * Geometry" uses (`getSelectedFeature`): `idToPolygonGeo` for an H3 index and
 * `parseGeoJsonRawFeature` for a GeoJSON cell, object or string alike. An
 * index that is not a valid H3 cell gets nothing, as kepler draws nothing for
 * it: h3-js does not throw on one but returns a polygon near the pole.
 */
export function haloShapeFeature(shape: HaloShape): object | null {
  if (shape.kind === 'hexagon') {
    return typeof shape.value === 'string' && h3IsValid(shape.value)
      ? (idToPolygonGeo({ id: shape.value }, { isClosed: true }) ?? null)
      : null;
  }
  return parseGeoJsonRawFeature(shape.value) ?? null;
}

interface Feature {
  geometry?: { type: string; coordinates?: unknown } | null;
}

/**
 * A polygon as the lines of its rings, everything else as it is.
 *
 * The outline layer is stroked and never filled, yet deck tessellates a polygon
 * with earcut all the same. kepler converts its own hover highlight the same way
 * (`featureToHoverOutline`, which `@kepler.gl/layers` does not export).
 */
function toOutline(feature: Feature): Feature {
  const geometry = feature.geometry;
  if (geometry?.type === 'Polygon') {
    return { ...feature, geometry: { type: 'MultiLineString', coordinates: geometry.coordinates } };
  }
  if (geometry?.type === 'MultiPolygon') {
    return {
      ...feature,
      geometry: { type: 'MultiLineString', coordinates: (geometry.coordinates as unknown[][]).flat() },
    };
  }
  return feature;
}

/** The shapes as the features deck outlines; a shape that is not geometry is left out. */
export function haloOutlines(shapes: readonly HaloShape[]): object[] {
  return shapes.flatMap((shape) => {
    const feature = haloShapeFeature(shape);
    return feature ? [toOutline(feature)] : [];
  });
}

/**
 * What deck draws for one side of the map. Built only when the selection, the
 * layers, the data, the filters or the split change — the rings also when the
 * zoom does — so the arrays keep their identity across kepler's repaints and
 * deck does not read them again.
 */
export interface HaloDeckData {
  rings: readonly HaloRing[];
  outlines: readonly object[];
}

/**
 * Off, so the halo always shows above extruded layers — but not on the globe.
 * There, kepler found its always-on-top labels showing through the planet when
 * their object was on the far side, and settled on testing against the depth
 * disk without writing to it (`base-layer.js`). The halo does the same.
 */
function depthParameters(globe: boolean): Record<string, boolean> {
  return globe ? { depthTest: true, depthMask: false, cull: false } : { depthTest: false };
}

/**
 * The halo for one side of the map: rings for points, outlines for shapes,
 * each amber over a dark casing.
 *
 * None of the layers is pickable, so a click on a ringed point still reaches the
 * kepler layer under it — which is what kepler's popup and the click mappings
 * need. The layers are new on every call, which deck diffs prop by prop; the
 * data is handed through as it came, so it stays the same data.
 */
export function haloDeckLayers(data: HaloDeckData, side: number, { globe }: { globe: boolean }): Layer[] {
  const layers: Layer[] = [];
  const parameters = depthParameters(globe);

  // The casing first, then the amber over it, each pass drawing every mark.
  const strokes = [
    { suffix: '-casing', color: HALO_CASING_COLOR, widthPx: HALO_CASING_PX },
    { suffix: '', color: HALO_COLOR, widthPx: HALO_LINE_PX },
  ];
  for (const { suffix, color, widthPx } of strokes) {
    if (data.rings.length) {
      layers.push(
        new ScatterplotLayer<HaloRing>({
          id: `${HALO_LAYER_PREFIX}-points${suffix}-${side}`,
          data: data.rings,
          getPosition: (ring) => ring.position,
          getRadius: (ring) => ring.radiusPx,
          radiusUnits: 'pixels',
          stroked: true,
          filled: false,
          lineWidthUnits: 'pixels',
          getLineWidth: widthPx,
          getLineColor: color,
          pickable: false,
          parameters,
        }) as unknown as Layer
      );
    }

    if (data.outlines.length) {
      layers.push(
        new GeoJsonLayer({
          id: `${HALO_LAYER_PREFIX}-outlines${suffix}-${side}`,
          data: data.outlines as never,
          stroked: true,
          filled: false,
          lineWidthUnits: 'pixels',
          getLineWidth: widthPx,
          getLineColor: color,
          // A GeoJSON point gets a ring like a kepler point's, not deck's
          // default one-metre dot.
          pointType: 'circle',
          pointRadiusUnits: 'pixels',
          getPointRadius: RING_MIN_PX,
          pickable: false,
          parameters,
        }) as unknown as Layer
      );
    }
  }

  return layers;
}
