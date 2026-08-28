import { makeScreenCamera } from './flowFieldDeckLayer';

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
