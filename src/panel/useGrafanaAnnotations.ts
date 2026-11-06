import { useEffect, useRef } from 'react';
import type { DataFrame } from '@grafana/data';
import { getBackendSrv, hasPermission } from '@grafana/runtime';
import {
  ActionTypes,
  addAnnotation,
  removeAnnotation,
  setSelectedAnnotation,
  updateAnnotation,
  wrapTo,
} from '@kepler.gl/actions';
import type { Store } from 'redux';

import {
  annotationWrite,
  grafanaIdOf,
  isGrafanaBacked,
  MAP_NOTE_TAG,
  noteFingerprint,
  overlapsWindow,
  readGeoAnnotations,
  toKeplerAnnotation,
  GRAFANA_ANNOTATION_PREFIX,
  type GeoAnnotation,
  type KeplerAnnotationLike,
} from '../data/grafanaAnnotations';
import { KEPLER_INSTANCE_ID } from './constants';
import { onKeplerAction } from './keplerStore';
import type { TimeRangeMs } from './timeSync';

export type AnnotationsMode = 'off' | 'show' | 'both';

interface Params {
  store: Store;
  isReady: boolean;
  /** `PanelData.annotations`: what the dashboard's annotation queries returned for this panel. */
  annotations: DataFrame[] | undefined;
  mode: AnnotationsMode;
  dashboardUid: string;
  /** The dashboard range: the time of a note made on a map with no time filter. */
  grafanaRange: TimeRangeMs;
  /** The panel's element: a click on the bare map inside it puts a note down. */
  element: HTMLElement | null;
}

interface AnnotationSlices {
  annotations: KeplerAnnotationLike[];
  selectedAnnotationId: string | null;
  isEditingAnnotationText: boolean;
  filters: Array<{ type?: string; value?: unknown; enabled?: boolean }>;
}

function readSlices(store: Store): AnnotationSlices | null {
  const state = store.getState() as { keplerGl?: Record<string, { visState?: Partial<AnnotationSlices> }> };
  const vis = state.keplerGl?.[KEPLER_INSTANCE_ID]?.visState;
  if (!vis) {
    return null;
  }
  return {
    annotations: (vis.annotations ?? []) as KeplerAnnotationLike[],
    selectedAnnotationId: vis.selectedAnnotationId ?? null,
    isEditingAnnotationText: Boolean(vis.isEditingAnnotationText),
    filters: (vis.filters ?? []) as AnnotationSlices['filters'],
  };
}

/** The map's own time window: its time filter's, when it has one. */
function mapWindow(filters: AnnotationSlices['filters']): [number, number] | null {
  const f = filters.find((x) => x.type === 'timeRange' && x.enabled !== false && Array.isArray(x.value));
  const v = f?.value as number[] | undefined;
  return v && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0], v[1]] : null;
}

/** What a click may land on without putting the selected note down. */
const NOTE_OR_CONTROL = [
  'svg',
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable]',
  '.editor-container',
  '.lexical-toolbar',
  '.link-editor',
  '.map-control',
  '.map-popover',
  '.side-panel--container',
  '.bottom-widget--container',
].join(', ');

function onNoteOrControl(target: Element): boolean {
  return Boolean(target.closest(NOTE_OR_CONTROL) || target.querySelector(':scope > .editor-container'));
}

/**
 * Grafana annotations on the map, and map notes into Grafana.
 *
 * In: every annotation of the panel's data that has a place (see
 * `readGeoAnnotations`) is drawn as a kepler callout with id `grafana-<id>`,
 * shown while its time overlaps the map's time filter window, or the dashboard
 * range when the map has no time filter.
 *
 * The dashboard is not refreshed after a write: the map shows the note already,
 * and the other panels draw it at their next refresh. Grafana re-runs its
 * annotation layer only from its own annotation editor (the panel context's
 * `onAnnotationCreate`, which ties the annotation to one panel, so it cannot
 * carry a note meant for every time chart) or from its refresh picker; a
 * `RefreshEvent` published by a panel re-runs nothing on a scenes dashboard,
 * Grafana 12 and 13 alike.
 *
 * Out (`mode: 'both'`, and only for a viewer allowed to create annotations): a
 * note made with kepler's right-click "Add Annotation" is written to Grafana
 * once its editing ends — the moment kepler deselects it — with the map's
 * window as its time span and its place as a `geo:` tag; editing or moving a
 * Grafana-backed note writes the change back. Notes are never deleted from
 * here: kepler swaps its annotations when a saved config is applied, and a
 * vanished callout must not read as a deletion.
 *
 * The Grafana-backed callouts are left out of the saved map config
 * (`captureMapConfig`), so a saved dashboard does not hold a stale copy.
 */
export function useGrafanaAnnotations({
  store,
  isReady,
  annotations,
  mode,
  dashboardUid,
  grafanaRange,
  element,
}: Params): void {
  const params = useRef({ annotations, mode, dashboardUid, grafanaRange });
  useEffect(() => {
    params.current = { annotations, mode, dashboardUid, grafanaRange };
  });

  /** keplerId → the Grafana annotation it draws, from the last reconcile. */
  const known = useRef(new Map<string, GeoAnnotation>());
  /** keplerId → fingerprint of the callout on the map as Grafana last had it. */
  const synced = useRef(new Map<string, string>());
  /** keplerId → fingerprint of what the panel's data said last time. */
  const seenFromGrafana = useRef(new Map<string, string>());
  /** Ids written from here that the panel's data has not brought back yet. */
  const pending = useRef(new Set<string>());
  /** The selection on the previous pass: its end is when a note is written. */
  const lastSelected = useRef<string | null>(null);
  /** Grafana-backed notes this hook takes off the map itself: not a user's delete. */
  const selfRemoving = useRef(new Set<string>());
  /**
   * Notes the user deleted from kepler's list. Kept off the map while the data
   * still carries them: until Grafana's delete lands and the dashboard
   * refreshes, or for the session when the annotation is not one this viewer
   * can delete (an annotation query's, or no permission).
   */
  const dismissed = useRef(new Set<string>());
  /** The note whose text was being edited on the previous pass. */
  const lastEditing = useRef<string | null>(null);
  const writing = useRef(new Set<string>());
  const scheduled = useRef(false);
  const lastSlices = useRef<AnnotationSlices | null>(null);

  const reconcile = useRef(() => {
    scheduled.current = false;
    const { mode } = params.current;
    const slices = readSlices(store);
    if (!slices || mode === 'off') {
      return;
    }
    const dispatch = store.dispatch;
    // The map's time filter window when it has one, else the dashboard range:
    // an annotation query may return more than the range (a feed of the week).
    const { grafanaRange } = params.current;
    const window: [number, number] = mapWindow(slices.filters) ?? [grafanaRange.from, grafanaRange.to];
    const wanted = new Map<string, GeoAnnotation>();
    for (const a of readGeoAnnotations(params.current.annotations)) {
      wanted.set(`${GRAFANA_ANNOTATION_PREFIX}${a.id}`, a);
    }
    const onMap = new Map(slices.annotations.map((n) => [n.id, n]));
    let added = false;

    for (const id of dismissed.current) {
      if (!wanted.has(id)) {
        dismissed.current.delete(id);
      }
    }
    for (const [id, a] of wanted) {
      pending.current.delete(id);
      if (dismissed.current.has(id)) {
        continue;
      }
      const visible = overlapsWindow(a, window);
      const note = onMap.get(id);
      const fromGrafana = noteFingerprint(toKeplerAnnotation(a, visible));
      const seen = seenFromGrafana.current.get(id);
      seenFromGrafana.current.set(id, fromGrafana);
      if (!note) {
        dispatch(wrapTo(KEPLER_INSTANCE_ID, addAnnotation(toKeplerAnnotation(a, visible) as never)));
        synced.current.delete(id);
        added = true;
      } else if (seen !== undefined && seen !== fromGrafana && slices.selectedAnnotationId !== id) {
        // Changed in Grafana since the last look, and nobody is editing it here.
        dispatch(wrapTo(KEPLER_INSTANCE_ID, updateAnnotation(id, toKeplerAnnotation(a, visible) as never)));
        synced.current.delete(id);
      } else if (Boolean(note.isVisible) !== visible) {
        dispatch(wrapTo(KEPLER_INSTANCE_ID, updateAnnotation(id, { isVisible: visible } as never)));
      }
    }
    // Gone from Grafana, or outside the dashboard range now: off the map. A
    // note written from here stays until the data brings it back.
    for (const note of slices.annotations) {
      if (isGrafanaBacked(note.id) && !wanted.has(note.id) && !pending.current.has(note.id)) {
        selfRemoving.current.add(note.id);
        dispatch(wrapTo(KEPLER_INSTANCE_ID, removeAnnotation(note.id)));
        synced.current.delete(note.id);
        seenFromGrafana.current.delete(note.id);
      }
    }
    known.current = wanted;
    // kepler selects what it adds and opens its text editor: give the user
    // back whatever they had selected, so a note they are writing stays theirs.
    if (added) {
      dispatch(
        wrapTo(KEPLER_INSTANCE_ID, setSelectedAnnotation(slices.selectedAnnotationId, slices.isEditingAnnotationText))
      );
    }
    // What Grafana holds is the callout as kepler stores it, defaults filled in:
    // taken from the store, so selecting and leaving a note writes nothing.
    for (const note of readSlices(store)?.annotations ?? []) {
      if (isGrafanaBacked(note.id) && !synced.current.has(note.id)) {
        synced.current.set(note.id, noteFingerprint(note));
      }
    }

    // Out: a note whose editing just ended. kepler ends it two ways: another
    // note (or none) is selected, or its text editor closes with the note still
    // selected — a click on the map does the second, not the first.
    const now = readSlices(store);
    const selected = now?.selectedAnnotationId ?? null;
    const editing = now?.isEditingAnnotationText && selected ? selected : null;
    const ended = new Set<string>();
    if (lastSelected.current && lastSelected.current !== selected) {
      ended.add(lastSelected.current);
    }
    if (lastEditing.current && lastEditing.current !== editing) {
      ended.add(lastEditing.current);
    }
    lastSelected.current = selected;
    lastEditing.current = editing;
    if (mode === 'both') {
      for (const id of ended) {
        const note = (now?.annotations ?? []).find((n) => n.id === id);
        if (note) {
          void write.current(note, window);
        }
      }
    }
  });

  const write = useRef(async (note: KeplerAnnotationLike, window: [number, number]) => {
    const { dashboardUid } = params.current;
    if (writing.current.has(note.id)) {
      return;
    }
    const dispatch = store.dispatch;
    if (isGrafanaBacked(note.id)) {
      // Only the annotations Grafana stores have an id to write to; one from an
      // annotation query (an id made from its content) is the query's to change.
      if (
        !/^\d+$/.test(grafanaIdOf(note.id)) ||
        synced.current.get(note.id) === noteFingerprint(note) ||
        !hasPermission('annotations:write')
      ) {
        return;
      }
      const previous = known.current.get(note.id);
      const body = annotationWrite(note, previous?.tags ?? [MAP_NOTE_TAG]);
      writing.current.add(note.id);
      try {
        await getBackendSrv().patch(`/api/annotations/${grafanaIdOf(note.id)}`, body, { showErrorAlert: false });
        synced.current.set(note.id, noteFingerprint(note));
      } catch (e) {
        console.warn('kepler panel: could not update the annotation', e);
      } finally {
        writing.current.delete(note.id);
      }
      return;
    }
    if (!dashboardUid || !hasPermission('annotations:create')) {
      return;
    }
    const [time, timeEnd] = window;
    writing.current.add(note.id);
    try {
      const res = await getBackendSrv().post<{ id: number }>(
        '/api/annotations',
        // No panelId: Grafana shows a panel's annotation on that panel only, and
        // the note is for every time chart of the dashboard.
        { dashboardUID: dashboardUid, time: Math.round(time), timeEnd: Math.round(timeEnd), ...annotationWrite(note) },
        { showErrorAlert: false }
      );
      // The same callout under the id that ties it to Grafana from now on.
      const id = `${GRAFANA_ANNOTATION_PREFIX}${res.id}`;
      pending.current.add(id);
      dispatch(wrapTo(KEPLER_INSTANCE_ID, removeAnnotation(note.id)));
      dispatch(wrapTo(KEPLER_INSTANCE_ID, addAnnotation({ ...note, id } as never)));
      dispatch(wrapTo(KEPLER_INSTANCE_ID, setSelectedAnnotation(null)));
      synced.current.set(id, noteFingerprint(note));
    } catch (e) {
      console.warn('kepler panel: could not save the map note as an annotation', e);
    } finally {
      writing.current.delete(note.id);
    }
  });

  const schedule = useRef(() => {
    if (!scheduled.current) {
      scheduled.current = true;
      queueMicrotask(() => reconcile.current());
    }
  });

  useEffect(() => {
    if (!isReady || mode === 'off') {
      return;
    }
    schedule.current();
    return store.subscribe(() => {
      const s = readSlices(store);
      const prev = lastSlices.current;
      lastSlices.current = s;
      if (
        s &&
        (!prev ||
          s.annotations !== prev.annotations ||
          s.selectedAnnotationId !== prev.selectedAnnotationId ||
          s.isEditingAnnotationText !== prev.isEditingAnnotationText ||
          s.filters !== prev.filters)
      ) {
        schedule.current();
      }
    });
  }, [store, isReady, mode]);

  useEffect(() => {
    if (isReady && mode !== 'off') {
      schedule.current();
    }
  }, [annotations, isReady, mode, grafanaRange.from, grafanaRange.to]);

  // Deleting a note in kepler's list: a Grafana-backed one is deleted in Grafana
  // too (mode 'both', a stored annotation, a viewer allowed to), or else only
  // dismissed for the session — never brought straight back by the next pass.
  // Heard as the action itself: a note vanishing from the state could as well be
  // kepler applying a config.
  useEffect(() => {
    if (!isReady || mode === 'off') {
      return;
    }
    return onKeplerAction(store, (action) => {
      if (action.type !== ActionTypes.REMOVE_ANNOTATION) {
        return;
      }
      const inner = (action.payload ?? action) as { id?: unknown };
      const id = typeof inner.id === 'string' ? inner.id : '';
      if (!isGrafanaBacked(id)) {
        return;
      }
      if (selfRemoving.current.delete(id)) {
        return;
      }
      dismissed.current.add(id);
      const grafanaId = grafanaIdOf(id);
      if (params.current.mode !== 'both' || !/^\d+$/.test(grafanaId) || !hasPermission('annotations:delete')) {
        return;
      }
      getBackendSrv()
        .delete(`/api/annotations/${grafanaId}`, undefined, { showErrorAlert: false })
        .catch((e: unknown) => {
          console.warn('kepler panel: could not delete the annotation', e);
          // Still in Grafana: back on the map at the next pass.
          dismissed.current.delete(id);
          schedule.current();
        });
    });
  }, [store, isReady, mode]);

  // kepler ends a note's editing only from its annotation list, which the panel
  // does not mount: a click on the bare map or Escape puts the note down, which
  // is also what writes it to Grafana. The bare map is anything but a note (its
  // marker and arm are SVG, its text an `.editor-container`), a menu or a
  // control: deck lays an event div over its canvas, so the target is no canvas.
  useEffect(() => {
    if (!element || !isReady || mode === 'off') {
      return;
    }
    const putDown = () => {
      if (readSlices(store)?.selectedAnnotationId) {
        store.dispatch(wrapTo(KEPLER_INSTANCE_ID, setSelectedAnnotation(null)));
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (e.button === 0 && target instanceof Element && !onNoteOrControl(target)) {
        putDown();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        putDown();
      }
    };
    element.addEventListener('pointerdown', onPointerDown, true);
    element.addEventListener('keydown', onKeyDown, true);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown, true);
      element.removeEventListener('keydown', onKeyDown, true);
    };
  }, [element, store, isReady, mode]);
}
