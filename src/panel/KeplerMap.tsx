import React, { useMemo, useState } from 'react';
import { Provider } from 'react-redux';
import { StyleSheetManager } from 'styled-components';
import KeplerGl from '@kepler.gl/components';
import type { Store } from 'redux';

import 'maplibre-gl/dist/maplibre-gl.css';

import { KeplerThemeOverride } from '../data/keplerTheme';
import { KEPLER_INSTANCE_ID } from './keplerStore';

export const CUSTOM_BASEMAP_ID = 'grafana-custom-basemap';

interface Props {
  store: Store;
  width: number;
  height: number;
  theme?: KeplerThemeOverride;
  customBasemapUrl?: string;
  /**
   * Fired once kepler has registered its instance in the store. Dispatching
   * data before this point silently does nothing: the actions are addressed to
   * an instance id that does not exist yet and kepler drops them.
   */
  onReady?: () => void;
}

/**
 * Mounts kepler.gl inside the panel.
 *
 * Two containment decisions worth keeping:
 *
 * 1. `<StyleSheetManager target>` sends every styled-components rule kepler
 *    generates into a <style> tag inside this panel instead of document.head,
 *    so kepler's styling cannot reach the surrounding Grafana UI.
 * 2. `<Provider>` wraps only this subtree. react-redux is Grafana's own module
 *    instance, so this Provider overrides the context here — no `@grafana/ui`
 *    component may be rendered below this point.
 */
export function KeplerMap({ store, width, height, theme, customBasemapUrl, onReady }: Props) {
  const [styleTarget, setStyleTarget] = useState<HTMLElement | null>(null);

  // Registering a self-hosted style.json makes the panel usable in air-gapped
  // installs, where the Carto base maps are unreachable.
  const mapStyles = useMemo(
    () => (customBasemapUrl ? [{ id: CUSTOM_BASEMAP_ID, label: 'Custom', url: customBasemapUrl }] : undefined),
    [customBasemapUrl]
  );

  return (
    <div ref={setStyleTarget} style={{ width, height, position: 'relative', overflow: 'hidden' }}>
      {styleTarget && (
        <StyleSheetManager target={styleTarget}>
          <Provider store={store}>
            <KeplerGl
              id={KEPLER_INSTANCE_ID}
              width={width}
              height={height}
              /* kepler 3.x defaults to MapLibre with Carto basemaps; the prop is
                 required by the type but unused unless a Mapbox style is picked. */
              mapboxApiAccessToken=""
              appName="Grafana"
              theme={theme}
              mapStyles={mapStyles}
              onKeplerGlInitialized={onReady}
            />
          </Provider>
        </StyleSheetManager>
      )}
    </div>
  );
}

export default KeplerMap;
