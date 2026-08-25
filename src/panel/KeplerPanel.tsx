import React, { useCallback, useMemo } from 'react';
import { PanelProps } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';

import { KeplerPanelOptions } from '../types';
import { framesToDatasets } from '../data/framesToDatasets';
import { framesToRasters } from '../data/rasterDataset';
import { toKeplerTheme } from '../data/keplerTheme';
import { SavedMapConfig } from '../data/mapConfig';
import { CUSTOM_BASEMAP_ID, DEFAULT_RASTER_SERVER_URL } from './constants';
import { LazyKeplerMap } from './LazyKeplerMap';
import { useStableValue } from './useStableValue';
import type { VariableMapping } from './variableSync';

interface Props extends PanelProps<KeplerPanelOptions> {}

/** Stable empty list, so an unconfigured panel has nothing new to react to. */
const EMPTY_MAPPINGS: VariableMapping[] = [];

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

  // Same reason: the viewport channel's effect re-subscribes — and republishes
  // — whenever this identity moves, which a clone would do on every click in
  // the panel editor.
  const viewportVariables = useStableValue(options.viewportVariables);

  // The cross-filtering mappings feed four hooks — filter, click, coordinate
  // and centre — each of which subscribes to the kepler store in an effect
  // keyed by this value. Grafana's clone moves the identity on every options
  // change, and the `?? []` fallback moves it on *every render* when no
  // mapping is configured, so all four tore down and re-subscribed constantly.
  const variableMappings = useStableValue(options.variableMappings ?? EMPTY_MAPPINGS);

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

  // Rasters travel separately from the row datasets all the way to the adapter:
  // a scene has no rows, and `processRowObject([])` returns null, so anything
  // riding in the row list is dropped on the way into kepler.
  const rasters = useMemo(
    () =>
      framesToRasters(data.series, fieldMappings, {
        tileServerUrls: [(options.rasterServerUrl || DEFAULT_RASTER_SERVER_URL).trim()],
        colormap: options.rasterColormap || undefined,
      }),
    [data.series, fieldMappings, options.rasterServerUrl, options.rasterColormap]
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
        rasters={rasters}
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
        variableMappings={variableMappings}
        areaVariable={options.areaVariable ?? ''}
        viewportVariables={viewportVariables}
        timeVariables={options.timeVariables}
        publishWhilePlaying={options.publishWhilePlaying ?? false}
        peerTimeSync={options.peerTimeSync ?? false}
      />
    </div>
  );
}
