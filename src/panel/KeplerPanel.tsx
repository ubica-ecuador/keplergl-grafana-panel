import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { PanelProps } from '@grafana/data';

import { KeplerPanelOptions } from '../types';
import { framesToDatasets } from '../data/framesToDatasets';
import { createKeplerStore } from './keplerStore';
import { loadDatasets, refreshDatasets } from './keplerAdapter';
import { KeplerMap } from './KeplerMap';

interface Props extends PanelProps<KeplerPanelOptions> {}

export function KeplerPanel({ options, data, width, height }: Props) {
  const store = useMemo(() => createKeplerStore(), []);
  const isReady = useRef(false);
  const hasLoaded = useRef(false);

  const datasets = useMemo(
    () => framesToDatasets(data.series, options.fieldMappings),
    [data.series, options.fieldMappings]
  );

  const push = useCallback(() => {
    if (!isReady.current || datasets.length === 0) {
      return;
    }

    if (hasLoaded.current) {
      // Replaces the data behind existing datasets while preserving the layers,
      // filters and styling the user configured by hand.
      refreshDatasets(store.dispatch, datasets);
    } else {
      loadDatasets(store.dispatch, datasets, { centerMap: true });
      hasLoaded.current = true;
    }
  }, [datasets, store]);

  // kepler renders one commit late (it waits for the styled-components target),
  // and silently discards actions addressed to an instance that has not
  // registered yet — so the first load is driven by kepler's own callback.
  const handleMapReady = useCallback(() => {
    isReady.current = true;
    push();
  }, [push]);

  // Every subsequent query refresh.
  useEffect(() => {
    push();
  }, [push]);

  return (
    <div style={{ width, height, position: 'relative' }}>
      <KeplerMap store={store} width={width} height={height} onReady={handleMapReady} />
    </div>
  );
}
