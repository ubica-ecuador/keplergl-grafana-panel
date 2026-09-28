import { timeToUnixMilli } from '@kepler.gl/utils';
import type { VisStateLike } from './selectionHaloInput';

export interface MapHoverInfo {
  picked?: boolean;
  object?: { index?: number } | null;
  index?: number;
  layer?: { props?: { idx?: number } } | null;
  mapIndex?: number;
}

/** Point rows have a precise time. Trip picks identify a whole path, not a vertex. */
export function mapHoverTime(
  visState: VisStateLike | undefined,
  hover: MapHoverInfo | null | undefined,
  side: number,
  layerId: string | undefined,
  passes: (dataId: string, row: number, layerId: string) => boolean
): number | null {
  if (!hover || hover.picked === false || (hover.mapIndex ?? 0) !== side) {
    return null;
  }
  const idx = hover.layer?.props?.idx;
  const layer = typeof idx === 'number' ? visState?.layers?.[idx] : undefined;
  if (
    !layer ||
    layer.type !== 'point' ||
    !layer.config.isVisible ||
    (layerId && layer.id !== layerId) ||
    (layer.config.columnMode && layer.config.columnMode !== 'points')
  ) {
    return null;
  }
  const sideLayers = visState?.splitMaps?.[side]?.layers;
  const dataId = layer.config.dataId;
  const dataset = dataId ? visState?.datasets?.[dataId] : undefined;
  const row = hover.object?.index ?? hover.index;
  if (
    !dataId ||
    !dataset ||
    (sideLayers && !sideLayers[layer.id]) ||
    row === undefined ||
    !Number.isInteger(row) ||
    row < 0 ||
    row >= dataset.dataContainer.numRows() ||
    !passes(dataId, row, layer.id)
  ) {
    return null;
  }
  const timeCol = dataset.fields.findIndex((field) => field.name === 'time');
  if (timeCol < 0) {
    return null;
  }
  const value = dataset.dataContainer.valueAt(row, timeCol);
  if (value == null || value === '') {
    return null;
  }
  const format = dataset.fields[timeCol].format;
  const time = format ? timeToUnixMilli(value as string | number, format) : Number(value);
  return typeof time === 'number' && Number.isFinite(time) ? time : null;
}
