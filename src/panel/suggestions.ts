import { type DataFrame, type Field, FieldType, VisualizationSuggestionScore } from '@grafana/data';

import { describesFlow, detectFields } from '../data/detectFields';
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
 * The panel's suggestion for the visualization picker: one card when a query
 * holds something the panel draws without help, judged by the same column
 * detection that builds its layers (detectFields.ts).
 *
 * `Best` for a place told plainly: latitude and longitude by a geographic name,
 * a geometry, an H3 cell, a geohash, both ends of a flow, a Zarr store or an
 * ArcGIS Image Service. `OK` when the only hint is weaker: coordinates called
 * `x` and `y`, which an XY chart's data is called too, or a raster or WMS link,
 * whose candidate names (`href`, `layer`) are common words.
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
        // kepler's layer and filter panel would cover a card.
        previewModifier: (suggestion) => {
          suggestion.options = { ...suggestion.options, showSidePanel: false };
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
  if (roles.zarrUrl || roles.esriUrl) {
    return VisualizationSuggestionScore.Best;
  }
  if (numeric(roles.latitude) && numeric(roles.longitude)) {
    const weak =
      WEAK_COORDINATES.has(roles.latitude!.toLowerCase()) || WEAK_COORDINATES.has(roles.longitude!.toLowerCase());
    return weak ? VisualizationSuggestionScore.OK : VisualizationSuggestionScore.Best;
  }
  if (roles.rasterUrl || (roles.wmsUrl && roles.wmsLayer)) {
    return VisualizationSuggestionScore.OK;
  }
  return undefined;
}

/** A geometry column holds text (WKT, GeoJSON), bytes (WKB) or objects; a number is no shape. */
function isShapeField(field: Field | undefined): boolean {
  return Boolean(
    field && field.type !== FieldType.number && field.type !== FieldType.time && field.type !== FieldType.boolean
  );
}
