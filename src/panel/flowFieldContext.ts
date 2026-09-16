import type { CameraState, FlowFieldContext } from './flowFieldLayer';

/**
 * Deciding what a flow field layer should be told about the map, kept free of
 * kepler and React so it can be tested with plain objects — the shape
 * `timeSync.ts` and `windViewport.ts` already take.
 */

/** One flow field layer, as the adapter reads it out of the store. */
export interface FlowFieldLayerState {
  id: string;
  /** The height of the level this layer draws, in metres. */
  altitudeMeters: number;
  /** What the layer is currently carrying. */
  context?: FlowFieldContext;
  /** The animation window the layer has settled on, once it has traced. */
  domain?: [number, number] | null;
  /**
   * The kepler layer type this entry came from, when the caller knows it.
   *
   * Used only to decide whether `altitudeMeters` counts toward `tallest` —
   * see `isStackedLevel` below. Optional, and treated as a level when absent,
   * so every test written before the symbol layer existed — none of them set
   * this — keeps behaving exactly as it did: every layer counted.
   */
  type?: string;
}

/** A context to write, addressed to one layer. */
export interface FlowContextPatch {
  id: string;
  context: FlowFieldContext;
}

/**
 * The layer types that actually stack as vertical levels.
 *
 * Mirrors `FLOW_FIELD_TYPE` (`keplerAdapter.ts`) and `VECTOR_FIELD_TYPE`
 * (`vectorFieldLayer.ts`), duplicated here as plain strings rather than
 * imported: this module stays free of kepler and of the adapter, per the
 * file comment above, so it can go on being tested with plain objects.
 *
 * The symbol layer is deliberately absent from this set. It is handed the
 * same context as these two — the camera it cannot otherwise see — but it
 * has no `heightMeters` knob, no `elevationScale`, and never calls
 * `stackedAltitude`: it is not a level, and letting its altitude column into
 * `tallest` would rescale the flow/vector field stack for a layer that never
 * asked to be part of it.
 */
const STACKED_LEVEL_TYPES = new Set(['flowfield', 'vectorfield']);

/** Whether a layer's height should be weighed when picking the tallest level. */
function isStackedLevel(layer: FlowFieldLayerState): boolean {
  return layer.type === undefined || STACKED_LEVEL_TYPES.has(layer.type);
}

/**
 * The layers whose context is out of date, with the context they should carry.
 *
 * One context for all of them, and that is the point of computing it here: the
 * vertical exaggeration has to come from the tallest level on the map, so that
 * the levels keep their proportion to each other. A layer working it out from
 * its own height would draw every level at the same altitude. "On the map"
 * means the layers that stack — see `isStackedLevel` — not every layer this
 * function is handed a context for.
 *
 * Returning only what changed is what keeps this out of a dispatch loop: the
 * caller runs on every store notification, and writing the same context back
 * would notify it again.
 */
export function outdatedFlowContexts(
  layers: FlowFieldLayerState[],
  camera: CameraState | null,
  baseMs: number
): FlowContextPatch[] {
  if (layers.length === 0) {
    return [];
  }

  const context: FlowFieldContext = {
    camera: camera ?? undefined,
    baseMs,
    tallest: Math.max(0, ...layers.filter(isStackedLevel).map((layer) => layer.altitudeMeters)),
  };

  return layers.filter((layer) => !sameContext(layer.context, context)).map((layer) => ({ id: layer.id, context }));
}

/** Whether two contexts would trace the same streamlines. */
export function sameContext(a: FlowFieldContext | undefined, b: FlowFieldContext): boolean {
  if (!a) {
    return false;
  }
  return a.baseMs === b.baseMs && a.tallest === b.tallest && sameCameraState(a.camera, b.camera);
}

/**
 * Whether two cameras see the same thing.
 *
 * Pitch and bearing count, and that is not a detail: they were absent from the
 * comparison this replaces, so tilting or rotating the map did not even count
 * as a change of view — the field was never re-traced for the ground the camera
 * had just turned towards.
 */
function sameCameraState(a?: CameraState, b?: CameraState): boolean {
  if (!a || !b) {
    return a === b;
  }
  return (
    a.latitude === b.latitude &&
    a.longitude === b.longitude &&
    a.zoom === b.zoom &&
    a.pitch === b.pitch &&
    a.bearing === b.bearing &&
    a.width === b.width &&
    a.height === b.height
  );
}
