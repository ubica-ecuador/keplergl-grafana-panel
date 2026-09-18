import { AnimatedTripsLayer, buildFlowFieldDeckLayer, makeScreenCamera } from './flowFieldDeckLayer';

/**
 * Exercised against deck's real `WebMercatorViewport`, not a stub, because
 * everything worth asserting here is what deck's projection does with pitch —
 * and the two defects this covers were both misreadings of deck's own answers.
 */
const CAMERA = {
  latitude: -2.9,
  longitude: -79,
  zoom: 8,
  pitch: 0,
  bearing: 0,
  width: 1000,
  height: 600,
};

describe('makeScreenCamera', () => {
  it('reads the ground under a pixel', () => {
    const camera = makeScreenCamera(CAMERA)!;
    const centre = camera.unproject(500, 300)!;

    expect(centre[0]).toBeCloseTo(CAMERA.longitude, 1);
    expect(centre[1]).toBeCloseTo(CAMERA.latitude, 1);
  });

  it('reaches far further up-range once the camera is tilted', () => {
    // The report this exists for: tilted, the ground on screen is a trapezoid
    // reaching towards the horizon, and seeding the flat rectangle left the top
    // of the screen bare.
    const flat = makeScreenCamera(CAMERA)!;
    const tilted = makeScreenCamera({ ...CAMERA, pitch: 50 })!;

    const flatReach = flat.bounds.north - CAMERA.latitude;
    const tiltedReach = tilted.bounds.north - CAMERA.latitude;

    // Measured at 2.6× on this viewport. All of that beyond the flat rectangle
    // was ground the field was never seeded over.
    expect(tiltedReach).toBeGreaterThan(2 * flatReach);
  });

  it('points the ground it covers wherever the camera looks', () => {
    // The trapezoid leans towards the horizon, so its centre sits up-range of
    // the camera's own — northwards when facing north, eastwards when facing
    // east. Which is the whole of what a bearing does to the seeding area, and
    // none of it survived a comparison that never read the bearing.
    const north = makeScreenCamera({ ...CAMERA, pitch: 50, bearing: 0 })!;
    const east = makeScreenCamera({ ...CAMERA, pitch: 50, bearing: 90 })!;

    const middle = (b: { west: number; east: number; south: number; north: number }) => ({
      lng: (b.west + b.east) / 2,
      lat: (b.south + b.north) / 2,
    });

    expect(middle(north.bounds).lat).toBeGreaterThan(CAMERA.latitude);
    expect(middle(east.bounds).lng).toBeGreaterThan(CAMERA.longitude);
  });

  it('still shows ground at the top of the screen at the steepest pitch kepler allows', () => {
    // Which is why there is no horizon guard: at kepler's maximum pitch of 60
    // the sky is not on screen at all, so no pixel can unproject to the point
    // behind the camera deck would answer with. Past that clamp it could, and
    // deck gives no sign — projecting such a point back returns the very pixel
    // it came from.
    const steepest = makeScreenCamera({ ...CAMERA, pitch: 60 })!;
    const top = steepest.unproject(500, 1);

    expect(top).not.toBeNull();
    expect(top![1]).toBeGreaterThan(CAMERA.latitude);
  });

  it('has no camera to offer before the map has a size', () => {
    expect(makeScreenCamera({ ...CAMERA, width: 0 })).toBeNull();
  });

  it('measures the ground a pixel covers, which is what sets the step length', () => {
    const near = makeScreenCamera({ ...CAMERA, zoom: 12 })!;
    const far = makeScreenCamera({ ...CAMERA, zoom: 8 })!;

    expect(far.metresPerPixel / near.metresPerPixel).toBeCloseTo(16, 0);
  });
});

/**
 * Runs `body` on a machine that asks for less motion, and puts back the
 * answer it had before.
 *
 * Put back rather than deleted: the scaffolded jest setup defines
 * `matchMedia` as a property that cannot be deleted, so a `delete` left the
 * reduced-motion answer in place for every later test in the file — which
 * silently turned the tests after it into tests of a machine asking for less
 * motion.
 */
function withReducedMotion(body: () => void): void {
  const holder = window as unknown as { matchMedia: unknown };
  const original = holder.matchMedia;
  holder.matchMedia = () => ({ matches: true, media: '(prefers-reduced-motion: reduce)' });
  try {
    body();
  } finally {
    holder.matchMedia = original;
  }
}

/**
 * The animated layer, without deck's lifecycle.
 *
 * `draw` itself is four lines of plumbing into deck and is covered in the
 * browser; what is worth asserting here is the decision it delegates — what the
 * shader is told, and whether another frame is asked for.
 */
function animatedLayer(
  props: Record<string, unknown>,
  canvas: Record<string, unknown> = { isVisible: true },
  // deck hands a layer's state on to the instance that replaces it, so two
  // instances of one layer share this object — see "pile up" below.
  state: Record<string, unknown> = {}
) {
  const written: Array<Record<string, unknown>> = [];
  const layer = Object.create(AnimatedTripsLayer.prototype) as AnimatedTripsLayer;
  const redraws = jest.fn();

  Object.assign(state, {
    model: { shaderInputs: { setProps: (p: Record<string, unknown>) => written.push(p) }, destroy: () => undefined },
    ...state,
  });
  Object.assign(layer, {
    props: { cycleMs: 1000, trailMs: 40, animate: true, ...props },
    state,
    // luma keeps this flag per canvas, with its own IntersectionObserver.
    context: { device: { canvasContext: canvas }, resourceManager: { unsubscribe: () => undefined } },
    setNeedsRedraw: redraws,
  });

  return { layer, redraws, trips: () => written[written.length - 1]?.trips as Record<string, unknown> };
}

describe('AnimatedTripsLayer', () => {
  it('runs a fading trail on its own clock', () => {
    const { layer, trips } = animatedLayer({});

    expect(layer.writeAnimationUniforms()).toBe(true);
    expect(trips().fadeTrail).toBe(true);
    expect(trips().trailLength).toBe(40);
    expect(trips().currentTime as number).toBeGreaterThanOrEqual(0);
    expect(trips().currentTime as number).toBeLessThan(1000);
  });

  it('draws the streamlines whole, and asks for no more frames, when it is not animating', () => {
    // The knob a reader turns for a still picture of the field. The map used to
    // go blank instead, because a stopped playhead sits where trails are empty.
    const { layer, trips } = animatedLayer({ animate: false });

    expect(layer.writeAnimationUniforms()).toBe(false);
    expect(trips().fadeTrail).toBe(false);
  });

  it('stops while its panel is scrolled out of the dashboard', () => {
    // A dashboard is a column of panels and Grafana keeps the ones above and
    // below mounted. Left running, a map two screens up repaints the whole
    // scene — every layer under this one included — for nobody.
    const { layer } = animatedLayer({}, { isVisible: false });

    expect(layer.writeAnimationUniforms()).toBe(false);
  });

  it('stops while the tab is in the background', () => {
    const hidden = jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      expect(animatedLayer({}).layer.writeAnimationUniforms()).toBe(false);
    } finally {
      hidden.mockRestore();
    }
  });

  it('pays an expensive frame back with an equal pause', () => {
    // The clock inside the page is real time, so a paced frame loses no phase:
    // the field moves the same distance, in fewer steps.
    const { layer } = animatedLayer({});

    // Nothing drawn yet, so nothing to pay back.
    expect(layer.nextFrameDelay(1_000)).toBe(0);
    // That frame took 200 ms of somebody's main thread.
    expect(layer.nextFrameDelay(1_200)).toBe(200);
    // And the pause it bought is not drawing: 200 ms of pause and a 10 ms frame
    // is a cheap frame, not a 210 ms one. Without this the pause feeds itself
    // and the field slows to a stop.
    expect(layer.nextFrameDelay(1_410)).toBe(0);
  });

  it('runs at the display\'s own rate on a 60 Hz screen', () => {
    // With vsync the interval between draws is the display's frame, 16.7 ms,
    // whatever the drawing cost. Taken as the cost, it bought a pause on every
    // frame and the field ran at 30 fps.
    const { layer } = animatedLayer({});

    expect(layer.nextFrameDelay(1_000)).toBe(0);
    expect(layer.nextFrameDelay(1_016.7)).toBe(0);
    expect(layer.nextFrameDelay(1_033.4)).toBe(0);
  });

  it('stops when the system asks for less motion', () => {
    // Not thrift: a person who has told their machine that movement makes them
    // unwell has told this map too.
    withReducedMotion(() => {
      expect(animatedLayer({}).layer.writeAnimationUniforms()).toBe(false);
    });
  });
});

describe('AnimatedTripsLayer — coming back into view', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks for a frame again once its panel is scrolled back into view', () => {
    // A stopped field asks deck for no more frames, and nothing in deck, luma
    // or kepler asks again when the canvas comes back: luma flips its flag and
    // leaves it there. Without this a panel scrolled away and back stayed a
    // still picture for good.
    const canvas = { isVisible: false };
    const { layer, redraws } = animatedLayer({}, canvas);

    layer.requestNextFrame(false);
    jest.advanceTimersByTime(1_000);
    // Still out of sight: it keeps looking, and asks for nothing.
    expect(redraws).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);

    canvas.isVisible = true;
    jest.advanceTimersByTime(250);

    expect(redraws).toHaveBeenCalledTimes(1);
    // And stops looking: the frame it asked for runs the field again.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('asks for a frame again once its tab is brought back to the front', () => {
    const hidden = jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      const { layer, redraws } = animatedLayer({});

      layer.requestNextFrame(false);
      jest.advanceTimersByTime(500);
      expect(redraws).not.toHaveBeenCalled();

      hidden.mockReturnValue(false);
      jest.advanceTimersByTime(250);
      expect(redraws).toHaveBeenCalledTimes(1);
    } finally {
      hidden.mockRestore();
    }
  });

  it('never holds more than one look pending, whichever instance asks', () => {
    // deck builds a new instance of the layer whenever its props change and
    // hands it the old one's state; a panel out of sight still re-renders. One
    // pending look per instance would pile up a timer on every such render.
    const state = {};
    const first = animatedLayer({}, { isVisible: false }, state).layer;
    const second = animatedLayer({}, { isVisible: false }, state).layer;

    first.requestNextFrame(false);
    first.requestNextFrame(false);
    second.requestNextFrame(false);

    expect(jest.getTimerCount()).toBe(1);
  });

  it('does not look for its way back when it was switched to a still field', () => {
    animatedLayer({ animate: false }, { isVisible: false }).layer.requestNextFrame(false);

    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not look for its way back when the system asks for less motion', () => {
    withReducedMotion(() => {
      animatedLayer({}, { isVisible: false }).layer.requestNextFrame(false);

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('stops looking once deck has let go of the layer', () => {
    const { layer } = animatedLayer({}, { isVisible: false });

    layer.requestNextFrame(false);
    layer.finalizeState(layer.context);

    expect(jest.getTimerCount()).toBe(0);
  });

  it('degrades rather than throws when deck no longer offers shader inputs', () => {
    // `shaderInputs` is deck's plumbing, not its interface. A deck that moved
    // it would otherwise take every layer on the map down with this one.
    const { layer } = animatedLayer({}, { isVisible: true }, { model: {} });

    expect(() => layer.writeAnimationUniforms()).not.toThrow();
  });
});

describe('buildFlowFieldDeckLayer', () => {
  it('builds the self-animating layer, not deck\'s stock trips layer', () => {
    const layer = buildFlowFieldDeckLayer({ id: 'a', data: [], cycleMs: 60_000, trailMs: 2_400, animate: true });

    expect(layer).toBeInstanceOf(AnimatedTripsLayer);
    expect((layer as AnimatedTripsLayer).props.cycleMs).toBe(60_000);
  });
});
