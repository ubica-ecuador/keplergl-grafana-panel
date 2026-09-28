import React, { createContext, useContext, useMemo } from 'react';
import type { EventBus } from '@grafana/data';
import { ScatterplotLayer } from '@deck.gl/layers';
import { cursorIndex } from './temporalCursor';
import { type TrajectorySample, positionsAtTime } from './trajectoryTimeIndex';
import { rowPassesFor, type VisStateLike } from './selectionHaloInput';
import { mapHoverTime, type MapHoverInfo } from './mapHoverTime';
import { useMapHoverPublisher } from './useMapHoverPublisher';
import { useGrafanaHoverTime } from './useGrafanaHoverTime';

export interface TemporalCursorOptions {
  eventBus?: EventBus;
  enabled?: boolean;
  publishMapHover?: boolean;
  layerId?: string;
  maxAgeSeconds?: number;
}

export const TemporalCursorContext = createContext<TemporalCursorOptions>({});

type DeckProps = Record<string, unknown>;
interface Props {
  visState?: VisStateLike & { hoverInfo?: MapHoverInfo | null };
  mapState?: { globe?: { enabled?: boolean } };
  index?: number;
  deckRenderCallbacks?: { onDeckRender?: (props: DeckProps) => DeckProps | null } & Record<string, unknown>;
}

/** Cursor state lives at the map container so a graph hover never rebuilds the panel datasets. */
export function withTemporalCursor<P extends Props>(MapContainer: React.ComponentType<P>): React.FC<P> {
  return function TemporalCursorMapContainer(props: P) {
    const options = useContext(TemporalCursorContext);
    const time = useGrafanaHoverTime(options.eventBus, Boolean(options.enabled));
    const { layers, datasets, filters, splitMaps } = props.visState ?? {};
    const side = props.index ?? 0;
    const tracks = useMemo(() => {
      if (!options.enabled) {
        return [];
      }
      const sideLayers = splitMaps?.[side]?.layers;
      return (layers ?? []).flatMap((layer) => {
        const dataset = datasets?.[layer.config.dataId ?? ''];
        if (
          !dataset ||
          !layer.config.isVisible ||
          (sideLayers && !sideLayers[layer.id]) ||
          (options.layerId && layer.id !== options.layerId)
        ) {
          return [];
        }
        const index = cursorIndex(layer, dataset);
        return index.length ? [{ layer, index }] : [];
      });
    }, [options.enabled, options.layerId, layers, datasets, splitMaps, side]);
    const passes = useMemo(() => rowPassesFor({ layers, datasets, filters }), [layers, datasets, filters]);
    const publishEnabled = Boolean(options.enabled && options.publishMapHover);
    const hoveredTime = publishEnabled
      ? mapHoverTime(props.visState, props.visState?.hoverInfo, side, options.layerId, passes)
      : null;
    useMapHoverPublisher(options.eventBus, publishEnabled, hoveredTime);
    const points = useMemo(() => {
      if (time === null) {
        return [];
      }
      const maxAge = options.maxAgeSeconds ?? 60;
      // A dataset may have both Point and Trip layers. Draw their shared sample once.
      const unique = new Map<string, TrajectorySample>();
      for (const { layer, index } of tracks) {
        for (const sample of positionsAtTime(index, time, Math.max(0, maxAge) * 1000)) {
          if (passes(layer.config.dataId!, sample.row, layer.id)) {
            unique.set(JSON.stringify([layer.config.dataId, sample.row, sample.position]), sample);
          }
        }
      }
      return [...unique.values()];
    }, [tracks, time, options.maxAgeSeconds, passes]);

    if (!points.length) {
      return <MapContainer {...props} />;
    }
    const cursor = new ScatterplotLayer({
      id: `panel-temporal-cursor-${side}`,
      data: points,
      getPosition: (point) => point.position,
      radiusUnits: 'pixels',
      getRadius: 7,
      filled: true,
      stroked: true,
      getFillColor: [255, 179, 0, 255],
      getLineColor: [255, 255, 255, 255],
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      pickable: false,
      parameters: props.mapState?.globe?.enabled
        ? { depthTest: true, depthMask: false, cull: false }
        : { depthTest: false },
    });
    const chained = props.deckRenderCallbacks?.onDeckRender;
    return (
      <MapContainer
        {...props}
        deckRenderCallbacks={{
          ...props.deckRenderCallbacks,
          onDeckRender: (deckProps: DeckProps) => {
            const base = chained ? chained(deckProps) : deckProps;
            return base ? { ...base, layers: [...((base.layers as unknown[]) ?? []), cursor] } : null;
          },
        }}
      />
    );
  };
}
