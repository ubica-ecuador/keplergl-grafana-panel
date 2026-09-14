import { altitudeOffsetFor, applyAltitude, baseAltitude, localUp } from './tile3dAltitude';

/**
 * Stands in for math.gl's `Matrix4`, which is an `Array` subclass with a
 * `clone`. Only those two traits are used, and a real one would drag the whole
 * math.gl graph into a test about arithmetic.
 */
class FakeMatrix extends Array<number> {
  static identity(): FakeMatrix {
    const m = new FakeMatrix();
    m.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    return m;
  }

  clone(): FakeMatrix {
    const m = new FakeMatrix();
    m.push(...this);
    return m;
  }
}

/**
 * The real root transform of the AGI HQ tileset — the scene this whole feature
 * came from. Column-major: elements 8..10 are the site's local vertical in
 * ECEF, and 12..14 its position on the globe.
 */
const AGI_TRANSFORM = [
  0.9685698432169108, 0.24874175124166173, 0, 0, -0.16001767508898374, 0.6230891826531153, 0.7656070886034095, 0,
  0.1904384479822422, -0.74154393777436, 0.6433084686837341, 0, 1216406.841449723, -4736461.695716812,
  4081475.752131637, 1,
];

/** The same tileset's own numbers, as loaders.gl reports them once parsed. */
const AGI_CENTRE_ALTITUDE = 317.6267942625335;
const AGI_HALF_HEIGHT = 20.368954658508315;

function tileset(overrides: Record<string, unknown> = {}) {
  return {
    modelMatrix: FakeMatrix.identity(),
    cartographicCenter: [-75.5967, 40.0388, AGI_CENTRE_ALTITUDE],
    root: {
      transform: AGI_TRANSFORM,
      header: { boundingVolume: { box: [0, 0, AGI_HALF_HEIGHT, 282.88, 0, 0, 0, 265.68, 0, 0, 0, AGI_HALF_HEIGHT] } },
    },
    ...overrides,
  };
}

describe('localUp', () => {
  it('reads the local vertical off the root transform', () => {
    expect(localUp(AGI_TRANSFORM)).toEqual([0.1904384479822422, -0.74154393777436, 0.6433084686837341]);
  });

  it('normalises a scaled transform', () => {
    // A tileset free to carry a scale in its transform would otherwise move by
    // `offset * scale` metres, which is the kind of error that looks like a
    // wrong offset rather than a wrong axis.
    const scaled = [...AGI_TRANSFORM];
    scaled[8] *= 3;
    scaled[9] *= 3;
    scaled[10] *= 3;

    const [x, y, z] = localUp(scaled);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    expect(x).toBeCloseTo(0.1904384479822422, 12);
  });

  it('falls back to straight up when there is no transform', () => {
    // A tileset that is not georeferenced draws in metre offsets from its own
    // origin, where straight up is straight up.
    expect(localUp(null)).toEqual([0, 0, 1]);
    expect(localUp(undefined)).toEqual([0, 0, 1]);
    expect(localUp(FakeMatrix.identity())).toEqual([0, 0, 1]);
  });

  it('falls back rather than dividing by zero on a degenerate column', () => {
    const flat = [...AGI_TRANSFORM];
    flat[8] = 0;
    flat[9] = 0;
    flat[10] = 0;
    expect(localUp(flat)).toEqual([0, 0, 1]);
  });
});

describe('baseAltitude', () => {
  it('takes the bottom of a box, not its centre', () => {
    // The centre is 20 m above the bottom here. Anchoring on the centre buries
    // the lower half of the building, which is what makes this worth a test.
    expect(baseAltitude(tileset())).toBeCloseTo(AGI_CENTRE_ALTITUDE - AGI_HALF_HEIGHT, 9);
  });

  it('takes the radius off a sphere', () => {
    const sphere = tileset({
      root: { transform: AGI_TRANSFORM, header: { boundingVolume: { sphere: [0, 0, 0, 40] } } },
    });
    expect(baseAltitude(sphere)).toBeCloseTo(AGI_CENTRE_ALTITUDE - 40, 9);
  });

  it('reads a region’s minimum height directly', () => {
    // A region states its own heights in metres above the ellipsoid, so there
    // is nothing to derive: the fifth value is the answer.
    const region = tileset({
      root: {
        transform: AGI_TRANSFORM,
        header: { boundingVolume: { region: [-1.3, 0.69, -1.29, 0.7, 88.5, 140.25] } },
      },
    });
    expect(baseAltitude(region)).toBe(88.5);
  });

  it('is null when the tileset says nothing usable', () => {
    // The centre altitude is the one thing that cannot be worked around: with
    // no centre there is no height to bring down to the ground plane.
    expect(baseAltitude(tileset({ cartographicCenter: null }))).toBeNull();
    expect(baseAltitude(tileset({ cartographicCenter: [0, 0, Number.NaN] }))).toBeNull();
    expect(baseAltitude(null)).toBeNull();
  });

  it('treats a missing bounding volume as no height at all', () => {
    // Nothing to subtract, so the centre is the best answer available — and a
    // better one than refusing, which would leave the layer invisible.
    const bare = tileset({ root: { transform: AGI_TRANSFORM, header: {} } });
    expect(baseAltitude(bare)).toBeCloseTo(AGI_CENTRE_ALTITUDE, 9);
    expect(baseAltitude(tileset({ root: null }))).toBeCloseTo(AGI_CENTRE_ALTITUDE, 9);
  });
});

describe('altitudeOffsetFor', () => {
  it('drops the base onto the ground plane by default', () => {
    expect(altitudeOffsetFor({}, tileset())).toBeCloseTo(-(AGI_CENTRE_ALTITUDE - AGI_HALF_HEIGHT), 9);
  });

  it('leaves the tileset where it is when grounding is off', () => {
    expect(altitudeOffsetFor({ groundTileset: false }, tileset())).toBe(0);
  });

  it('adds the manual trim on top of the grounding', () => {
    const grounded = -(AGI_CENTRE_ALTITUDE - AGI_HALF_HEIGHT);
    expect(altitudeOffsetFor({ altitudeOffset: 12 }, tileset())).toBeCloseTo(grounded + 12, 9);
    expect(altitudeOffsetFor({ groundTileset: false, altitudeOffset: 12 }, tileset())).toBe(12);
  });

  it('still honours the manual trim when the base cannot be worked out', () => {
    const unknown = tileset({ cartographicCenter: null });
    expect(altitudeOffsetFor({ altitudeOffset: -300 }, unknown)).toBe(-300);
  });

  it('ignores a trim that is not a finite number', () => {
    expect(altitudeOffsetFor({ groundTileset: false, altitudeOffset: 'mucho' }, tileset())).toBe(0);
    expect(altitudeOffsetFor({ groundTileset: false, altitudeOffset: Number.NaN }, tileset())).toBe(0);
  });
});

describe('applyAltitude', () => {
  it('writes the offset along the local vertical', () => {
    const ts = tileset();
    expect(applyAltitude(ts, -300)).toBe(true);

    expect(ts.modelMatrix[12]).toBeCloseTo(-300 * 0.1904384479822422, 9);
    expect(ts.modelMatrix[13]).toBeCloseTo(-300 * -0.74154393777436, 9);
    expect(ts.modelMatrix[14]).toBeCloseTo(-300 * 0.6433084686837341, 9);
    // Only the translation is ours; the basis has to survive untouched.
    expect(Array.from(ts.modelMatrix).slice(0, 12)).toEqual(Array.from(FakeMatrix.identity()).slice(0, 12));
  });

  it('replaces its own translation rather than accumulating it', () => {
    // `renderLayer` runs on every store change, so its own output comes back as
    // input; adding would walk the tileset off the planet.
    const ts = tileset();
    applyAltitude(ts, -300);
    applyAltitude(ts, -100);
    expect(ts.modelMatrix[14]).toBeCloseTo(-100 * 0.6433084686837341, 9);
  });

  it('reports no change when the offset is already applied', () => {
    // What stops a re-traversal being forced on every single render.
    const ts = tileset();
    expect(applyAltitude(ts, -300)).toBe(true);
    expect(applyAltitude(ts, -300)).toBe(false);
  });

  it('is a no-op without a matrix to write to', () => {
    expect(applyAltitude(null, -300)).toBe(false);
    expect(applyAltitude({ modelMatrix: null }, -300)).toBe(false);
  });

  it('refuses an offset that is not a finite number', () => {
    const ts = tileset();
    expect(applyAltitude(ts, Number.NaN)).toBe(false);
    expect(ts.modelMatrix[14]).toBe(0);
  });
});
