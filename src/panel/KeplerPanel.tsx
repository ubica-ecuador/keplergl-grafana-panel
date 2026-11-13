import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { type DataFrame, LoadingState, PanelProps } from '@grafana/data';
import { usePanelContext, useTheme2 } from '@grafana/ui';

import { KeplerPanelOptions } from '../types';
import { AssistantContext } from '../assistant/AssistantContext';
import { framesToDatasets } from '../data/framesToDatasets';
import { framesToEsri } from '../data/esriDataset';
import { framesToRasters } from '../data/rasterDataset';
import { resolveBandCombination } from '../data/bandCombination';
import { framesToWms } from '../data/wmsDataset';
import { framesToZarr } from '../data/zarrDataset';
import { toKeplerTheme } from '../data/keplerTheme';
import { datasetsNaming, SavedMapConfig } from '../data/mapConfig';
import { CUSTOM_BASEMAP_ID, rasterServerUrlsOf, resolveRasterServerUrl } from './constants';
import { resolveCustomBasemapUrl } from './customBasemapUrl';
import { DEFAULT_CLICK_AREA_METRES } from './clickArea';
import { LazyKeplerMap } from './LazyKeplerMap';
import { RasterServerNotice } from './RasterServerNotice';
import { SAVE_BUTTON_CLEARANCE_PX } from './SaveMapConfigButton';
import { usePanelEditing } from './usePanelEditing';
import { useInterpolatedOption } from './useInterpolatedOption';
import { useStableValue } from './useStableValue';
import { publishIntervalOf } from './timeVariableSync';
import { withKeplerFields, type VariableMapping } from './variableSync';
import { parseViewportColumns } from './mosaicLink';
import { dayNightDatasets, NIGHT_COLOR } from '../data/dayNight';
import { namesPlaces, useGazetteer } from './useGazetteer';
import { geomapToKepler } from '../geomap/geomapToKepler';
import { GeomapImportNotice } from '../geomap/GeomapImportNotice';
import type { AdHocFilterItem } from './adHocFilters';
import { labelledToLong } from '../data/labelledToLong';
import { DEFAULT_LIVE_INTERVAL_MS, MIN_LIVE_INTERVAL_MS, useLiveSeries } from './useLiveSeries';

interface Props extends PanelProps<KeplerPanelOptions> {}

/** Stable empty list, so an unconfigured panel has nothing new to react to. */
const EMPTY_MAPPINGS: VariableMapping[] = [];
const EMPTY_FIT_VARIABLES: string[] = [];
const EMPTY_AD_HOC_FIELDS: string[] = [];

/** Each frame whose series are told apart by labels as a row per series (`labelledToLong.ts`); the same list when none is. */
function longFrames(series: DataFrame[]): DataFrame[] {
  const long = series.map((frame) => labelledToLong(frame) ?? frame);
  return long.some((frame, i) => frame !== series[i]) ? long : series;
}

/**
 * Translates Grafana concerns into props for the map.
 *
 * Deliberately free of kepler imports: everything kepler lives behind the
 * dynamic import in LazyKeplerMap, so a dashboard that merely has the plugin
 * installed does not pay for deck.gl and MapLibre.
 */
/** The dashboard's uid, or '' where the variable does not resolve (a new, unsaved dashboard). */
function dashboardUidOf(replaceVariables: Props['replaceVariables']): string {
  const uid = replaceVariables('${__dashboard.uid}');
  return uid.startsWith('$') ? '' : uid;
}

export function KeplerPanel(props: Props) {
  const {
    options,
    eventBus,
    onOptionsChange,
    data,
    timeRange,
    onChangeTimeRange,
    replaceVariables,
    timeZone,
    width,
    height,
    id,
  } = props;
  const grafanaTheme = useTheme2();

  // A streaming query (Grafana Live, MQTT) hands new frames with every message;
  // the map takes them at most once per interval. See `useLiveSeries.ts`.
  const streaming = data.state === LoadingState.Streaming;
  const liveSeries = useLiveSeries(
    data.series,
    streaming,
    Math.max(MIN_LIVE_INTERVAL_MS, options.liveIntervalMs ?? DEFAULT_LIVE_INTERVAL_MS)
  );
  const series = useMemo(() => longFrames(liveSeries), [liveSeries]);

  // Grafana shows a field's actions only to a viewer who can edit the
  // dashboard, and says so through the panel context; a Grafana without the
  // hook (before 11.x) answers no, as its own panels do.
  const panelContext = usePanelContext() as {
    canExecuteActions?: () => boolean;
    onAddAdHocFilter?: (item: AdHocFilterItem) => void;
  };
  const canExecuteActions = panelContext.canExecuteActions?.() ?? false;
  // Grafana's table adds ad hoc filters through this; the map does from its
  // popup, when the dashboard has a variable for this panel's datasource.
  const onAddAdHocFilter = panelContext.onAddAdHocFilter;
  const adHocFilterFields = useStableValue(options.adHocFilterFields ?? EMPTY_AD_HOC_FIELDS);

  // kepler and the sync hook work in epoch ms; Grafana hands DateTime objects.
  const grafanaRange = useMemo(() => ({ from: timeRange.from.valueOf(), to: timeRange.to.valueOf() }), [timeRange]);

  // Grafana deep-clones the options on every options change, so without this
  // any click in the panel editor would arrive as "new" field mappings, rebuild
  // the datasets and push a needless — and destructive — refresh into kepler.
  //
  // A panel just switched from Geomap finishes its conversion on the first rows
  // (`geomapToKepler.ts`); until the converted options are back from Grafana,
  // its map and mappings stand in for them, so the map never shows the layers
  // kepler would have guessed instead.
  const geomapConversion = useMemo(
    () => (options.geomapImport ? geomapToKepler(options.geomapImport, series, options.fieldMappings) : null),
    [options.geomapImport, series, options.fieldMappings]
  );
  const fieldMappings = useStableValue(geomapConversion?.fieldMappings ?? options.fieldMappings);
  const routeQueries = useStableValue(geomapConversion?.routeQueries ?? options.routeQueries);
  // What did not carry over outlives the conversion, which the saved options
  // clear: kept from the render that converted, for the notice.
  const [geomapDropped, setGeomapDropped] = useState<string[] | null>(null);
  if (geomapConversion && geomapConversion.dropped !== geomapDropped) {
    setGeomapDropped(geomapConversion.dropped);
  }
  useEffect(() => {
    if (!geomapConversion) {
      return;
    }
    onOptionsChange({
      ...options,
      mapConfig: geomapConversion.mapConfig,
      fieldMappings: geomapConversion.fieldMappings,
      routeQueries: geomapConversion.routeQueries,
      geomapImport: null,
    });
    // Once per conversion: the options it writes are what clears it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geomapConversion]);

  // Same reason: the viewport channel's effect re-subscribes — and republishes
  // — whenever this identity moves, which a clone would do on every click in
  // the panel editor.
  const viewportVariables = useStableValue(options.viewportVariables);
  const mosaicColumns = useMemo(() => parseViewportColumns(options.mosaicColumns), [options.mosaicColumns]);

  // Same reason again: the fit's location listener is keyed by this list.
  const fitOnVariables = useStableValue(options.fitOnVariables ?? EMPTY_FIT_VARIABLES);

  // The cross-filtering mappings feed four hooks — filter, click, coordinate
  // and centre — each of which subscribes to the kepler store in an effect
  // keyed by this value. Grafana's clone moves the identity on every options
  // change, and the `?? []` fallback moves it on *every render* when no
  // mapping is configured, so all four tore down and re-subscribed constantly.
  const variableMappings = useStableValue(options.variableMappings ?? EMPTY_MAPPINGS);

  // The night shading's moment: the end or the start of the dashboard range.
  const dayNight = options.dayNight ?? 'off';
  const nightAt = dayNight === 'off' ? null : dayNight === 'from' ? grafanaRange.from : grafanaRange.to;
  const dayNightSun = Boolean(options.dayNightSun);

  // Place names wait for their gazetteer, fetched only when a query names places.
  const gazetteer = useGazetteer(
    options.gazetteer,
    useMemo(() => namesPlaces(series, fieldMappings), [series, fieldMappings])
  );

  // A map saved while every column named like a count reached kepler as `count` keeps it so (framesToDatasets.ts):
  // the datasets its layers, filters or tooltips name `count` on. Sorted, so a save that names the same ones moves
  // nothing.
  const savedCountIds = useStableValue(
    [...datasetsNaming(geomapConversion?.mapConfig ?? options.mapConfig, 'count')].sort()
  );
  const savedCount = useMemo(() => new Set(savedCountIds), [savedCountIds]);
  const queryDatasets = useMemo(
    () =>
      framesToDatasets(series, fieldMappings, {
        flowRenderMode: options.flowRenderMode,
        tripLayerMode: options.tripLayerMode,
        routeQueries,
        gazetteer,
        savedCount,
      }),
    [series, fieldMappings, options.flowRenderMode, options.tripLayerMode, routeQueries, gazetteer, savedCount]
  );
  const datasets = useMemo(
    () =>
      nightAt === null
        ? queryDatasets
        : [...queryDatasets, ...dayNightDatasets(new Date(nightAt), dayNightSun, NIGHT_COLOR)],
    [queryDatasets, nightAt, dayNightSun]
  );

  // The mappings name the query's columns, as the editor lists them; kepler knows a column with a role by the role's
  // name (`vehicle_id` is `trip_id` there). Stable, so a refresh that renames the same columns re-subscribes nothing.
  const keplerMappings = useStableValue(
    useMemo(() => withKeplerFields(variableMappings, datasets), [variableMappings, datasets])
  );

  // Interpolated like the custom basemap url, and for the same reason: a
  // dashboard variable is how a dropdown reaches a panel option.
  //
  // Through the hook and not through a `useMemo` on `replaceVariables`: neither
  // of that memo's dependencies ever moves — the option holds the literal
  // `'$bands'` and `replaceVariables` is one stable object — so the combination
  // was decided at mount and the dropdown was inert for anyone who did not
  // reload the page. The hook says how the change is caught instead.
  const bands = resolveBandCombination(useInterpolatedOption(options.rasterBands ?? '', replaceVariables));

  // Rasters travel separately from the row datasets all the way to the adapter:
  // a scene has no rows, and `processRowObject([])` returns null, so anything
  // riding in the row list is dropped on the way into kepler.
  //
  // No server is set by default (see DEFAULT_RASTER_SERVER_URL), and a query
  // that needs one is then left off the map and named in `rasterServerMissing`.
  const { rasters, rasterServerMissing } = useMemo(() => {
    const missing: string[] = [];
    const rasters = framesToRasters(series, fieldMappings, {
      tileServerUrls: rasterServerUrlsOf(options.rasterServerUrl),
      colormap: options.rasterColormap || undefined,
      painted: options.rasterPainted,
      bands,
      onMissingServer: (label) => missing.push(label),
    });
    return { rasters, rasterServerMissing: missing };
  }, [series, fieldMappings, options.rasterServerUrl, options.rasterColormap, options.rasterPainted, bands]);

  // A WMS travels the same separate road, and for the same reason: what the
  // query describes is a service, not rows. Nothing about it needs a tile
  // server — the service renders its own pictures.
  const wmsLayers = useMemo(() => framesToWms(series, fieldMappings), [series, fieldMappings]);

  // An ArcGIS Image Service travels the same separate road, and needs no tile
  // server at all: it is a mosaic dataset that renders its own pictures, for
  // any extent, out of however many rasters it holds.
  const esriLayers = useMemo(() => framesToEsri(series, fieldMappings), [series, fieldMappings]);

  // A Zarr travels that same road again, and needs the tile server the raster
  // path needs — the same option, deliberately. Both mean "the TiTiler this
  // panel draws through", and a second option saying the same thing would only
  // be one more place to get it wrong. The colour ramp is shared for the same
  // reason: TiTiler's colormap names are the vocabulary that option already
  // speaks.
  const { zarrLayers, zarrServerMissing } = useMemo(() => {
    const missing: string[] = [];
    const zarrLayers = framesToZarr(series, fieldMappings, {
      serverUrl: resolveRasterServerUrl(options.rasterServerUrl),
      colormap: options.rasterColormap || undefined,
      rescale: options.zarrRescale || undefined,
      onMissingServer: (label) => missing.push(label),
    });
    return { zarrLayers, zarrServerMissing: missing };
  }, [series, fieldMappings, options.rasterServerUrl, options.rasterColormap, options.zarrRescale]);

  // The queries waiting for a tile server, each named once: a query can carry
  // both a raster and a Zarr store.
  const serverMissing = useMemo(
    () => [...new Set([...rasterServerMissing, ...zarrServerMissing])],
    [rasterServerMissing, zarrServerMissing]
  );

  // For kepler's own Add Data → Tileset → Raster Tile form.
  const rasterServerUrls = useMemo(() => rasterServerUrlsOf(options.rasterServerUrl), [options.rasterServerUrl]);

  const keplerTheme = useMemo(() => toKeplerTheme(grafanaTheme), [grafanaTheme]);
  const followTheme = options.followGrafanaTheme ?? true;

  // A self-hosted style may name a dashboard variable and may be written
  // relative to the page; kepler can use neither as authored. See
  // `customBasemapUrl.ts` for what each of the two costs when it is skipped.
  // Relative to the document's base, not the address bar: Grafana sets
  // `<base href>` to its own root, sub-path included, so `public/…` finds
  // Grafana's files wherever the dashboard sits, and `/…` means the same host
  // either way.
  const customBasemapUrl = useMemo(
    () =>
      resolveCustomBasemapUrl(
        options.customBasemapUrl,
        replaceVariables,
        typeof document === 'undefined' ? undefined : document.baseURI
      ),
    [options.customBasemapUrl, replaceVariables]
  );

  // `auto` tracks the dashboard theme so a light dashboard does not carry a
  // black map. `custom` is ignored until a URL is actually supplied — resolved
  // rather than authored, so a variable that expands to nothing counts as none.
  const basemapId = useMemo(() => {
    const choice = options.basemap ?? 'auto';
    if (choice === 'auto') {
      return keplerTheme.mapStyle;
    }
    if (choice === 'custom') {
      return customBasemapUrl ? CUSTOM_BASEMAP_ID : null;
    }
    return choice;
  }, [options.basemap, customBasemapUrl, keplerTheme.mapStyle]);

  const handleMapConfigCaptured = useCallback(
    (mapConfig: SavedMapConfig) => onOptionsChange({ ...options, mapConfig }),
    [onOptionsChange, options]
  );

  // The map shows its save button along its top edge while this panel is in the
  // panel editor; the notice moves below it then.
  const editing = usePanelEditing(id);

  return (
    <div style={{ width, height, position: 'relative' }}>
      <AssistantContext {...props} resolvedBasemapId={basemapId ?? undefined} />
      <LazyKeplerMap
        width={width}
        height={height}
        datasets={datasets}
        frames={series}
        replaceVariables={replaceVariables}
        timeZone={timeZone}
        canExecuteActions={canExecuteActions}
        adHocFilterFields={adHocFilterFields}
        requestFilters={data.request?.filters}
        onAddAdHocFilter={onAddAdHocFilter}
        rasters={rasters}
        wmsLayers={wmsLayers}
        zarrLayers={zarrLayers}
        esriLayers={esriLayers}
        mapConfig={geomapConversion?.mapConfig ?? options.mapConfig}
        theme={followTheme ? keplerTheme : undefined}
        basemapId={basemapId}
        customBasemapUrl={customBasemapUrl}
        rasterServerUrls={rasterServerUrls}
        showSidePanel={options.showSidePanel ?? true}
        saveRequest={options.saveRequest ?? 0}
        onMapConfigCaptured={handleMapConfigCaptured}
        timeSync={options.timeSync ?? 'toMap'}
        grafanaRange={grafanaRange}
        onChangeGrafanaRange={onChangeTimeRange}
        variableMappings={keplerMappings}
        areaVariable={options.areaVariable ?? ''}
        lineVariable={options.lineVariable ?? ''}
        clickArea={Boolean(options.clickArea)}
        clickAreaSizeMetres={options.clickAreaSizeMetres ?? DEFAULT_CLICK_AREA_METRES}
        clickConfirm={Boolean(options.clickConfirm)}
        viewportVariables={viewportVariables}
        mosaicSelection={options.mosaicSelection ?? ''}
        mosaicColumns={mosaicColumns}
        mosaicViewport={Boolean(options.mosaicViewport)}
        mosaicArea={options.mosaicArea ?? true}
        fitOnVariables={fitOnVariables}
        selectionField={options.selectionField ?? ''}
        dimUnselected={Boolean(options.dimUnselected)}
        haloStyle={options.haloStyle ?? 'auto'}
        timeVariables={options.timeVariables}
        publishWhilePlaying={options.publishWhilePlaying ?? false}
        publishIntervalMs={publishIntervalOf(options.publishIntervalMs)}
        peerTimeSync={options.peerTimeSync ?? false}
        liveFollow={streaming && (options.liveFollow ?? true)}
        playheadVariable={options.playheadVariable ?? ''}
        eventBus={eventBus}
        hoverSync={options.hoverSync}
        hoverPublishSpike={options.hoverPublishSpike}
        hoverLayerId={options.hoverLayerId}
        hoverMaxAgeSeconds={options.hoverMaxAgeSeconds}
        panelId={id}
        annotations={data.annotations}
        grafanaAnnotations={options.grafanaAnnotations ?? 'show'}
        dashboardUid={dashboardUidOf(replaceVariables)}
      />
      {/* After the map, so it stacks over it. */}
      <RasterServerNotice queries={serverMissing} top={editing ? SAVE_BUTTON_CLEARANCE_PX : undefined} />
      <GeomapImportNotice dropped={geomapDropped} top={editing ? SAVE_BUTTON_CLEARANCE_PX : undefined} />
    </div>
  );
}
