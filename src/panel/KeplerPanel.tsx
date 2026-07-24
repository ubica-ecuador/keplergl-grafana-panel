import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanelProps } from '@grafana/data';
import { Button } from '@grafana/ui';

import { KeplerPanelOptions } from '../types';
import { createKeplerStore } from './keplerStore';
import { loadDatasets, refreshDatasets, rowsToDataset } from './keplerAdapter';
import { KeplerMap } from './KeplerMap';

interface Props extends PanelProps<KeplerPanelOptions> {}

const SPIKE_DATASET_ID = 'spike-fixed';

/**
 * Fixed dataset for the feasibility spike: a handful of points around Cuenca,
 * Ecuador, carrying a timestamp and a numeric field so kepler has something to
 * colour by. Phase 1 replaces this with real DataFrame conversion.
 *
 * `generation` shifts the coordinates and values so a refresh is visibly a
 * refresh — which is what makes exit criterion 4 observable: the layer the user
 * configured by hand must survive the new data.
 */
function buildSpikeRows(generation: number): Array<Record<string, unknown>> {
  const baseLat = -2.9;
  const baseLng = -79.0;
  const drift = generation * 0.004;

  return Array.from({ length: 40 }, (_, i) => {
    const angle = (i / 40) * Math.PI * 2;
    return {
      latitude: baseLat + Math.sin(angle) * 0.03 + drift,
      longitude: baseLng + Math.cos(angle) * 0.03 + drift,
      time: new Date(Date.UTC(2026, 6, 23, 8, 0, 0) + i * 60_000).toISOString(),
      speed: Math.round(20 + Math.sin(angle + generation) * 15),
      trip_id: `trip-${i % 4}`,
    };
  });
}

export function KeplerPanel({ width, height }: Props) {
  const store = useMemo(() => createKeplerStore(), []);
  const [generation, setGeneration] = useState(0);
  const hasLoaded = useRef(false);

  // First load. Driven by kepler's own "I am registered" callback rather than a
  // mount effect: <KeplerGl> is rendered one commit late (it waits for the
  // styled-components target element), so a mount effect here fires before the
  // instance exists and kepler discards the action without warning.
  const handleMapReady = useCallback(() => {
    if (hasLoaded.current) {
      return;
    }
    const dataset = rowsToDataset(SPIKE_DATASET_ID, 'Spike data', buildSpikeRows(0));
    if (dataset) {
      loadDatasets(store.dispatch, [dataset], { centerMap: true });
      hasLoaded.current = true;
    }
  }, [store]);

  // Refresh path: new data, same dataset id, existing config preserved.
  const simulateRefresh = useCallback(() => {
    const next = generation + 1;
    const dataset = rowsToDataset(SPIKE_DATASET_ID, 'Spike data', buildSpikeRows(next));
    if (dataset) {
      refreshDatasets(store.dispatch, [dataset]);
      setGeneration(next);
    }
  }, [generation, store]);

  return (
    <div style={{ width, height, position: 'relative' }}>
      <KeplerMap store={store} width={width} height={height} onReady={handleMapReady} />

      {/*
        Deliberately outside <KeplerMap>, and therefore outside the kepler
        <Provider>: this is a @grafana/ui component and must not resolve
        react-redux context against the kepler store.
      */}
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}>
        <Button size="sm" variant="secondary" onClick={simulateRefresh} data-testid="spike-refresh">
          Simulate refresh ({generation})
        </Button>
      </div>
    </div>
  );
}
