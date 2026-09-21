import type { Layer } from '@deck.gl/core';
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { idToPolygonGeo } from '@kepler.gl/common-utils';
import { parseGeoJsonRawFeature } from '@kepler.gl/layers';

import type { HaloRing, HaloShape, HaloTargets } from './selectionHalo';

/** `#FFB300`, the amber that marks this plugin's own layers (`OWN_LAYER_TONES`). */
export const HALO_COLOR: [number, number, number, number] = [255, 179, 0, 255];

export const HALO_LINE_PX = 3;

export const HALO_LAYER_PREFIX = 'panel-selection-halo';

/**
 * A shape as a GeoJSON feature, through the converters kepler's own "Select
 * Geometry" uses (`getSelectedFeature`): `idToPolygonGeo` for an H3 index and
 * `parseGeoJsonRawFeature` for a GeoJSON cell, object or string alike.
 */
export function haloShapeFeature(shape: HaloShape): object | null {
  if (shape.kind === 'hexagon') {
    return typeof shape.value === 'string' ? (idToPolygonGeo({ id: shape.value }, { isClosed: true }) ?? null) : null;
  }
  return parseGeoJsonRawFeature(shape.value) ?? null;
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
 * The halo for one side of the map: rings for points, outlines for shapes.
 *
 * Neither layer is pickable, so a click on a ringed point still reaches the
 * kepler layer under it — which is what kepler's popup and the click mappings
 * need.
 */
export function haloDeckLayers(targets: HaloTargets, side: number, { globe }: { globe: boolean }): Layer[] {
  const layers: Layer[] = [];
  const parameters = depthParameters(globe);

  if (targets.rings.length) {
    layers.push(
      new ScatterplotLayer<HaloRing>({
        id: `${HALO_LAYER_PREFIX}-points-${side}`,
        data: targets.rings,
        getPosition: (ring) => ring.position,
        getRadius: (ring) => ring.radiusPx,
        radiusUnits: 'pixels',
        stroked: true,
        filled: false,
        lineWidthUnits: 'pixels',
        getLineWidth: HALO_LINE_PX,
        getLineColor: HALO_COLOR,
        pickable: false,
        parameters,
      }) as unknown as Layer
    );
  }

  const features = targets.shapes.map(haloShapeFeature).filter((feature): feature is object => feature !== null);
  if (features.length) {
    layers.push(
      new GeoJsonLayer({
        id: `${HALO_LAYER_PREFIX}-outlines-${side}`,
        data: features as never,
        stroked: true,
        filled: false,
        lineWidthUnits: 'pixels',
        getLineWidth: HALO_LINE_PX,
        getLineColor: HALO_COLOR,
        pickable: false,
        parameters,
      }) as unknown as Layer
    );
  }

  return layers;
}
