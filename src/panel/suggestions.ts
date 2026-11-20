import { type DataFrame, type Field, FieldType, VisualizationSuggestionScore } from '@grafana/data';

import { describesFlow, detectFields } from '../data/detectFields';
import { rasterKind } from '../data/rasterDataset';
import type { KeplerPanelOptions } from '../types';

/**
 * The part of Grafana's `PanelDataSummary` the supplier reads.
 *
 * Grafana 13 calls a panel plugin's suggestions supplier with the summary of
 * the panel's data and opens the list to plugins outside the core ones (the
 * `suggestions` flag of plugin.json). `rawFrames` came with that and is missing
 * from the 12.0 types this plugin builds against, hence the local interface.
 * Grafana 12 never calls an external plugin's supplier.
 */
export interface SuggestionDataSummary {
  hasData?: boolean;
  rawFrames?: DataFrame[];
}

export interface KeplerSuggestion {
  score: VisualizationSuggestionScore;
  cardOptions: {
    maxRows: number;
    previewModifier: (suggestion: { options?: Partial<KeplerPanelOptions> }) => void;
  };
}

/**
 * Rows a preview card draws. The card is a live map at thumbnail size: a few
 * thousand points show the shape of the data, the full query only costs time.
 */
export const PREVIEW_MAX_ROWS = 5000;

/**
 * What a preview card folds away, since at thumbnail size it would cover the
 * map: kepler's layer and filter panel, and the time widget. That widget is the
 * time filter the panel makes to follow the dashboard's range (`timeSync`'s
 * default); the query already holds only that range, so the card draws the
 * same rows without it. Picking the card does not carry these over.
 */
export const PREVIEW_OPTIONS: Partial<KeplerPanelOptions> = { showSidePanel: false, timeSync: 'off' };

/**
 * The panel's suggestion for the visualization picker: one card when a query
 * holds something the panel draws without help, judged by the same column
 * detection that builds its layers (detectFields.ts).
 *
 * `Best` for a place told plainly: latitude and longitude by a geographic name,
 * a geometry, an H3 cell, a geohash, both ends of a flow, a Zarr store or an
 * ArcGIS Image Service. `OK` when the only hint is weaker: coordinates called
 * `x` and `y`, which an XY chart's data is called too, or a PMTiles raster or
 * WMS link, whose candidate names (`href`, `layer`) are common words.
 *
 * No card for imagery that needs a raster tile server: a COG, a STAC item or a
 * Zarr store. A card draws with the panel's defaults, which set no server, so
 * all it could show is the notice asking for one. Such a query still turns
 * into a map from "All visualizations", where that notice is the right advice.
 *
 * Grafana ranks every core panel above an external one whatever the score, so
 * the score only orders this card against other plugins'. The Plus panel
 * shares this supplier through its copy of the module.
 *
 * A suggestion carries no options of its own. Picking it is a visualization
 * change like any other: a Geomap's map, or a Kepler Plus panel's, comes across
 * through the panel change handler (checked on Grafana 13.3, both ways in).
 */
export function keplerSuggestions(summary: SuggestionDataSummary): KeplerSuggestion[] | void {
  if (!summary.hasData || !summary.rawFrames?.length) {
    return;
  }
  let best: VisualizationSuggestionScore | undefined;
  for (const frame of summary.rawFrames) {
    const score = frameScore(frame);
    if (score !== undefined && (best === undefined || score > best)) {
      best = score;
    }
    if (best === VisualizationSuggestionScore.Best) {
      break;
    }
  }
  if (best === undefined) {
    return;
  }
  return [
    {
      score: best,
      cardOptions: {
        maxRows: PREVIEW_MAX_ROWS,
        previewModifier: (suggestion) => {
          suggestion.options = { ...suggestion.options, ...PREVIEW_OPTIONS };
        },
      },
    },
  ];
}

const WEAK_COORDINATES = new Set(['x', 'y']);

function frameScore(frame: DataFrame): VisualizationSuggestionScore | undefined {
  if (!frame.fields.some((field) => field.values.length > 0)) {
    return undefined;
  }
  const roles = detectFields(frame);
  const field = (name: string | undefined) => (name ? frame.fields.find((f) => f.name === name) : undefined);
  const numeric = (name: string | undefined) => field(name)?.type === FieldType.number;
  const shaped = (name: string | undefined) => isShapeField(field(name));

  if (shaped(roles.geometry) || field(roles.h3) || field(roles.geohash) || describesFlow(roles)) {
    return VisualizationSuggestionScore.Best;
  }
  if (roles.esriUrl) {
    return VisualizationSuggestionScore.Best;
  }
  if (numeric(roles.latitude) && numeric(roles.longitude)) {
    const weak =
      WEAK_COORDINATES.has(roles.latitude!.toLowerCase()) || WEAK_COORDINATES.has(roles.longitude!.toLowerCase());
    return weak ? VisualizationSuggestionScore.OK : VisualizationSuggestionScore.Best;
  }
  if (drawsWithoutServer(field(roles.rasterUrl)) || (roles.wmsUrl && roles.wmsLayer)) {
    return VisualizationSuggestionScore.OK;
  }
  return undefined;
}

/** A raster column whose links include a PMTiles archive, which kepler reads without a tile server. */
function drawsWithoutServer(field: Field | undefined): boolean {
  return Boolean(field?.values.some((url) => typeof url === 'string' && rasterKind(url) === 'pmtiles'));
}

/** A geometry column holds text (WKT, GeoJSON), bytes (WKB) or objects; a number is no shape. */
function isShapeField(field: Field | undefined): boolean {
  return Boolean(
    field && field.type !== FieldType.number && field.type !== FieldType.time && field.type !== FieldType.boolean
  );
}
