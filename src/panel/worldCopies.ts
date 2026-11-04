import { MapView } from '@deck.gl/core';

import { nearestCopy } from '../data/longitude';

/**
 * The map's world copies: what the base map repeats past ±180°, the deck
 * layers and kepler's callouts drawn there too.
 *
 * MapLibre repeats the world (`renderWorldCopies`, on by default) and deck's
 * map controller keeps the centre's longitude within ±180° as the view crosses
 * the antimeridian (`MapState.applyConstraints`, `normalize`). But kepler hands
 * deck a flat `MapView` without `repeat` (map-container.js, `_renderDeckOverlay`),
 * so deck draws every layer on one world only, the one from -180° to 180°:
 * zoomed out, the copies either side show the base map and nothing on it, and
 * zoomed in over the antimeridian, half the screen loses its points, the half
 * on the far side of ±180° from the centre. kepler's layers already wrap their
 * data into ±180° (`wrapLongitude: true`); that is the world deck draws, and a
 * view showing more than it, or a part of the next one, finds it empty.
 *
 * Free of React and of kepler, so the rules can be tested with literal values.
 */

type DeckProps = Record<string, unknown>;

/**
 * kepler's deck props, its flat map view drawing the layers on every world
 * copy in view (deck's `MapView({repeat: true})`), as MapLibre draws the base
 * map and as deck's own `MapboxOverlay` does on a map that repeats.
 *
 * Only a `MapView`: kepler's globe view is not one, and a globe has no copies.
 * deck draws each layer once per copy in view, from the same buffers: one
 * copy, the usual case, costs what it did; a view across the antimeridian
 * draws twice, a world zoomed out to fit a wide panel three or four times.
 */
export function repeatWorldCopies(deckProps: DeckProps | null): DeckProps | null {
  const views = deckProps?.views;
  if (!deckProps || !(views instanceof MapView) || views.props.repeat) {
    return deckProps;
  }
  return { ...deckProps, views: views.clone({ repeat: true }) };
}

/** What kepler's annotation overlay projects its callouts with (`MapViewport`). */
export interface ProjectingViewport {
  project(lngLat: readonly number[]): number[];
  unproject(xy: readonly number[]): number[];
  longitude: number;
}

/**
 * kepler's callout viewport, projecting each place on the world copy nearest
 * the view's centre.
 *
 * kepler draws one callout per annotation in an overlay of its own, placed by
 * `viewport.project(anchorPoint)` and nothing else (annotations/annotation-utils.js,
 * `makeMarker`): a callout at 178° E, seen from a centre deck has wrapped to
 * -176°, is projected 354° away and leaves the screen. Projected from the copy
 * nearest the centre it stays on the island it marks. One callout still: on a
 * world zoomed out far enough to show two copies of its place, it is drawn on
 * the one nearer the centre.
 */
export function onNearestWorldCopy<V extends ProjectingViewport>(viewport: V): V {
  return {
    ...viewport,
    project: (lngLat: readonly number[]) => {
      const [lng, ...rest] = lngLat;
      return viewport.project([nearestCopy(lng, viewport.longitude), ...rest]);
    },
  };
}
