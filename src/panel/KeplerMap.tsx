import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Provider } from 'react-redux';
import { StyleSheetManager } from 'styled-components';
import { injectComponents } from '@kepler.gl/components';

import 'maplibre-gl/dist/maplibre-gl.css';

import type { PanelDataset } from '../data/framesToDatasets';
import type { RasterDataset } from '../data/rasterDataset';
import type { WmsDataset } from '../data/wmsDataset';
import type { EsriDataset } from '../data/esriDataset';
import type { ZarrDataset } from '../data/zarrDataset';
import type { SavedMapConfig } from '../data/mapConfig';
import type { KeplerThemeOverride } from '../data/keplerTheme';
import { KEPLER_INSTANCE_ID } from './constants';
import { registeredMapStyles, REPLACES_DEFAULT_MAP_STYLES } from './basemaps';
import { configureKepler } from './keplerConfig';
import { createKeplerStore } from './keplerStore';
import {
  captureMapConfig,
  loadDatasets,
  loadRasters,
  loadWms,
  loadEsri,
  loadZarr,
  refreshDatasets,
  refreshRasters,
  refreshWms,
  refreshEsri,
  refreshZarr,
  setBasemap,
  setSidePanel,
} from './keplerAdapter';
import { decideLoadAction } from './loadDecision';
import { replaceMapControl } from './effectsMapControl';
import { replaceLayerConfigurator } from './flowFieldConfigurator';
import { replaceRangeBrush } from './rangeBrushFix';
import { replaceAnimationController } from './animationSweepFix';
import { useTimeRangeSync } from './useTimeRangeSync';
import { useAutoLayers } from './useAutoLayers';
import { useFlowFieldContext } from './useFlowFieldContext';
import { useFlowFieldAnimationDomain } from './useFlowFieldAnimationDomain';
import { usePeerTimeSync } from './usePeerTimeSync';
import { useVariableSync } from './useVariableSync';
import { useClickSync } from './useClickSync';
import { useCoordinateSync } from './useCoordinateSync';
import { useCenterSync } from './useCenterSync';
import { useRasterTimeline } from './useRasterTimeline';
import { useWmsCalendar } from './useWmsCalendar';
import { useWmsTimeline } from './useWmsTimeline';
import { useEsriTimeline } from './useEsriTimeline';
import { useZarrTimeline } from './useZarrTimeline';
import { useViewportGuard } from './useViewportGuard';
import { savedViewportOf } from './viewportGuard';
import { useViewportSync } from './useViewportSync';
import type { ViewportVariables } from './viewportSync';
import { useAreaSync } from './useAreaSync';
import { useTimeVariableSync } from './useTimeVariableSync';
import type { TimeRangeMs, TimeSyncMode } from './timeSync';
import type { TimeVariableMapping } from './timeVariableSync';
import type { VariableMapping } from './variableSync';

/** Stable empty mapping, so an unconfigured panel does not re-run the effect. */
const NO_TIME_VARIABLES: TimeVariableMapping = { from: '', to: '' };

// Must run before any kepler component mounts. Lives here rather than in
// module.ts so it is part of the deferred chunk.
configureKepler();

// Three repairs to the stock KeplerGl and one addition: a map control that
// carries the effects button kepler ships but never mounts, a range brush that
// paints over its histogram rather than under it, an animation controller whose
// growing window reaches the last of the data before looping — and a layer
// configurator that knows how to draw the flow field's own panel, which kepler
// cannot, never having heard of the type. Module scope so the component tree is
// built once — recreating it per render would remount the whole map. The
// published d.ts declares `injectComponents(recipes?: never[])` — the recipe
// tuple type is lost in compilation — so the list needs a cast.
const KeplerGl = injectComponents([
  replaceMapControl(),
  replaceRangeBrush(),
  replaceAnimationController(),
  replaceLayerConfigurator(),
] as unknown as never[]);

export interface KeplerMapProps {
  width: number;
  height: number;
  datasets: PanelDataset[];
  /**
   * Raster scenes the queries point at. Separate from `datasets` because a
   * scene has no rows to carry.
   */
  rasters: RasterDataset[];
  /**
   * WMS layers the queries name. Separate for the same reason as `rasters`, and
   * a separate list from them because nothing about the two paths is shared:
   * one needs a tile server, the other *is* one.
   */
  wmsLayers: WmsDataset[];
  /**
   * Zarr variables the queries name. Separate again, and for a third reason:
   * unlike a COG this is not one picture but a store of them, so what identifies
   * it is a store plus a variable plus — as the clock moves — an index label.
   */
  zarrLayers: ZarrDataset[];
  esriLayers: EsriDataset[];
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
  viewportVariables?: ViewportVariables;
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
  rasters,
  wmsLayers,
  zarrLayers,
  esriLayers,
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
  viewportVariables,
  timeVariables,
  publishWhilePlaying,
  peerTimeSync,
}: KeplerMapProps) {
  const store = useMemo(() => createKeplerStore(), []);
  const [styleTarget, setStyleTarget] = useState<HTMLElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  // Bumped on every rebuild; arms the viewport guard for the load window.
  const [guardArm, setGuardArm] = useState(0);
  const rearmViewportGuard = useCallback(() => setGuardArm((n) => n + 1), []);

  const hasLoaded = useRef(false);
  const appliedConfig = useRef<SavedMapConfig | null | undefined>(undefined);
  const appliedDatasets = useRef<PanelDataset[] | undefined>(undefined);
  const handledSaveRequest = useRef(saveRequest);

  // Registering the plugin's own styles: satellite imagery that needs no Mapbox
  // account, plus a self-hosted style.json when one is configured, which is
  // what makes the panel usable in air-gapped installs where the Carto base
  // maps are unreachable.
  const mapStyles = useMemo(() => registeredMapStyles(customBasemapUrl), [customBasemapUrl]);

  // A query that named a service but no dates still gets a timeline: the
  // service publishes its own. Everything below works with the filled-in list,
  // so neither the load path nor the timeline has to know which of the two the
  // dates came from.
  const wms = useWmsCalendar(wmsLayers);

  useEffect(() => {
    // A saved tileset is content in its own right: a panel whose map is one
    // vector tile layer over a base map has no query rows at all, and waiting
    // for rows it will never get would leave it permanently blank.
    if (
      !isReady ||
      (datasets.length === 0 &&
        rasters.length === 0 &&
        wms.length === 0 &&
        zarrLayers.length === 0 &&
        esriLayers.length === 0 &&
        !mapConfig?.datasets?.length)
    ) {
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
      loadRasters(store.dispatch, rasters);
      loadWms(store.dispatch, wms);
      loadZarr(store.dispatch, zarrLayers);
      loadEsri(store.dispatch, esriLayers);
      // The viewport this load intends is not safe yet — kepler's internal
      // view state echo can overwrite it — so arm the guard that defends it.
      setGuardArm((n) => n + 1);
    } else {
      refreshDatasets(store, store.dispatch, datasets);
      // Deliberately on the refresh path and never on rebuild. A rebuild frames
      // the viewport around the data and re-arms the viewport guard, so routing
      // a change of scene through it would move the map on every change of the
      // time range — which is the one thing this whole path exists to avoid.
      // `refreshRasters` compares scenes by url, so a refresh that did not
      // change the scene leaves the raster untouched.
      refreshRasters(store, store.dispatch, rasters);
      // A WMS is only rebuilt when the query names a different service or
      // layer; moving through time never reaches here at all.
      refreshWms(store, store.dispatch, wms);
      // A Zarr is only rebuilt when the query names a different store or
      // variable; moving through time never reaches here either.
      refreshZarr(store, store.dispatch, zarrLayers);
      // An Image Service is only rebuilt when the query names a different
      // endpoint or renderer; changing the year moves a `visConfig` instead.
      refreshEsri(store, store.dispatch, esriLayers);
    }
  }, [isReady, datasets, rasters, wms, zarrLayers, esriLayers, mapConfig, store]);

  useViewportGuard({ store, isReady, mapConfig, arm: guardArm });

  // A raster query that returns a dated series hands the choice of scene to the
  // map's own time widget.
  useRasterTimeline({ store, isReady, rasters });

  // A WMS query hands the same widget the service's own dates, and pins which
  // of the service's layers is drawn.
  useWmsTimeline({ store, isReady, layers: wms });

  // A Zarr query hands the widget the moments the store holds, and the label
  // each one answers to.
  useZarrTimeline({ store, isReady, layers: zarrLayers });
  useEsriTimeline({ store, isReady, layers: esriLayers });

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

  // Auto-add trip, flow and flow field layers only on a fresh map; a saved
  // config owns its layers. Adding one can move the viewport, which then needs
  // the same defending the initial load gets.
  useAutoLayers({ store, isReady, datasets, enabled: !mapConfig, onLayerAdded: rearmViewportGuard });

  // Flow fields follow the view: traced once in geographic space the streamlines
  // thin out on zooming in and mat together on zooming out. The clock they run
  // on starts at the dashboard range, so the animation lands inside the window
  // the user is looking at rather than in the future.
  useFlowFieldContext({ store, isReady, baseMs: grafanaRange.from });

  // And the clock at the bottom has to be told about the window they traced in;
  // nothing in kepler republishes it for a `visConfig` change.
  useFlowFieldAnimationDomain({ store, isReady });

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
  useCenterSync({
    store,
    isReady,
    mappings: variableMappings,
    hasSavedViewport: savedViewportOf(mapConfig) !== null,
  });

  // One-way and silent on its first pass — it adopts whatever figures a saved
  // config restored without publishing — so it contends with nothing on load.
  useAreaSync({ store, isReady, variable: areaVariable });

  // One-way: publishes the bbox of what the map shows once it comes to rest,
  // and once on load so a consuming panel never opens without one.
  useViewportSync({ store, isReady, variables: viewportVariables });

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
              /* `appName` is deliberately left at kepler's own default: the
                 side panel names the library the map comes from, and calling
                 it "Grafana" claimed credit for someone else's work. */
              theme={theme}
              mapStyles={mapStyles}
              /* Drops kepler's own list, which is half Mapbox styles that
                 cannot load without an account — see REPLACES_DEFAULT_MAP_STYLES. */
              mapStylesReplaceDefault={REPLACES_DEFAULT_MAP_STYLES}
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
