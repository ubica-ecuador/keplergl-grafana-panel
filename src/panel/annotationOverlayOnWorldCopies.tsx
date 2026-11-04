import React, { useMemo } from 'react';
// The unpatched overlay, by its deep path: every request for this module from
// inside @kepler.gl is rewritten to this file by the NormalModuleReplacementPlugin
// in webpack.config.ts, and the issuer check there keeps this import the original.
import KeplerAnnotationOverlay, {
  type AnnotationOverlayProps,
} from '@kepler.gl/components/annotations/annotation-overlay';

import { onNearestWorldCopy } from './worldCopies';

/**
 * kepler's annotation overlay, its callouts placed on the world copy nearest
 * the view's centre (`worldCopies.ts`, `onNearestWorldCopy`).
 *
 * The overlay is not an injectable factory: `MapContainer` imports it straight
 * from its annotations folder and hands it a viewport it builds itself
 * (`_getAnnotationViewport`), so the swap happens at the module, as kepler's
 * Portaled is swapped (`portaledBodyMount.tsx`). Dragging is left as kepler
 * does it: a callout moved over a copy keeps that copy's longitude in kepler,
 * and is written to Grafana within ±180° (`grafanaAnnotations.ts`, `geoTag`).
 * A globe has no copies, and is handed kepler's viewport unchanged.
 */
export default function AnnotationOverlayOnWorldCopies(props: AnnotationOverlayProps) {
  const { viewport, isGlobeEnabled } = props;
  const onCopies = useMemo(
    () => (isGlobeEnabled || !viewport ? viewport : onNearestWorldCopy(viewport)),
    [viewport, isGlobeEnabled]
  );
  return <KeplerAnnotationOverlay {...props} viewport={onCopies} />;
}
