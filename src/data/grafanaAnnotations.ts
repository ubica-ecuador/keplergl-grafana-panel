import type { DataFrame } from '@grafana/data';

import { wrapLongitude } from './longitude';

/**
 * Grafana annotations ↔ kepler's own map annotations.
 *
 * A Grafana annotation is a note in time (time, timeEnd, text, tags) that every
 * time chart of the dashboard draws as a line or a band. kepler's annotation is
 * a note in place (a callout with an anchor point, a text and a shape) with no
 * time. An annotation that carries a place is both: the map draws it as a
 * kepler callout while its time overlaps the map's window, and a callout made
 * on the map becomes a Grafana annotation that the charts draw.
 *
 * The place travels in a tag, `geo:<lng>,<lat>`, GeoJSON order. A tag is the
 * one field every annotation source keeps: the built-in store, a DuckDB or
 * Infinity annotation query (a `tags` column), and the HTTP API. The full
 * callout (kind, arm, angle, rich text) travels in the annotation's `data`
 * when the source keeps it; without it the callout is a plain point.
 */

/** kepler annotation ids the panel owns: one per Grafana annotation. */
export const GRAFANA_ANNOTATION_PREFIX = 'grafana-';

/** The tag a map note carries, besides its place, so it can be found again. */
export const MAP_NOTE_TAG = 'map';

// lng and lat apart by a comma, a semicolon or a space: a query that hands its
// tags as one string may see Grafana split it on commas.
const GEO_TAG = /^geo:\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/i;
const GEO_HALF = /^geo:\s*-?\d+(?:\.\d+)?$/i;
const NUMBER = /^\s*-?\d+(?:\.\d+)?\s*$/;

/** A Grafana annotation that has a place. */
export interface GeoAnnotation {
  /** Grafana's id; annotations from a query without ids get one from their content. */
  id: string;
  time: number;
  timeEnd: number;
  text: string;
  tags: string[];
  color?: string;
  lng: number;
  lat: number;
  /** The kepler callout saved with it, when the source kept `data`. */
  shape?: Record<string, unknown>;
}

/** The subset of a kepler annotation this module reads and writes. */
export interface KeplerAnnotationLike {
  id: string;
  kind?: string;
  label?: string;
  anchorPoint?: number[];
  isVisible?: boolean;
  lineColor?: string;
  [key: string]: unknown;
}

/** `[lng, lat]` from a `geo:lng,lat` tag, or null. */
export function placeFromTags(tags: readonly string[]): [number, number] | null {
  for (const tag of joinSplitGeo(tags)) {
    const m = GEO_TAG.exec(tag);
    if (m) {
      const lng = Number(m[1]);
      const lat = Number(m[2]);
      if (Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
        return [lng, lat];
      }
    }
  }
  return null;
}

/** `geo:-78.5` and `-0.2` back into the one tag a comma split apart. */
function joinSplitGeo(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tags.length; i++) {
    if (GEO_HALF.test(tags[i]) && i + 1 < tags.length && NUMBER.test(tags[i + 1])) {
      out.push(`${tags[i]},${tags[i + 1].trim()}`);
      i++;
    } else {
      out.push(tags[i]);
    }
  }
  return out;
}

/**
 * The tag that carries a place, rounded to about a metre. The longitude within
 * ±180°: a callout made or dragged on a copy of the world past the antimeridian
 * has kepler's longitude for that copy, 190° for -170°.
 */
export function geoTag(lng: number, lat: number): string {
  return `geo:${round(wrapLongitude(lng))},${round(lat)}`;
}

function round(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}

function asTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    // A query's tags column may be a comma-separated string; a geo tag has a
    // comma of its own, so split only where the next piece starts a new tag.
    return value.split(/,(?=\s*[^\d\s.-])/).map((t) => t.trim());
  }
  return [];
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value.startsWith('{')) {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Grafana keeps some text as HTML; a callout shows plain text. */
export function plainText(text: unknown): string {
  return String(text ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/**
 * The annotations of the panel's data that have a place.
 *
 * Reads the frames by field name, so it takes the built-in annotations and an
 * annotation query alike. A place comes from, in order: the callout in `data`,
 * a `geo:` tag, or `longitude`/`latitude` fields. Annotations without one are
 * left out: they stay on the charts.
 */
export function readGeoAnnotations(frames: readonly DataFrame[] | undefined): GeoAnnotation[] {
  const out: GeoAnnotation[] = [];
  const seen = new Set<string>();
  for (const frame of frames ?? []) {
    const byName = new Map(frame.fields.map((f) => [f.name, f]));
    const value = (name: string, i: number): unknown => byName.get(name)?.values[i];
    for (let i = 0; i < frame.length; i++) {
      const time = Number(value('time', i));
      if (!Number.isFinite(time)) {
        continue;
      }
      const end = Number(value('timeEnd', i));
      const tags = joinSplitGeo(asTags(value('tags', i)));
      const data = asObject(value('data', i));
      const shape = asObject(data?.kepler);
      let place: [number, number] | null = null;
      const anchor = shape?.anchorPoint;
      if (Array.isArray(anchor) && anchor.length >= 2 && anchor.every((n) => Number.isFinite(n))) {
        place = [Number(anchor[0]), Number(anchor[1])];
      }
      place = place ?? placeFromTags(tags);
      if (!place) {
        const lng = Number(value('longitude', i) ?? value('lon', i) ?? value('lng', i));
        const lat = Number(value('latitude', i) ?? value('lat', i));
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          place = [lng, lat];
        }
      }
      if (!place) {
        continue;
      }
      const text = plainText(value('text', i) ?? value('title', i));
      const rawId = value('id', i);
      const id = rawId !== undefined && rawId !== null && rawId !== '' ? String(rawId) : contentId(time, place, text);
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const color = value('color', i);
      out.push({
        id,
        time,
        timeEnd: Number.isFinite(end) && end > time ? end : time,
        text,
        tags,
        color: typeof color === 'string' && color !== '' ? color : undefined,
        lng: place[0],
        lat: place[1],
        shape,
      });
    }
  }
  return out;
}

/** A stable id for an annotation that came without one. */
function contentId(time: number, place: [number, number], text: string): string {
  let h = 0;
  for (const ch of `${time}|${place.join(',')}|${text}`) {
    h = (h * 31 + ch.charCodeAt(0)) | 0;
  }
  return `q${(h >>> 0).toString(36)}`;
}

/** Whether an annotation's time touches the window; a null window shows all. */
export function overlapsWindow(a: Pick<GeoAnnotation, 'time' | 'timeEnd'>, window: [number, number] | null): boolean {
  return window === null || (a.timeEnd >= window[0] && a.time <= window[1]);
}

/** Grafana's named colours are not CSS; a callout line takes a hex. */
function hexColor(color: string | undefined): string | undefined {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : undefined;
}

/** The kepler callout that draws a Grafana annotation. */
export function toKeplerAnnotation(a: GeoAnnotation, visible: boolean): KeplerAnnotationLike {
  const shape = a.shape ?? {};
  const color = hexColor(a.color);
  return {
    ...shape,
    id: `${GRAFANA_ANNOTATION_PREFIX}${a.id}`,
    kind: typeof shape.kind === 'string' ? shape.kind : 'POINT',
    anchorPoint: [a.lng, a.lat],
    label: a.text || ' ',
    // The text is Grafana's: a rich text saved with the callout would show
    // the old words after the annotation was edited in Grafana.
    editorState: shape.label === a.text ? shape.editorState : undefined,
    ...(color ? { lineColor: color } : {}),
    isVisible: visible,
  };
}

/** Whether a kepler annotation id is one the panel drew from Grafana. */
export function isGrafanaBacked(id: string): boolean {
  return id.startsWith(GRAFANA_ANNOTATION_PREFIX);
}

/** The Grafana id behind one of those kepler ids. */
export function grafanaIdOf(keplerId: string): string {
  return keplerId.slice(GRAFANA_ANNOTATION_PREFIX.length);
}

/** The callout as saved in an annotation's `data`: everything but what Grafana already holds. */
export function shapeOf(note: KeplerAnnotationLike): Record<string, unknown> {
  const { id: _id, isVisible: _visible, mapIndex: _mapIndex, ...shape } = note;
  return shape;
}

/** What a callout changed on the map writes to Grafana. */
export interface AnnotationWrite {
  text: string;
  tags: string[];
  data: { kepler: Record<string, unknown> };
}

/**
 * The body for a callout made or moved on the map. Keeps the tags the
 * annotation had, swapping only the place; a new one is tagged `map`.
 */
export function annotationWrite(
  note: KeplerAnnotationLike,
  previousTags: readonly string[] = [MAP_NOTE_TAG]
): AnnotationWrite {
  const [lng, lat, ...rest] = note.anchorPoint ?? [0, 0];
  const tags = joinSplitGeo(previousTags).filter((t) => !GEO_TAG.test(t));
  const shape = shapeOf(note);
  return {
    text: plainText(note.label),
    tags: [...tags, geoTag(lng, lat)],
    // The callout's own anchor within ±180° too, so the place saved twice is one place.
    data: { kepler: note.anchorPoint ? { ...shape, anchorPoint: [wrapLongitude(lng), lat, ...rest] } : shape },
  };
}

/**
 * What a user edit can change — place, shape, words and style alike (kepler's
 * list edits colour, line and text placement) — and so what decides whether a
 * write is due. The rich text is left out: the label carries its words.
 */
export function noteFingerprint(note: KeplerAnnotationLike): string {
  const { editorState: _editorState, ...shape } = shapeOf(note);
  return JSON.stringify(
    Object.keys(shape)
      .sort()
      .map((k) => [k, shape[k]])
  );
}
