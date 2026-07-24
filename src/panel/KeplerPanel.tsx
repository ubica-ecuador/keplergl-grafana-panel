import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelProps } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';

import { KeplerPanelOptions } from '../types';
import { framesToDatasets } from '../data/framesToDatasets';
import { toKeplerTheme } from '../data/keplerTheme';
import { createKeplerStore } from './keplerStore';
import { captureMapConfig, loadDatasets, refreshDatasets, setBasemap, setSidePanel } from './keplerAdapter';
import { decideLoadAction } from './loadDecision';
import { CUSTOM_BASEMAP_ID, KeplerMap } from './KeplerMap';

interface Props extends PanelProps<KeplerPanelOptions> {}

export function KeplerPanel({ options, onOptionsChange, data, width, height }: Props) {
  const store = useMemo(() => createKeplerStore(), []);
  const grafanaTheme = useTheme2();

  // State, not a ref: the base map and side panel effects have to re-run once
  // the map registers, and a ref would not retrigger them.
  const [isReady, setIsReady] = useState(false);

  const hasLoaded = useRef(false);
  const appliedConfig = useRef<KeplerPanelOptions['mapConfig']>(undefined);
  const handledSaveRequest = useRef(options.saveRequest ?? 0);

  const datasets = useMemo(
    () => framesToDatasets(data.series, options.fieldMappings),
    [data.series, options.fieldMappings]
  );

  const followTheme = options.followGrafanaTheme ?? true;
  const keplerTheme = useMemo(() => toKeplerTheme(grafanaTheme), [grafanaTheme]);
  const mapConfig = options.mapConfig;

  // kepler renders one commit late (it waits for the styled-components target),
  // and silently discards actions addressed to an instance that has not
  // registered yet — so nothing is dispatched until it says it is ready.
  const handleMapReady = useCallback(() => setIsReady(true), []);

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

  // Base map. `auto` tracks the dashboard theme so a light dashboard does not
  // carry a black map. A saved config already names a style, so it wins.
  useEffect(() => {
    if (!isReady || mapConfig) {
      return;
    }
    const choice = options.basemap ?? 'auto';
    if (choice === 'custom' && !options.customBasemapUrl) {
      return;
    }
    const styleId = choice === 'auto' ? keplerTheme.mapStyle : choice === 'custom' ? CUSTOM_BASEMAP_ID : choice;
    setBasemap(store.dispatch, styleId);
  }, [isReady, options.basemap, options.customBasemapUrl, keplerTheme.mapStyle, mapConfig, store]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    setSidePanel(store.dispatch, options.showSidePanel ?? true);
  }, [isReady, options.showSidePanel, store]);

  // The options editor has no channel to this component, so it bumps a counter
  // and the panel — which can see its own store — performs the capture.
  useEffect(() => {
    const requested = options.saveRequest ?? 0;
    if (requested === handledSaveRequest.current) {
      return;
    }
    handledSaveRequest.current = requested;

    const captured = captureMapConfig(store);
    if (captured) {
      // Record it as applied so saving does not rebuild the map the user is
      // currently looking at.
      appliedConfig.current = captured;
      onOptionsChange({ ...options, mapConfig: captured });
    }
  }, [options, onOptionsChange, store]);

  return (
    <div style={{ width, height, position: 'relative' }}>
      <KeplerMap
        store={store}
        width={width}
        height={height}
        theme={followTheme ? keplerTheme : undefined}
        customBasemapUrl={options.customBasemapUrl}
        onReady={handleMapReady}
      />
    </div>
  );
}
