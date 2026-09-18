/**
 * The clock the streamlines run on.
 *
 * Their own, and not the map's. What moves along a streamline is a trail, and
 * how fast it moves says nothing about the wind: the tracer normalises the
 * advection to a legible number of pixels per cycle, so a cycle of sixty
 * seconds is sixty seconds of animation and no amount of weather. Hanging that
 * on kepler's clock spent the one axis a dashboard has — the one that should
 * choose *which hour* of a forecast is drawn — on a phase that means nothing,
 * and left a paused map blank, since at the start of the window every trail has
 * zero length.
 *
 * So the phase is read off the browser's own monotonic clock inside the deck
 * layer, where it costs no dispatch and no React render, and the map's clock is
 * free for the data. Pure on purpose: everything here is arithmetic over a
 * number of milliseconds, so the decisions can be tested without a canvas.
 */

/**
 * A frame cheap enough that pacing it would only cost smoothness.
 *
 * A little over two frames of a 60 Hz display, not one. What the layer measures
 * is the interval between two draws, and with vsync that interval *is* the
 * display's frame — 16.7 ms, however little the drawing cost. A threshold of 16
 * read every one of those as expensive, paid it back with a pause that missed
 * the next vsync, and ran a 60 Hz display at 30 fps. Two frames rather than one
 * and a bit, so a browser that caps itself at 30 fps (Chrome's energy saver
 * does) is not halved again to 15 by the same mistake; and a little over two,
 * because a two-frame interval read off the clock lands either side of 33.3 ms
 * by a millisecond or so. A renderer in software, the case the pacing exists
 * for, takes hundreds of milliseconds a frame and is far past this either way.
 */
const CHEAP_FRAME_MS = 36;

/** The longest the field is ever left standing between frames. */
const MAX_HOLD_OFF_MS = 500;

/**
 * How long to wait before asking for the next frame, in ms.
 *
 * The field would otherwise ask for another frame the instant the last one
 * lands, which on a machine with a GPU is free — the browser paces it — and on
 * one without is not: the whole page is drawn on the main thread there, so a
 * field of nine thousand streamlines takes it and never gives it back. Measured
 * on a map rendered in software: reading the map's state timed out at thirty
 * seconds, and a click on a switch in the layer panel never arrived.
 *
 * So an expensive frame buys an equal pause: at most half the time is spent
 * drawing the field, and the other half belongs to whoever else wants it. Chrome
 * falls back to software rendering in virtual machines, over remote desktops and
 * on some kiosks, which is exactly where a dashboard is left running for days.
 */
export function holdOffFor(lastFrameCostMs: number): number {
  if (!(lastFrameCostMs > CHEAP_FRAME_MS)) {
    return 0;
  }
  return Math.min(lastFrameCostMs, MAX_HOLD_OFF_MS);
}

/**
 * Whether the field should be moving at all.
 *
 * A running field asks deck for another frame for ever, which is the honest
 * cost of an animation nobody has to press play on — and the reason the three
 * vetoes exist. Two of them are about waste: a panel scrolled out of the
 * dashboard and a tab in the background repaint the whole map, every layer
 * under this one included, for nobody. The third is not about waste at all:
 * a person who has asked their system for less motion has asked this too.
 */
export function isRunning(state: {
  animate: boolean;
  onScreen: boolean;
  pageHidden: boolean;
  reducedMotion: boolean;
}): boolean {
  return state.animate && state.onScreen && !state.pageHidden && !state.reducedMotion;
}

/**
 * How often a field stopped for being out of sight looks to see whether it is
 * back, in ms. A quarter of a second is too soon for anyone scrolling back to
 * see it catch up, and a check is two property reads.
 */
export const RETURN_CHECK_MS = 250;

/**
 * Whether a stopped field has to keep looking for its own way back.
 *
 * Only when it stopped for being out of sight — a panel scrolled away, a tab
 * in the background — and not when it was told to stand still. A stopped field
 * asks deck for no more frames, and nothing in deck, luma or kepler asks again
 * when the canvas comes back into view: luma flips its visibility flag and
 * leaves it there. Without looking, a panel scrolled away and back stayed a
 * still picture for good. A field switched to a still one, or on a machine set
 * to reduce motion, has nothing to come back to and is left alone.
 */
export function waitsToBeSeen(state: Parameters<typeof isRunning>[0]): boolean {
  return state.animate && !state.reducedMotion && (!state.onScreen || state.pageHidden);
}

/** What deck's trips shader is told to draw. */
export interface TripsUniforms {
  /** Where the playhead is, in the same milliseconds the vertices carry. */
  currentTime: number;
  /** How far behind the playhead a vertex still draws, in ms. */
  trailLength: number;
  fadeTrail: boolean;
}

/** The clock reading and the knobs, as the shader needs them. */
export function tripsUniforms(options: {
  nowMs: number;
  cycleMs: number;
  trailMs: number;
  running: boolean;
}): TripsUniforms {
  if (!options.running) {
    // Past the last vertex, with a trail long enough to reach the first. The
    // vertex times span one cycle either side of the window — a line born late
    // runs past its end, and the seamless loop draws a copy of it a cycle
    // earlier — so a playhead at twice the cycle with a trail of four times it
    // covers all of them, whatever their birth.
    return {
      currentTime: 2 * options.cycleMs,
      trailLength: 4 * options.cycleMs,
      fadeTrail: false,
    };
  }

  return {
    currentTime: phaseAt(options.nowMs, options.cycleMs),
    trailLength: options.trailMs,
    fadeTrail: true,
  };
}

/** Where in the cycle a monotonic clock reading falls, in ms. */
export function phaseAt(nowMs: number, cycleMs: number): number {
  if (!(cycleMs > 0)) {
    return 0;
  }
  return ((nowMs % cycleMs) + cycleMs) % cycleMs;
}
