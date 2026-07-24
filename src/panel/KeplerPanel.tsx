import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { PanelProps } from '@grafana/data';

import { KeplerPanelOptions } from '../types';
import { framesToDatasets } from '../data/framesToDatasets';
import { createKeplerStore } from './keplerStore';
import { captureMapConfig, loadDatasets, refreshDatasets } from './keplerAdapter';
import { KeplerMap } from './KeplerMap';

interface Props extends PanelProps<KeplerPanelOptions> {}

export function KeplerPanel({ options, onOptionsChange, data, width, height }: Props) {
  const store = useMemo(() => createKeplerStore(), []);
  const isReady = useRef(false);
  const appliedConfig = useRef<KeplerPanelOptions['mapConfig'] | undefined>(undefined);
  const handledSaveRequest = useRef(options.saveRequest ?? 0);

  const datasets = useMemo(
    () => framesToDatasets(data.series, options.fieldMappings),
    [data.series, options.fieldMappings]
  );

  const mapConfig = options.mapConfig;

  const push = useCallback(() => {
    if (!isReady.current || datasets.length === 0) {
      return;
    }

    // A config the map has not seen yet — the first load, or one the user just
    // imported. kepler will not accept a config after data is loaded, so the
    // whole map is rebuilt around it.
    if (appliedConfig.current !== mapConfig) {
      appliedConfig.current = mapConfig;
      loadDatasets(store.dispatch, datasets, {}, mapConfig);
      return;
    }

    // Steady state: replace the data behind the existing datasets while
    // preserving the layers, filters and styling configured on top of them.
    refreshDatasets(store.dispatch, datasets);
  }, [datasets, mapConfig, store]);

  // kepler renders one commit late (it waits for the styled-components target),
  // and silently discards actions addressed to an instance that has not
  // registered yet — so the first load is driven by kepler's own callback.
  const handleMapReady = useCallback(() => {
    isReady.current = true;
    push();
  }, [push]);

  useEffect(() => {
    push();
  }, [push]);

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
      // Record it as applied so saving does not trigger a rebuild of the map
      // the user is looking at.
      appliedConfig.current = captured;
      onOptionsChange({ ...options, mapConfig: captured });
    }
  }, [options, onOptionsChange, store]);

  return (
    <div style={{ width, height, position: 'relative' }}>
      <KeplerMap store={store} width={width} height={height} onReady={handleMapReady} />
    </div>
  );
}
