import { WebMercatorViewport } from '@deck.gl/core';
import { TripsLayer } from '@deck.gl/geo-layers';
import { PathLayer } from '@deck.gl/layers';

import type { CameraState } from './flowFieldLayer';
import type { ScreenCamera } from '../data/traceStreamlines';
import { holdOffFor, isRunning, tripsUniforms } from './flowFieldClock';

/**
 * The deck.gl layer that draws the traced streamlines.
 *
 * Thin by design: the paths already carry their own timestamps, so all that is
 * left is a trail running along them. Kept apart from `flowFieldLayer.ts` so
 * that module stays free of deck imports and can be tested without loading the
 * whole graph, the way `zarrDeckLayer.ts` is kept apart from `zarrTileLayer.ts`.
 */

/**
 * The camera, as something the tracer can seed through.
 *
 * deck's own viewport is the right tool and the only honest one: working out
 * which ground a screen pixel shows means the same projection matrix deck draws
 * with, pitch and bearing and all, and a hand-rolled version of it would be a
 * second answer to a question that must have exactly one.
 *
 * One thing deck will not tell you: whether the pixel showed any ground at all.
 * `unproject` intersects the ray through a pixel with the ground plane, and a
 * ray pointing above the horizon never meets it — so deck solves for the
 * intersection *behind* the camera and returns that, at a plausible-looking
 * latitude. Projecting it back does not catch this: measured at pitch 85, deck
 * returns the original pixel for points it placed four degrees the wrong way.
 *
 * It does not arise today, and that is the reason there is no guard: kepler
 * clamps the pitch at 60, and at 60 the horizon is still above the top of the
 * screen — measured, the topmost row of pixels lands four degrees up-range, on
 * the ground. Should that clamp ever be lifted, the symptom to look for is lines
 * seeded behind the viewer, which is to say a field that thickens where the
 * camera is not looking.
 */
export function makeScreenCamera(camera: CameraState): ScreenCamera | null {
  if (!camera.width || !camera.height) {
    return null;
  }

  const viewport = new WebMercatorViewport({
    latitude: camera.latitude,
    longitude: camera.longitude,
    zoom: camera.zoom,
    pitch: camera.pitch,
    bearing: camera.bearing,
    width: camera.width,
    height: camera.height,
  });

  const groundAt = (x: number, y: number): [number, number] | null => {
    const [lng, lat] = viewport.unproject([x, y]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 85) {
      return null;
    }
    return [lng, lat];
  };

  // Sampled over the screen rather than taken from `viewport.getBounds()`, which
  // reads the four corners only. That is the same answer for a flat map and a
  // poorer one for a tilted map, where the widest ground is along the far edge
  // rather than at a corner.
  const bounds = sampledBounds(groundAt, camera.width, camera.height);
  if (!bounds) {
    return null;
  }

  return {
    widthPx: camera.width,
    heightPx: camera.height,
    bounds,
    metresPerPixel: viewport.metersPerPixel,
    unproject: groundAt,
  };
}

/** The ground a screen shows, from the pixels of it that show any. */
function sampledBounds(
  groundAt: (x: number, y: number) => [number, number] | null,
  width: number,
  height: number
): { west: number; south: number; east: number; north: number } | null {
  const steps = 8;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let found = 0;

  for (let row = 0; row <= steps; row++) {
    for (let column = 0; column <= steps; column++) {
      const at = groundAt((column / steps) * width, (row / steps) * height);
      if (!at) {
        continue;
      }
      found++;
      west = Math.min(west, at[0]);
      east = Math.max(east, at[0]);
      south = Math.min(south, at[1]);
      north = Math.max(north, at[1]);
    }
  }

  return found > 1 ? { west, south, east, north } : null;
}

/** Whether this machine has been told to keep movement down. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * The trips layer, running on a clock of its own.
 *
 * What moves along a streamline is a trail, and its speed is not the wind's:
 * the tracer normalises the advection to a legible number of pixels per cycle.
 * Hanging that on the map's clock spent the one axis a dashboard has — the one
 * that should choose which hour of a forecast is drawn — on a phase that means
 * nothing, and cost a redux dispatch and a React render on every frame of it.
 *
 * So the phase is read here, off the browser's monotonic clock, and written
 * straight into the shader. The decisions are in `flowFieldClock.ts`, which is
 * free of deck and can be tested with plain numbers.
 *
 * `shaderInputs` is deck's own plumbing rather than a documented interface —
 * `TripsLayer.draw` writes the same block — so a deck upgrade is a reason to
 * check this still holds, as with `PictureIconLayer`.
 */
export class AnimatedTripsLayer extends TripsLayer<
  unknown,
  { cycleMs: number; trailMs: number; animate: boolean }
> {
  static layerName = 'AnimatedTripsLayer';

  /**
   * When the last frame was drawn, and how long the field stood still after it.
   *
   * Plain fields rather than deck's `state`: writing to that asks deck for an
   * update cycle, and this changes on every frame. deck builds a new layer
   * whenever the props change, so the pair resets then — one unpaced frame,
   * and the next one measures again.
   */
  private lastDrawAt?: number;
  private lastHoldOff = 0;

  /**
   * How long to stand still before asking for the next frame — see
   * `holdOffFor`. Reads the clock as an argument so it can be exercised without
   * waiting in real time.
   */
  nextFrameDelay(nowMs: number): number {
    const previous = this.lastDrawAt;
    this.lastDrawAt = nowMs;
    if (previous === undefined) {
      this.lastHoldOff = 0;
      return 0;
    }
    // What the drawing cost: the whole interval, less the pause this layer
    // itself asked for. Counting the pause as work would feed on itself and
    // walk the field to a standstill.
    this.lastHoldOff = holdOffFor(nowMs - previous - this.lastHoldOff);
    return this.lastHoldOff;
  }

  /**
   * Tells the shader where the trail is, and answers whether it is moving.
   *
   * Separate from `draw` so the decision can be exercised without deck's
   * lifecycle: what is left there is the plumbing, which the browser tests.
   */
  writeAnimationUniforms(): boolean {
    const props = this.props as unknown as { cycleMs?: number; trailMs?: number; animate?: boolean };
    // luma watches every canvas it draws into with an `IntersectionObserver` of
    // its own and keeps this flag, which starts as `true`. So a panel scrolled
    // out of the dashboard answers for itself, and a browser without the
    // observer leaves the field running rather than stopping it for good.
    const canvas = (this.context as { device?: { canvasContext?: { isVisible?: boolean } } })?.device?.canvasContext;

    const running = isRunning({
      animate: props.animate !== false,
      onScreen: canvas?.isVisible !== false,
      // The observer above says nothing about a tab nobody is looking at: it
      // reports where the canvas sits in the page, and that does not change
      // when the window goes behind another.
      pageHidden: typeof document !== 'undefined' && document.hidden === true,
      reducedMotion: prefersReducedMotion(),
    });

    const model = (this.state as { model?: { shaderInputs: { setProps(p: unknown): void } } }).model;
    model?.shaderInputs.setProps({
      trips: tripsUniforms({
        nowMs: performance.now(),
        cycleMs: props.cycleMs ?? 0,
        trailMs: props.trailMs ?? 0,
        running,
      }),
    });

    return running;
  }

  draw(params: unknown): void {
    // Before the model exists there is nothing to write to, and `PathLayer.draw`
    // reads it. Ask for another frame and come back when there is.
    if (!(this.state as { model?: unknown }).model) {
      this.setNeedsRedraw();
      return;
    }

    const running = this.writeAnimationUniforms();
    // `PathLayer`'s draw rather than `TripsLayer`'s: the latter would overwrite
    // the block just written with the props deck last rendered with.
    PathLayer.prototype.draw.call(this as never, params as never);
    if (!running) {
      return;
    }

    const delay = this.nextFrameDelay(performance.now());
    if (delay > 0) {
      setTimeout(() => this.setNeedsRedraw(), delay);
    } else {
      this.setNeedsRedraw();
    }
  }
}

/** Builds the trips layer, in the shape `makeFlowFieldLayer` asks for. */
export const buildFlowFieldDeckLayer = (props: Record<string, unknown>): unknown =>
  new AnimatedTripsLayer({
    getPath: (line: { path: number[][] }) => line.path,
    // The fourth value of each vertex. deck reads a position as its first three
    // components and ignores the rest, so the timestamps ride along inside the
    // path rather than in a second array.
    getTimestamps: (line: { path: number[][] }) => line.path.map((vertex) => vertex[3]),
    // Pixels rather than metres: the whole visualisation is sized to the screen
    // — a fixed number of lines per screen, each a fixed number of pixels long —
    // and a width in metres would thicken as the user zooms in until the field
    // read as a solid sheet.
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
    // No `currentTime`, `trailLength` or `fadeTrail`: the layer above writes all
    // three into the shader on every frame, from its own clock.
    ...props,
  } as never);
