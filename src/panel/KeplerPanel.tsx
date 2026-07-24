import React, { useCallback, useMemo } from 'react';
import { PanelProps } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';

import { KeplerPanelOptions } from '../types';
import { framesToDatasets } from '../data/framesToDatasets';
import { toKeplerTheme } from '../data/keplerTheme';
import { SavedMapConfig } from '../data/mapConfig';
import { CUSTOM_BASEMAP_ID } from './constants';
import { LazyKeplerMap } from './LazyKeplerMap';

interface Props extends PanelProps<KeplerPanelOptions> {}

/**
 * Translates Grafana concerns into props for the map.
 *
 * Deliberately free of kepler imports: everything kepler lives behind the
 * dynamic import in LazyKeplerMap, so a dashboard that merely has the plugin
 * installed does not pay for deck.gl and MapLibre.
 */
export function KeplerPanel({ options, onOptionsChange, data, width, height }: Props) {
  const grafanaTheme = useTheme2();

  const datasets = useMemo(
    () => framesToDatasets(data.series, options.fieldMappings),
    [data.series, options.fieldMappings]
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
      />
    </div>
  );
}
