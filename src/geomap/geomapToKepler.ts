import { type DataFrame, FieldType } from '@grafana/data';

import { detectFields, type FieldRoleOverrides, resolveRoles } from '../data/detectFields';
import { datasetId } from '../data/framesToDatasets';
import type { SavedMapConfig } from '../data/mapConfig';
import { KEPLER_COLUMN, keplerColumnName } from '../data/toKeplerDataset';
import type { GeomapImport, ImportedColorField, ImportedLayer } from './fromGeomap';

/**
 * Converting a Geomap panel, step two: the layers, once the rows say which
 * columns hold what. Step one is `fromGeomap.ts`.
 */

export interface GeomapConversion {
  mapConfig: SavedMapConfig;
  fieldMappings: Record<string, FieldRoleOverrides>;
  /** The import's own notes and what this step could not place. */
  dropped: string[];
}

/** The kepler config version the panel saves with. */
const KEPLER_CONFIG_VERSION = 'v1';

/**
 * Screen pixels per unit of a kepler point radius.
 *
 * kepler draws points in metres, scaled by `2^(14 − zoom)` so they keep their
 * size on screen as the map zooms: one unit is 2^14 m over the metres a pixel
 * spans at zoom 0 on MapLibre's 512-pixel world, about 0.21 px. Geomap sizes
 * markers in pixels. True at the equator; metres stretch with latitude, so a
 * point at 60° is drawn twice as large as one at 0°.
 */
const PIXELS_PER_RADIUS_UNIT = 2 ** 14 / (40075016.686 / 512);

/**
 * kepler's heatmap radius grows with the zoom, from 2 px at zoom 0 to the
 * configured radius at zoom 18 (its `interpolateByZoom`). Geomap's is fixed in
 * pixels, so the radius that matches it depends on the zoom the map opens at;
 * a map framed on its data opens at a zoom unknown here, taken as a region's.
 */
const HEAT_MIN_PIXELS = 2;
const HEAT_FULL_ZOOM = 18;
const HEAT_MAX_RADIUS = 100;
const FIT_ZOOM_GUESS = 6;

function heatRadiusAt(pixels: number, zoom: number): number {
  const z = Math.max(zoom, 1);
  const radius = HEAT_MIN_PIXELS + ((pixels - HEAT_MIN_PIXELS) * HEAT_FULL_ZOOM) / z;
  return Math.min(HEAT_MAX_RADIUS, Math.round(radius * 10) / 10);
}

function pointRadius(pixels: number): number {
  return Math.round((pixels / PIXELS_PER_RADIUS_UNIT) * 10) / 10;
}

/**
 * kepler's layers for a Geomap import, given the frames the queries returned.
 *
 * Returns null while there is nothing to read the columns from, so the caller
 * waits for data rather than saving a map with every layer missing.
 */
export function geomapToKepler(
  imported: GeomapImport,
  frames: DataFrame[],
  fieldMappings: Record<string, FieldRoleOverrides> = {}
): GeomapConversion | null {
  if (!frames.length) {
    return null;
  }
  const dropped = [...imported.dropped];
  const mappings: Record<string, FieldRoleOverrides> = { ...fieldMappings };
  const layers: unknown[] = [];

  const zoom = imported.view === 'fit' ? FIT_ZOOM_GUESS : imported.view.zoom;
  let legend = false;
  imported.layers.forEach((layer, index) => {
    const position = layer.refId ? frames.findIndex((f) => f.refId === layer.refId) : 0;
    if (position < 0) {
      dropped.push(`“${layer.label}”: query ${layer.refId} returned nothing`);
      return;
    }
    const frame = frames[position];
    const refId = frame.refId ?? `${position}`;
    const overrides: FieldRoleOverrides = { ...mappings[refId] };
    if (layer.location.mode === 'coords') {
      overrides.latitude = layer.location.latitude;
      overrides.longitude = layer.location.longitude;
    }
    const roles = resolveRoles(detectFields(frame), overrides);
    if (!roles.latitude || !roles.longitude) {
      dropped.push(`“${layer.label}”: no latitude and longitude columns found`);
      return;
    }
    legend ||= Boolean(layer.legend && (layer.colorField || layer.sizeField));
    if (layer.location.mode === 'coords') {
      mappings[refId] = overrides;
    }
    const column = (name: string | undefined) => {
      const field = name ? frame.fields.find((f) => f.name === name) : undefined;
      return field ? { name: keplerColumnName(roles, field.name), type: keplerType(field.type) } : undefined;
    };
    layers.push(toKeplerLayer(layer, `geomap-${index}`, datasetId(refId), column, zoom));
  });

  const config: Record<string, unknown> = {
    visState: {
      layers,
      interactionConfig: { tooltip: { enabled: imported.tooltip } },
    },
    // Geomap draws a legend for a markers layer coloured or sized by a field.
    uiState: { mapControls: { mapLegend: { active: legend, show: true } } },
  };
  // A view to open on; without one the panel frames the data, which is what
  // Geomap's "Fit to data" asks for.
  if (imported.view !== 'fit') {
    config.mapState = { ...imported.view, bearing: 0, pitch: 0, dragRotate: false };
  }
  return { mapConfig: { version: KEPLER_CONFIG_VERSION, config }, fieldMappings: mappings, dropped };
}

type ColumnOf = (name: string | undefined) => { name: string; type: string } | undefined;

function toKeplerLayer(
  layer: ImportedLayer,
  id: string,
  dataId: string,
  column: ColumnOf,
  zoom: number
): Record<string, unknown> {
  const common = {
    dataId,
    label: layer.label,
    color: layer.color,
    columnMode: 'points',
    columns: { lat: KEPLER_COLUMN.latitude, lng: KEPLER_COLUMN.longitude },
    isVisible: true,
  };

  if (layer.type === 'heatmap') {
    const weight = column(layer.weightField);
    return {
      id,
      type: 'heatmap',
      config: {
        ...common,
        visConfig: {
          opacity: layer.opacity,
          radius: heatRadiusAt(layer.heatRadius ?? 20, zoom),
          intensity: 1,
          threshold: 0.18,
          colorRange: colorRangeOf(layer.colorField, 'Geomap heatmap'),
        },
      },
      visualChannels: weight ? { weightField: weight, weightScale: 'linear' } : { weightScale: 'linear' },
    };
  }

  const colorField = column(layer.colorField?.name);
  const sizeField = column(layer.sizeField);
  const textField = column(layer.textField);
  return {
    id,
    type: 'point',
    config: {
      ...common,
      // Geomap fills a marker at its style's opacity and strokes it in the
      // same colour at full strength.
      visConfig: {
        radius: pointRadius(layer.radius),
        radiusRange: layer.radiusRange.map(pointRadius),
        opacity: layer.opacity,
        filled: true,
        outline: true,
        thickness: 1,
        strokeColor: layer.color,
        ...(colorField && layer.colorField
          ? { colorRange: colorRangeOf(layer.colorField, `Geomap · ${layer.colorField.name}`) }
          : {}),
      },
      ...(textField
        ? {
            textLabel: [
              {
                field: textField,
                color: [255, 255, 255],
                size: layer.textSize ?? 12,
                offset: layer.textOffset ?? [0, 0],
                anchor: 'middle',
                alignment: 'center',
              },
            ],
          }
        : {}),
    },
    visualChannels: {
      ...(colorField ? { colorField, colorScale: layer.colorField?.scale ?? 'quantize' } : {}),
      ...(sizeField ? { sizeField, sizeScale: 'sqrt' } : {}),
    },
  };
}

function colorRangeOf(field: ImportedColorField | undefined, name: string): Record<string, unknown> | undefined {
  if (!field) {
    return undefined;
  }
  return {
    name,
    type: field.scale === 'custom' ? 'custom' : field.scale === 'ordinal' ? 'qualitative' : 'sequential',
    category: 'Custom',
    colors: field.colors,
    ...(field.colorMap ? { colorMap: field.colorMap } : {}),
  };
}

/** Grafana's field type, as kepler names it in a saved visual channel. */
function keplerType(type: FieldType): string {
  switch (type) {
    case FieldType.number:
      return 'real';
    case FieldType.time:
      return 'timestamp';
    case FieldType.boolean:
      return 'boolean';
    default:
      return 'string';
  }
}
