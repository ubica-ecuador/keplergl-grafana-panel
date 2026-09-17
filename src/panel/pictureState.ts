import { PictureProblem } from './pictureKeys';
import { PictureFailure } from './pictureRows';

/**
 * What became of the symbol pictures, for the layer panel to show.
 *
 * Module state, because the three things that learn about a picture share
 * nothing else: `renderLayer` knows which pictures a layer draws, the fetch
 * knows how loading went, and the panel is a React tree of its own. Nothing
 * here dispatches to kepler.
 *
 * Nothing is kept by kepler layer id. Grafana's repeated panels and a
 * duplicated panel carry the same map config, so two panels on one dashboard
 * can hold layers with the same id drawing different pictures. How a picture
 * loaded is a fact about the picture, kept by its key for every panel; which
 * pictures a layer draws is kept against the layer object itself, which one
 * panel's map renders and the same panel's side panel is handed.
 */

export type PictureLoad = 'loading' | 'loaded' | PictureProblem;

/** What the panel reads of a layer's assignment; see `assignPictures`. */
export interface PictureAssignmentStatus {
  keys: string[];
  urls: string[];
  failures: PictureFailure[];
  moreFailures: number;
  overflow: number;
}

/** Outcomes kept, least recently written first out. A layer draws at most 96 pictures. */
export const MAX_PICTURE_OUTCOMES = 1024;

const outcomes = new Map<string, PictureLoad>();
let assignments = new WeakMap<object, PictureAssignmentStatus>();
const listeners = new Set<() => void>();
const warned = new Set<string>();
let version = 0;
let scheduled = false;

/**
 * Listeners hear of a change in a microtask, never inside the write.
 *
 * `renderLayer` writes here, and kepler calls it while React renders the map:
 * telling a `useSyncExternalStore` subscriber right then would update one
 * component during another's render.
 */
function changed(): void {
  version++;
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

function isProblem(load: PictureLoad | undefined): load is PictureProblem {
  return load !== undefined && load !== 'loading' && load !== 'loaded';
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

export function subscribePictures(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes on every write that changed something: the snapshot `useSyncExternalStore` compares. */
export function readPictureVersion(): number {
  return version;
}

/**
 * The pictures a kepler layer draws now. Called on every render with the
 * layer's memoised assignment, so a render that decided nothing new is a
 * single identity check.
 */
export function recordPictureAssignment(layer: object, assignment: PictureAssignmentStatus): void {
  if (assignments.get(layer) === assignment) {
    return;
  }
  assignments.set(layer, assignment);
  // Only the failures the assignment names: the rest are a count.
  for (const { url, problem } of assignment.failures) {
    warnOnce(url, problem);
  }
  changed();
}

export function readPictureAssignment(layer: object): PictureAssignmentStatus | undefined {
  return assignments.get(layer);
}

/** How loading the picture behind a key went, whichever panel asked for it. */
export function recordPictureOutcome(key: string, url: string, load: PictureLoad): void {
  const previous = outcomes.get(key);
  // Re-inserted even when unchanged, so a picture still being asked for is
  // not the first one evicted.
  outcomes.delete(key);
  outcomes.set(key, load);
  if (outcomes.size > MAX_PICTURE_OUTCOMES) {
    outcomes.delete(outcomes.keys().next().value as string);
  }
  if (previous === load) {
    return;
  }
  warnOnce(url, load);
  changed();
}

export function readPictureOutcomes(): ReadonlyMap<string, PictureLoad> {
  return outcomes;
}

export interface PictureSummary {
  total: number;
  loading: number;
  failed: PictureFailure[];
  /** Failures beyond those in `failed`, counted but not named. */
  moreFailed: number;
  overflow: number;
}

/**
 * A layer's pictures as its panel reports them. A picture with no outcome yet
 * counts as loading: deck asks for it after the render that assigned it.
 */
export function summarisePictures(
  assignment: PictureAssignmentStatus | undefined,
  known: ReadonlyMap<string, PictureLoad>
): PictureSummary {
  if (!assignment) {
    return { total: 0, loading: 0, failed: [], moreFailed: 0, overflow: 0 };
  }
  const failed: PictureFailure[] = [];
  let loading = 0;
  assignment.keys.forEach((key, i) => {
    const load = known.get(key) ?? 'loading';
    if (load === 'loading') {
      loading++;
    } else if (isProblem(load)) {
      failed.push({ url: assignment.urls[i], problem: load });
    }
  });
  failed.push(...assignment.failures);
  return {
    total: assignment.keys.length + assignment.failures.length + assignment.moreFailures,
    loading,
    failed,
    moreFailed: assignment.moreFailures,
    overflow: assignment.overflow,
  };
}

export function resetPictureStateForTests(): void {
  outcomes.clear();
  assignments = new WeakMap();
  listeners.clear();
  warned.clear();
  version = 0;
  scheduled = false;
}
