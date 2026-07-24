import React, { lazy, Suspense } from 'react';
import { LoadingPlaceholder } from '@grafana/ui';

import type { KeplerMapProps } from './KeplerMap';

/**
 * Defers the heavy half of the plugin.
 *
 * kepler.gl, deck.gl, MapLibre and loaders.gl together dwarf everything else in
 * this plugin. Loading them eagerly would block every dashboard that merely has
 * the plugin installed, even ones with no map on them, because Grafana
 * evaluates a panel plugin's entry module when the panel type is first needed.
 *
 * The scaffold's webpack config already resolves chunk URLs at runtime from the
 * AMD module URI, so the split chunk loads correctly under a sub-path or from a
 * plugin CDN.
 */
const KeplerMap = lazy(() => import('./KeplerMap').then((m) => ({ default: m.KeplerMap })));

export function LazyKeplerMap(props: KeplerMapProps) {
  return (
    <Suspense
      fallback={
        <div style={{ width: props.width, height: props.height, display: 'grid', placeItems: 'center' }}>
          <LoadingPlaceholder text="Loading map…" />
        </div>
      }
    >
      <KeplerMap {...props} />
    </Suspense>
  );
}
