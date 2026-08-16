import React, { useCallback, useMemo } from 'react';
import { PanelProps } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';

import { KeplerPanelOptions } from '../types';
import { framesToDatasets } from '../data/framesToDatasets';
import { toKeplerTheme } from '../data/keplerTheme';
import { SavedMapConfig } from '../data/mapConfig';
import { CUSTOM_BASEMAP_ID } from './constants';
import { LazyKeplerMap } from './LazyKeplerMap';
import { useStableValue } from './useStableValue';

interface Props extends PanelProps<KeplerPanelOptions> {}

/**
 * Translates Grafana concerns into props for the map.
 *
 * Deliberately free of kepler imports: everything kepler lives behind the
 * dynamic import in LazyKeplerMap, so a dashboard that merely has the plugin
 * installed does not pay for deck.gl and MapLibre.
 */
export function KeplerPanel({ options, onOptionsChange, data, timeRange, onChangeTimeRange, width, height }: Props) {
  const grafanaTheme = useTheme2();

  // kepler and the sync hook work in epoch ms; Grafana hands DateTime objects.
  const grafanaRange = useMemo(() => ({ from: timeRange.from.valueOf(), to: timeRange.to.valueOf() }), [timeRange]);

  // Grafana deep-clones the options on every options change, so without this
  // any click in the panel editor would arrive as "new" field mappings, rebuild
  // the datasets and push a needless — and destructive — refresh into kepler.
  const fieldMappings = useStableValue(options.fieldMappings);

  const datasets = useMemo(
    () =>
      framesToDatasets(data.series, fieldMappings, {
        flowRenderMode: options.flowRenderMode,
        tripLayerMode: options.tripLayerMode,
        // Wind streamlines carry a synthetic clock. Starting it at the dashboard
        // range means the animation lands inside the window the user is looking
        // at; started at "now" it runs into the future, and the default time
        // sync — which pushes that range onto the map as a filter — hides the
        // whole layer.
        windBaseMs: grafanaRange.from,
        windDensity: options.windDensity,
      }),
    [
      data.series,
      fieldMappings,
      options.flowRenderMode,
      options.tripLayerMode,
      options.windDensity,
      grafanaRange.from,
    ]
  );

  const keplerTheme = useMemo(() => toKeplerTheme(grafanaTheme), [grafanaTheme]);
  const followTheme = options.followGrafanaTheme ?? true;

  // `auto` tracks the dashboard theme so a light dashboard does not carry a
  // black map. `custom` is ignored until a URL is actually supplied.
  const basemapId = useMemo(() => {
    const choice = options.basemap ?? 'auto';
    if (choice === 'auto') {
      return keplerTheme.mapStyle;
    }
    if (choice === 'custom') {
      return options.customBasemapUrl ? CUSTOM_BASEMAP_ID : null;
    }
    return choice;
  }, [options.basemap, options.customBasemapUrl, keplerTheme.mapStyle]);

  const handleMapConfigCaptured = useCallback(
    (mapConfig: SavedMapConfig) => onOptionsChange({ ...options, mapConfig }),
    [onOptionsChange, options]
  );

  return (
    <div style={{ width, height, position: 'relative' }}>
      <LazyKeplerMap
        width={width}
        height={height}
        datasets={datasets}
        mapConfig={options.mapConfig}
        theme={followTheme ? keplerTheme : undefined}
        basemapId={basemapId}
        customBasemapUrl={options.customBasemapUrl}
        showSidePanel={options.showSidePanel ?? true}
        saveRequest={options.saveRequest ?? 0}
        onMapConfigCaptured={handleMapConfigCaptured}
        timeSync={options.timeSync ?? 'toMap'}
        grafanaRange={grafanaRange}
        onChangeGrafanaRange={onChangeTimeRange}
        variableMappings={options.variableMappings ?? []}
        timeVariables={options.timeVariables}
        publishWhilePlaying={options.publishWhilePlaying ?? false}
        peerTimeSync={options.peerTimeSync ?? false}
      />
    </div>
  );
}
