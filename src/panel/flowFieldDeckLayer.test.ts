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
 * The animated layer, without deck's lifecycle.
 *
 * `draw` itself is four lines of plumbing into deck and is covered in the
 * browser; what is worth asserting here is the decision it delegates — what the
 * shader is told, and whether another frame is asked for.
 */
function animatedLayer(props: Record<string, unknown>, canvas: Record<string, unknown> = { isVisible: true }) {
  const written: Array<Record<string, unknown>> = [];
  const layer = Object.create(AnimatedTripsLayer.prototype) as AnimatedTripsLayer;

  Object.assign(layer, {
    props: { cycleMs: 1000, trailMs: 40, animate: true, ...props },
    state: { model: { shaderInputs: { setProps: (p: Record<string, unknown>) => written.push(p) } } },
    // luma keeps this flag per canvas, with its own IntersectionObserver.
    context: { device: { canvasContext: canvas } },
  });

  return { layer, trips: () => written[written.length - 1]?.trips as Record<string, unknown> };
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

  it('stops when the system asks for less motion', () => {
    // Not thrift: a person who has told their machine that movement makes them
    // unwell has told this map too.
    const asked = { matches: true, media: '(prefers-reduced-motion: reduce)' };
    (window as unknown as { matchMedia: unknown }).matchMedia = () => asked;
    try {
      expect(animatedLayer({}).layer.writeAnimationUniforms()).toBe(false);
    } finally {
      delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    }
  });
});

describe('buildFlowFieldDeckLayer', () => {
  it('builds the self-animating layer, not deck\'s stock trips layer', () => {
    const layer = buildFlowFieldDeckLayer({ id: 'a', data: [], cycleMs: 60_000, trailMs: 2_400, animate: true });

    expect(layer).toBeInstanceOf(AnimatedTripsLayer);
    expect((layer as AnimatedTripsLayer).props.cycleMs).toBe(60_000);
  });
});
