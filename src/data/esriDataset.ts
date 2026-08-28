import type { DataFrame } from '@grafana/data';

import { detectFields, resolveRoles, type FieldRoleOverrides } from './detectFields';

/**
 * An ArcGIS Image Service in the shape the panel's own layer reads.
 *
 * Sibling to `wmsDataset.ts` rather than to `rasterDataset.ts`, and for the
 * same reason that one is: what the query describes is a **service**, not a
 * file. Nothing here needs a tile server, because the service renders its own
 * pictures — and unlike a COG it renders them for any extent at any zoom, out
 * of a mosaic of however many rasters it holds.
 */
export interface EsriDataset {
  /** `grafana-<refId>-esri`, so a refresh can tell its own layers from a user's. */
  id: string;
  label: string;
  /** The service endpoint, ending in `/ImageServer`. */
  serviceUrl: string;
  /**
   * Which rasters of the mosaic to draw, as the service's own JSON.
   *
   * How a year is chosen on a multi-temporal service. Passed through untouched:
   * the vocabulary is ArcGIS's, and modelling it here would only be a smaller,
   * staler copy of their documentation.
   */
  mosaicRule?: string;
  /** How to draw them, as the service's own JSON. */
  renderingRule?: string;
  /**
   * One moment per dated row, oldest first, each with the rule that draws it.
   *
   * A service holds every year behind one endpoint, so walking a timeline over
   * it costs no query and no dataset change: the clock picks a moment, its rule
   * lands in the layer's `visConfig`, and deck refetches what is on screen. The
   * rules come from the query rather than being derived here — how a service
   * names its years is the service's business, not ours to guess.
   */
  moments?: EsriMoment[];
}

/** One dated slice of a mosaic, and the rule that selects it. */
export interface EsriMoment {
  time: number;
  mosaicRule: string;
}

/**
 * The rule that draws a given moment, or undefined when none was offered.
 *
 * Undefined rather than a guess: a moment the query never described is one the
 * service was never told how to draw, and inventing a rule would paint some
 * other year without saying so.
 */
export function mosaicRuleForTime(service: EsriDataset, epochMs: number): string | undefined {
  return service.moments?.find((moment) => moment.time === epochMs)?.mosaicRule;
}

/** The dataset id the panel mints for a query's service. */
export function esriDatasetId(refId: string): string {
  return `grafana-${refId}-esri`;
}

/**
 * Whether an id is one this panel minted.
 *
 * What tells "mine, drop it when the query stops returning it" from a tileset
 * the user added by hand through kepler's own form, which must survive every
 * refresh.
 */
export function isPanelEsriId(id: string): boolean {
  return /^grafana-.+-esri$/.test(id);
}

/**
 * Turns the queries that name an Image Service into service descriptors.
 *
 * One descriptor per query, never one per row — the same rule the raster and
 * WMS paths follow. A query with many rows is describing one service at many
 * moments, which is a timeline rather than a stack of layers, so the service
 * and its rules come from the first row that names them.
 */
export function framesToEsri(frames: DataFrame[], overrides: Record<string, FieldRoleOverrides> = {}): EsriDataset[] {
  const datasets: EsriDataset[] = [];

  frames.forEach((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const roles = resolveRoles(detectFields(frame), overrides[refId]);
    if (!roles.esriUrl) {
      return;
    }

    const serviceUrl = firstText(frame, roles.esriUrl);
    if (!serviceUrl) {
      return;
    }

    const renderingRule = roles.esriRenderingRule ? firstText(frame, roles.esriRenderingRule) : '';
    const moments = readMoments(frame, roles.time, roles.esriMosaicRule);
    // The newest is what a map opens on, the same rule the raster and Zarr
    // paths follow; an undated query falls back to its first named rule.
    const opening = moments.length
      ? moments[moments.length - 1].mosaicRule
      : roles.esriMosaicRule
        ? firstText(frame, roles.esriMosaicRule)
        : '';

    datasets.push({
      id: esriDatasetId(refId),
      label: frame.name ?? `Query ${refId}`,
      serviceUrl,
      ...(opening ? { mosaicRule: opening } : {}),
      ...(renderingRule ? { renderingRule } : {}),
      ...(moments.length ? { moments } : {}),
    });
  });

  return datasets;
}

/**
 * The dated rows of a frame as moments, oldest first.
 *
 * Sorted here rather than trusted from the query: a row order is whatever the
 * SQL happened to produce, and "the newest moment" has to mean the newest one.
 */
function readMoments(frame: DataFrame, timeColumn?: string, ruleColumn?: string): EsriMoment[] {
  if (!timeColumn || !ruleColumn) {
    return [];
  }
  const times = frame.fields.find((field) => field.name === timeColumn);
  const rules = frame.fields.find((field) => field.name === ruleColumn);
  if (!times || !rules) {
    return [];
  }

  const moments: EsriMoment[] = [];
  for (let row = 0; row < frame.length; row += 1) {
    const time = Number(times.values[row]);
    const rule = rules.values[row];
    if (Number.isFinite(time) && typeof rule === 'string' && rule.trim()) {
      moments.push({ time, mosaicRule: rule.trim() });
    }
  }
  return moments.sort((a, b) => a.time - b.time);
}

/** The first non-blank value of a column, or empty when it has none. */
function firstText(frame: DataFrame, column: string): string {
  const field = frame.fields.find((candidate) => candidate.name === column);
  if (!field) {
    return '';
  }
  for (let row = 0; row < frame.length; row += 1) {
    const value = field.values[row];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}
