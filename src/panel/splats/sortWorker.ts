/**
 * Sorting splats off the main thread.
 *
 * A scan of a million splats takes tens of milliseconds to sort, every time the
 * camera has moved far enough (`needsResort`): enough to make the map stutter
 * while it is dragged. Large sets are sorted in a Web Worker instead, one
 * shared by every layer: each layer hands it its positions once, then only the
 * eye; the order comes back as a transferred buffer, and the layer draws with
 * the order it has until then.
 *
 * The worker is a Blob of plain JavaScript, the same counting sort as
 * `backToFront` (`splatOrder.ts`), so it needs nothing from the bundler. Where
 * a page may not start one (a Content Security Policy without `blob:` workers),
 * `sortWorker()` answers null and the layers sort on the main thread as before.
 */

/** Splats from which a layer sorts in the worker; below, the main thread is quicker than the round trip. */
export const WORKER_SORT_THRESHOLD = 100_000;

/**
 * The worker's code. Messages in: `{ type: 'init', id, positions }`,
 * `{ type: 'sort', id, eye, generation }`, `{ type: 'drop', id }`; out:
 * `{ id, generation, eye, order }`, `order` a Float32Array of splat indices,
 * farthest from the eye first.
 */
export const SORT_WORKER_SOURCE = `
'use strict';
var BUCKETS = 65536;
var sets = new Map();
function backToFront(positions, eye) {
  var count = positions.length / 3;
  var order = new Float32Array(count);
  if (count === 0) {
    return order;
  }
  var distances = new Float32Array(count);
  var near = Infinity;
  var far = -Infinity;
  var ex = eye[0], ey = eye[1], ez = eye[2];
  for (var i = 0; i < count; i++) {
    var dx = positions[i * 3] - ex;
    var dy = positions[i * 3 + 1] - ey;
    var dz = positions[i * 3 + 2] - ez;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    distances[i] = d;
    if (d < near) { near = d; }
    if (d > far) { far = d; }
  }
  var scale = far > near ? (BUCKETS - 1) / (far - near) : 0;
  var keys = new Uint16Array(count);
  var counts = new Uint32Array(BUCKETS);
  for (var j = 0; j < count; j++) {
    var key = (BUCKETS - 1 - (distances[j] - near) * scale) | 0;
    keys[j] = key;
    counts[key]++;
  }
  var start = 0;
  for (var k = 0; k < BUCKETS; k++) {
    var n = counts[k];
    counts[k] = start;
    start += n;
  }
  for (var m = 0; m < count; m++) {
    order[counts[keys[m]]++] = m;
  }
  return order;
}
self.onmessage = function (event) {
  var message = event.data || {};
  if (message.type === 'init') {
    sets.set(message.id, message.positions);
  } else if (message.type === 'drop') {
    sets.delete(message.id);
  } else if (message.type === 'sort') {
    var positions = sets.get(message.id);
    if (!positions) {
      return;
    }
    var order = backToFront(positions, message.eye);
    self.postMessage({ id: message.id, generation: message.generation, eye: message.eye, order: order }, [order.buffer]);
  }
};
`;

/** What a layer is told when its order is ready. */
export type SortedListener = (order: Float32Array, eye: [number, number, number], generation: number) => void;

/** The shared worker and the layers waiting on it. */
interface SortWorker {
  worker: Worker;
  listeners: Map<number, SortedListener>;
}

let shared: SortWorker | null | undefined;
let nextId = 1;

/** The page's sorting worker, started on first use; null where none can be. */
export function sortWorker(): SortWorker | null {
  if (shared !== undefined) {
    return shared;
  }
  shared = null;
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') {
      return null;
    }
    const url = URL.createObjectURL(new Blob([SORT_WORKER_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const listeners = new Map<number, SortedListener>();
    worker.onmessage = (event: MessageEvent) => {
      const { id, order, eye, generation } = (event.data ?? {}) as {
        id: number;
        order: Float32Array;
        eye: [number, number, number];
        generation: number;
      };
      listeners.get(id)?.(order, eye, generation);
    };
    worker.onerror = () => {
      // A worker that fails stays failed: the layers go back to sorting themselves.
      shared = null;
    };
    shared = { worker, listeners };
  } catch {
    shared = null;
  }
  return shared;
}

/**
 * One layer's splats in the worker: `sort(eye)` asks for an order, `drop()`
 * forgets them. Null where there is no worker.
 */
export interface WorkerSorter {
  sort(eye: [number, number, number], generation: number): void;
  drop(): void;
}

export function workerSorter(positions: Float32Array, onSorted: SortedListener): WorkerSorter | null {
  const pool = sortWorker();
  if (!pool) {
    return null;
  }
  const id = nextId++;
  pool.listeners.set(id, onSorted);
  // A copy, handed over: the layer keeps its own for the eye and the ground.
  const copy = positions.slice();
  pool.worker.postMessage({ type: 'init', id, positions: copy }, [copy.buffer]);
  return {
    sort: (eye, generation) => pool.worker.postMessage({ type: 'sort', id, eye, generation }),
    drop: () => {
      pool.listeners.delete(id);
      pool.worker.postMessage({ type: 'drop', id });
    },
  };
}
