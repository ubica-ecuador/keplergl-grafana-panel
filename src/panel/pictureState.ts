import { PictureProblem } from './pictureKeys';
import { GenerationRecord, nextGeneration, PictureFailure } from './pictureRows';

/**
 * What each symbol layer's pictures are doing, for the layer panel to show.
 *
 * Module state, because the three things that learn about a picture share
 * nothing else: `renderLayer` knows which pictures a layer draws, the fetch
 * knows how loading went, and the panel is a React tree of its own. Nothing
 * here dispatches to kepler.
 */

export type PictureLoad = 'loading' | 'loaded' | PictureProblem;

/** Immutable: a change is a new object, which is what `useSyncExternalStore` compares. */
export interface PictureStatus {
  /** Every picture the layer draws or failed to, by URL, in first-seen order. */
  loads: ReadonlyMap<string, PictureLoad>;
  overflow: number;
}

export const MAX_TRACKED_LAYERS = 64;

const statuses = new Map<string, PictureStatus>();
const generations = new Map<string, GenerationRecord>();
const listeners = new Set<() => void>();
const warned = new Set<string>();
let scheduled = false;

const EMPTY: PictureStatus = { loads: new Map(), overflow: 0 };

/** Least recently written first out, so a dashboard of many panels cannot grow this forever. */
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_TRACKED_LAYERS) {
    map.delete(map.keys().next().value as string);
  }
}

/**
 * Listeners hear of a change in a microtask, never inside the write.
 *
 * `renderLayer` writes here, and kepler calls it while React renders the map:
 * telling a `useSyncExternalStore` subscriber right then would update one
 * component during another's render.
 */
function schedule(): void {
  if (scheduled) {
    return;
  }
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const listener of [...listeners]) {
      listener();
    }
  });
}

function isProblem(load: PictureLoad): load is PictureProblem {
  return load !== 'loading' && load !== 'loaded';
}

function warnOnce(url: string, load: PictureLoad): void {
  const note = `${load} ${url}`;
  if (!isProblem(load) || warned.has(note)) {
    return;
  }
  if (warned.size > 512) {
    warned.clear();
  }
  warned.add(note);
  const shown = url.length > 80 ? `${url.slice(0, 77)}…` : url;
  console.warn(`[kepler panel] symbol picture not drawn (${load}): ${shown}`);
}

function write(layerId: string, next: PictureStatus): void {
  remember(statuses, layerId, next);
  schedule();
}

export function readPictureStatus(layerId: string): PictureStatus | undefined {
  return statuses.get(layerId);
}

export function subscribePictureStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The pictures a layer draws now. Called on every render, so it writes only
 * when something differs: a picture already loaded stays loaded, and a picture
 * no longer drawn is forgotten.
 */
export function recordPictureAssignment(
  layerId: string,
  assignment: { urls: string[]; failures: PictureFailure[]; overflow: number }
): void {
  const previous = statuses.get(layerId) ?? EMPTY;
  const loads = new Map<string, PictureLoad>();
  for (const url of assignment.urls) {
    loads.set(url, previous.loads.get(url) ?? 'loading');
  }
  for (const { url, problem } of assignment.failures) {
    loads.set(url, problem);
  }

  const same =
    statuses.has(layerId) &&
    previous.overflow === assignment.overflow &&
    previous.loads.size === loads.size &&
    [...loads].every(([url, load]) => previous.loads.get(url) === load);
  if (same) {
    return;
  }
  for (const [url, load] of loads) {
    warnOnce(url, load);
  }
  write(layerId, { loads, overflow: assignment.overflow });
}

/** How one picture's load went. News of a picture the layer no longer draws is dropped. */
export function recordPictureLoad(layerId: string, url: string, load: PictureLoad): void {
  const previous = statuses.get(layerId);
  if (!previous || !previous.loads.has(url) || previous.loads.get(url) === load) {
    return;
  }
  warnOnce(url, load);
  write(layerId, { ...previous, loads: new Map(previous.loads).set(url, load) });
}

/** The generation of the layer's deck icon layer after drawing these keys; see `nextGeneration`. */
export function generationFor(layerId: string, keys: string[]): number {
  const next = nextGeneration(generations.get(layerId), keys);
  remember(generations, layerId, next);
  return next.generation;
}

export interface PictureSummary {
  total: number;
  loading: number;
  failed: PictureFailure[];
  overflow: number;
}

export function summarisePictureStatus(status: PictureStatus | undefined): PictureSummary {
  const failed: PictureFailure[] = [];
  let loading = 0;
  for (const [url, load] of status?.loads ?? []) {
    if (load === 'loading') {
      loading++;
    } else if (isProblem(load)) {
      failed.push({ url, problem: load });
    }
  }
  return { total: status?.loads.size ?? 0, loading, failed, overflow: status?.overflow ?? 0 };
}

export function resetPictureStateForTests(): void {
  statuses.clear();
  generations.clear();
  listeners.clear();
  warned.clear();
  scheduled = false;
}
