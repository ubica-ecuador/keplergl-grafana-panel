import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Provider } from 'react-redux';
import { StyleSheetManager } from 'styled-components';
import KeplerGl from '@kepler.gl/components';

import 'maplibre-gl/dist/maplibre-gl.css';

import type { PanelDataset } from '../data/framesToDatasets';
import type { SavedMapConfig } from '../data/mapConfig';
import type { KeplerThemeOverride } from '../data/keplerTheme';
import { CUSTOM_BASEMAP_ID, KEPLER_INSTANCE_ID } from './constants';
import { configureKepler } from './keplerConfig';
import { createKeplerStore } from './keplerStore';
import { captureMapConfig, loadDatasets, refreshDatasets, setBasemap, setSidePanel } from './keplerAdapter';
import { decideLoadAction } from './loadDecision';
import { useTimeRangeSync } from './useTimeRangeSync';
import { useAutoLayers } from './useAutoLayers';
import { usePeerTimeSync } from './usePeerTimeSync';
import { useVariableSync } from './useVariableSync';
import type { TimeRangeMs, TimeSyncMode } from './timeSync';
import type { VariableMapping } from './variableSync';

// Must run before any kepler component mounts. Lives here rather than in
// module.ts so it is part of the deferred chunk.
configureKepler();

export interface KeplerMapProps {
  width: number;
  height: number;
  datasets: PanelDataset[];
  mapConfig?: SavedMapConfig | null;
  theme?: KeplerThemeOverride;
  /** Resolved base map style id, or null to leave kepler's default alone. */
  basemapId?: string | null;
  customBasemapUrl?: string;
  showSidePanel: boolean;
  /** Bumped by the options editor to request a configuration snapshot. */
  saveRequest: number;
  onMapConfigCaptured: (config: SavedMapConfig) => void;
  /** How the dashboard time range couples to the map's time filter. */
  timeSync: TimeSyncMode;
  /** The dashboard time range, in epoch ms. */
  grafanaRange: TimeRangeMs;
  /** Moves the dashboard time range; used only in bidirectional sync. */
  onChangeGrafanaRange?: (range: TimeRangeMs) => void;
  /** kepler filter -> dashboard variable bindings. */
  variableMappings: VariableMapping[];
  /** Whether this map shares its clock with the other maps on the dashboard. */
  peerTimeSync: boolean;
}

/**
 * Owns everything kepler.
 *
 * All kepler, deck.gl and MapLibre imports are confined to this module so the
 * dynamic import that loads it actually defers them. The panel above stays a
 * plain Grafana component that knows nothing about kepler's API.
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
export function KeplerMap({
  width,
  height,
  datasets,
  mapConfig,
  theme,
  basemapId,
  customBasemapUrl,
  showSidePanel,
  saveRequest,
  onMapConfigCaptured,
  timeSync,
  grafanaRange,
  onChangeGrafanaRange,
  variableMappings,
  peerTimeSync,
}: KeplerMapProps) {
  const store = useMemo(() => createKeplerStore(), []);
  const [styleTarget, setStyleTarget] = useState<HTMLElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  const hasLoaded = useRef(false);
  const appliedConfig = useRef<SavedMapConfig | null | undefined>(undefined);
  const handledSaveRequest = useRef(saveRequest);

  // Registering a self-hosted style.json makes the panel usable in air-gapped
  // installs, where the Carto base maps are unreachable.
  const mapStyles = useMemo(
    () => (customBasemapUrl ? [{ id: CUSTOM_BASEMAP_ID, label: 'Custom', url: customBasemapUrl }] : undefined),
    [customBasemapUrl]
  );

  useEffect(() => {
    if (!isReady || datasets.length === 0) {
      return;
    }

    const action = decideLoadAction({
      hasLoaded: hasLoaded.current,
      appliedConfig: appliedConfig.current,
      currentConfig: mapConfig,
    });

    if (action === 'rebuild') {
      hasLoaded.current = true;
      appliedConfig.current = mapConfig;
      loadDatasets(store.dispatch, datasets, {}, mapConfig);
    } else {
      refreshDatasets(store.dispatch, datasets);
    }
  }, [isReady, datasets, mapConfig, store]);

  // A saved config already names a base map, so it wins over the panel option.
  useEffect(() => {
    if (!isReady || mapConfig || !basemapId) {
      return;
    }
    setBasemap(store.dispatch, basemapId);
  }, [isReady, basemapId, mapConfig, store]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    setSidePanel(store.dispatch, showSidePanel);
  }, [isReady, showSidePanel, store]);

  useEffect(() => {
    if (saveRequest === handledSaveRequest.current) {
      return;
    }
    handledSaveRequest.current = saveRequest;

    const captured = captureMapConfig(store);
    if (captured) {
      // Record it as applied so saving does not rebuild the map the user is
      // currently looking at.
      appliedConfig.current = captured;
      onMapConfigCaptured(captured);
    }
  }, [saveRequest, store, onMapConfigCaptured]);

  // Declared after the load effect so its own effects register later and run
  // once the datasets are already in the store.
  useTimeRangeSync({
    store,
    isReady,
    mode: timeSync,
    grafanaRange,
    datasets,
    onChangeGrafanaRange,
  });

  // Auto-add trip and flow layers only on a fresh map; a saved config owns its
  // layers.
  useAutoLayers({ store, isReady, datasets, enabled: !mapConfig });

  // Declared after the dashboard sync so the dashboard range wins on load and
  // the maps only trade the clock between themselves afterwards.
  usePeerTimeSync({ store, isReady, enabled: peerTimeSync });

  useVariableSync({ store, isReady, mappings: variableMappings });

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
              /* kepler renders one commit late and silently discards actions
                 addressed to an instance that has not registered yet. */
              onKeplerGlInitialized={() => setIsReady(true)}
            />
          </Provider>
        </StyleSheetManager>
      )}
    </div>
  );
}

export default KeplerMap;
