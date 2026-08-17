import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Provider } from 'react-redux';
import { StyleSheetManager } from 'styled-components';
import { injectComponents } from '@kepler.gl/components';

import 'maplibre-gl/dist/maplibre-gl.css';

import type { PanelDataset } from '../data/framesToDatasets';
import type { SavedMapConfig } from '../data/mapConfig';
import type { KeplerThemeOverride } from '../data/keplerTheme';
import { KEPLER_INSTANCE_ID, SATELLITE_BASEMAP_ID } from './constants';
import { registeredMapStyles } from './basemaps';
import { configureKepler } from './keplerConfig';
import { createKeplerStore } from './keplerStore';
import { captureMapConfig, loadDatasets, refreshDatasets, setBasemap, setSidePanel } from './keplerAdapter';
import { decideLoadAction } from './loadDecision';
import { replaceMapControl } from './effectsMapControl';
import { useTimeRangeSync } from './useTimeRangeSync';
import { useAutoLayers } from './useAutoLayers';
import { useWindViewport } from './useWindViewport';
import { usePeerTimeSync } from './usePeerTimeSync';
import { useVariableSync } from './useVariableSync';
import { useClickSync } from './useClickSync';
import { useCoordinateSync } from './useCoordinateSync';
import { useCenterSync } from './useCenterSync';
import { useAreaSync } from './useAreaSync';
import { useTimeVariableSync } from './useTimeVariableSync';
import { useActiveBasemap } from './useActiveBasemap';
import { BasemapAttribution } from './BasemapAttribution';
import type { TimeRangeMs, TimeSyncMode } from './timeSync';
import type { TimeVariableMapping } from './timeVariableSync';
import type { VariableMapping } from './variableSync';

/** Stable empty mapping, so an unconfigured panel does not re-run the effect. */
const NO_TIME_VARIABLES: TimeVariableMapping = { from: '', to: '' };

// Must run before any kepler component mounts. Lives here rather than in
// module.ts so it is part of the deferred chunk.
configureKepler();

// The stock KeplerGl toolbar has no effects button; this KeplerGl carries the
// map control that adds it. Module scope so the component tree is built once —
// recreating it per render would remount the whole map.
// The published d.ts declares `injectComponents(recipes?: never[])` — the
// recipe tuple type is lost in compilation — so the list needs a cast.
const KeplerGl = injectComponents([replaceMapControl()] as unknown as never[]);

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
  /** Variable the drawn polygon/rectangle is published to as WKT; empty for none. */
  areaVariable: string;
  /** The two variables the time slider's window is published to, if configured. */
  timeVariables?: TimeVariableMapping;
  /** Whether playing the slider publishes as it runs, or only once it stops. */
  publishWhilePlaying: boolean;
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
  areaVariable,
  timeVariables,
  publishWhilePlaying,
  peerTimeSync,
}: KeplerMapProps) {
  const store = useMemo(() => createKeplerStore(), []);
  const [styleTarget, setStyleTarget] = useState<HTMLElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  const hasLoaded = useRef(false);
  const appliedConfig = useRef<SavedMapConfig | null | undefined>(undefined);
  const appliedDatasets = useRef<PanelDataset[] | undefined>(undefined);
  const handledSaveRequest = useRef(saveRequest);

  // Registering the plugin's own styles: satellite imagery that needs no Mapbox
  // account, plus a self-hosted style.json when one is configured, which is
  // what makes the panel usable in air-gapped installs where the Carto base
  // maps are unreachable.
  const mapStyles = useMemo(() => registeredMapStyles(customBasemapUrl), [customBasemapUrl]);

  useEffect(() => {
    if (!isReady || datasets.length === 0) {
      return;
    }

    const action = decideLoadAction({
      hasLoaded: hasLoaded.current,
      appliedConfig: appliedConfig.current,
      currentConfig: mapConfig,
      appliedDatasets: appliedDatasets.current,
      currentDatasets: datasets,
    });

    // 'none' when neither the data nor the config really changed — an options
    // clone from the panel editor. Dispatching anything here is what used to
    // corrupt "Save current map configuration": the refresh emptied the store
    // right before the save effect below snapshotted it.
    if (action === 'none') {
      return;
    }

    appliedDatasets.current = datasets;
    if (action === 'rebuild') {
      hasLoaded.current = true;
      appliedConfig.current = mapConfig;
      loadDatasets(store.dispatch, datasets, {}, mapConfig);
    } else {
      refreshDatasets(store, store.dispatch, datasets);
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

  // Wind streamlines follow the view: traced once in geographic space they thin
  // out on zooming in and mat together on zooming out.
  useWindViewport(store, datasets, isReady);

  // Declared after the dashboard sync so the dashboard range wins on load and
  // the maps only trade the clock between themselves afterwards.
  usePeerTimeSync({ store, isReady, enabled: peerTimeSync });

  useVariableSync({ store, isReady, mappings: variableMappings });

  // One-way: publishes the clicked entity's mapped columns, and clears only
  // what it published itself, so a shared link's variable survives stray
  // clicks on the map background.
  useClickSync({ store, isReady, mappings: variableMappings });

  // One-way: publishes the clicked map coordinate as a lat/lng variable pair,
  // keeping the last pin through kepler's unpin toggle and data refreshes.
  useCoordinateSync({ store, isReady, mappings: variableMappings });

  // The read-back of that pair: centres the map when the variables change from
  // outside (a table's data link, a textbox), suppressing the echo of the
  // map's own clicks.
  useCenterSync({ store, isReady, mappings: variableMappings });

  // One-way and silent on its first pass — it adopts whatever figures a saved
  // config restored without publishing — so it contends with nothing on load.
  useAreaSync({ store, isReady, variable: areaVariable });

  // Declared last so the dashboard-range sync has already had its say on load;
  // in `variables` mode that sync stands down entirely and this owns the clock.
  useTimeVariableSync({
    store,
    isReady,
    enabled: timeSync === 'variables',
    mapping: timeVariables ?? NO_TIME_VARIABLES,
    whilePlaying: publishWhilePlaying,
    peerSync: peerTimeSync,
  });

  // kepler's own attribution bar never credits Esri — it renders a hardcoded
  // "© kepler.gl" / basemap-library line and ignores a raster source's
  // `attribution` field entirely. The panel renders Esri's credit itself,
  // only while the satellite style is actually the one showing.
  const activeBasemapId = useActiveBasemap({ store, isReady });

  return (
    <div ref={setStyleTarget} style={{ width, height, position: 'relative', overflow: 'hidden' }}>
      {activeBasemapId === SATELLITE_BASEMAP_ID && <BasemapAttribution />}
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
