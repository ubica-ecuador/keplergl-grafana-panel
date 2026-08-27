import { sampleWindField, WindField } from './buildWindField';

/**
 * One traced path, in the shape deck's `TripsLayer` reads.
 *
 * A plain array rather than a GeoJSON string: the streamlines used to be handed
 * to kepler as rows of a `_geojson` column, so every trace stringified nine
 * thousand features for kepler to parse straight back. The layer now draws them
 * itself, and nothing in between needs them spelled as text.
 */
export interface Streamline {
  /** `[lon, lat, altitude, epochMs]` per vertex. */
  path: Array<[number, number, number, number]>;
  /** Mean speed along the line, in m/s — what the colour ramp reads. */
  speed: number;
}

/** What the map is currently showing: a geographic extent and its size on screen. */
export interface Viewport {
  west: number;
  south: number;
  east: number;
  north: number;
  widthPx: number;
  heightPx: number;
}

/** How the streamlines are seeded, traced and timed. */
export interface StreamlineOptions {
  /** How many streamlines to seed. */
  count: number;
  /** Seeds the generator, so the same query always draws the same lines. */
  seed: number;
  /** Epoch ms the animation starts from. */
  baseMs: number;
  /** Distance between consecutive vertices, in metres. */
  segmentMeters?: number;
  /** Maximum vertices per streamline. */
  maxVertices?: number;
  /** Below this speed a streamline ends, in m/s. */
  minSpeed?: number;
  /** Height above ground for every vertex, in metres. */
  altitudeMeters?: number;
  /**
   * Run every streamline over one shared window of this length, so all of them
   * are on screen at all times. Wins over `targetLifetimeMs` and `staggerMs`.
   */
  cycleMs?: number;
  /**
   * What fraction of the cycle one streamline lives for. Below 1 the births are
   * spread through the cycle, so trails appear and fade continuously instead of
   * every line restarting together when the animation loops.
   */
  lifeFraction?: number;
  /**
   * Rescale times so the median streamline lasts this long. Omit to keep
   * physical time.
   */
  targetLifetimeMs?: number;
  /**
   * Spread the start of each streamline over this window. Omit to start them
   * all together.
   */
  staggerMs?: number;
  /**
   * What the map is showing. Supply it and both the seeding and the step size
   * follow the screen instead of the ground — see `viewportSettings`.
   */
  viewport?: Viewport;
  /** Step length in screen pixels when a viewport is given. */
  segmentPixels?: number;
  /** How far past the edge of the screen to seed, as a multiple of the extent. */
  expandFactor?: number;
}

const METRES_PER_DEGREE = 111_320;

/**
 * How much of the view's width a stack of levels should rise to.
 *
 * Below about a tenth the levels sit on top of each other; much above a fifth
 * the stack stops reading as a map and starts reading as a wall.
 */
const STACK_SHARE_OF_VIEW = 0.15;

/**
 * How much to stretch the vertical so a stack of levels reads on screen.
 *
 * Pressure levels a few kilometres apart are invisible over a country hundreds
 * of kilometres wide — 1000 to 700 hPa is 2.9 km over ~650 km, four parts in a
 * thousand — and a camera tilt compresses the vertical further still. The stack
 * is scaled to a share of the view instead, which is the only way one number can
 * serve every zoom.
 *
 * `tallest` is the highest level on the map rather than this layer's own, so the
 * levels keep their real proportion to each other. Returns 1 with no viewport or
 * no height, so nothing is invented when there is nothing to stack.
 */
export function stackExaggeration(tallest: number, viewport?: Viewport): number {
  if (!viewport || tallest <= 0) {
    return 1;
  }

  const metresAcross =
    (viewport.east - viewport.west) *
    METRES_PER_DEGREE *
    Math.cos((((viewport.south + viewport.north) / 2) * Math.PI) / 180);

  return (metresAcross * STACK_SHARE_OF_VIEW) / tallest;
}

const DEFAULTS = {
  segmentMeters: 9_000,
  maxVertices: 30,
  minSpeed: 0.5,
  altitudeMeters: 0,
  // Five pixels per step and thirty steps gives a line about 150 px long — the
  // proportions Esri's demo uses, and they read well at any zoom.
  segmentPixels: 5,
  // How far a typical particle should travel across the screen in one cycle.
  travelPixels: 130,
  // A little past the edge, so lines are not seen to begin and end exactly at
  // the border of the screen.
  expandFactor: 1.2,
};

/**
 * Turns the viewport into a seeding area and a step length.
 *
 * This is what makes the visualisation hold up while zooming. Traced once in
 * geographic space, the lines drift apart as you zoom in —— four of them across
 * the screen —— and mat together as you zoom out. Esri avoids that by working in
 * screen space and re-tracing whenever the view settles: a fixed number of lines
 * per screen, each a fixed number of pixels long.
 *
 * Here the same idea costs only a change of units, because the step is already
 * an arc length: how many metres a pixel covers depends on the zoom, so a step
 * of five pixels is a different number of metres at every scale.
 */
interface Box {
  west: number;
  east: number;
  south: number;
  north: number;
}

const intersect = (a: Box, b: Box): Box => ({
  west: Math.max(a.west, b.west),
  east: Math.min(a.east, b.east),
  south: Math.max(a.south, b.south),
  north: Math.min(a.north, b.north),
});

const area = (box: Box) => Math.max(0, box.east - box.west) * Math.max(0, box.north - box.south);

function viewportSettings(
  viewport: Viewport,
  extent: Box,
  segmentPixels: number,
  expandFactor: number
) {
  const centreLon = (viewport.west + viewport.east) / 2;
  const centreLat = (viewport.south + viewport.north) / 2;
  const halfWidth = ((viewport.east - viewport.west) / 2) * expandFactor;
  const halfHeight = ((viewport.north - viewport.south) / 2) * expandFactor;

  const expanded = {
    west: centreLon - halfWidth,
    east: centreLon + halfWidth,
    south: centreLat - halfHeight,
    north: centreLat + halfHeight,
  };

  // Longitude degrees shrink away from the equator; without the correction the
  // step would be too long east-west at high latitude.
  const metresPerDegreeLon = METRES_PER_DEGREE * Math.cos((centreLat * Math.PI) / 180);
  const metresAcross = (viewport.east - viewport.west) * metresPerDegreeLon;

  const metresPerPixel = metresAcross / viewport.widthPx;

  return {
    // Clipped to the data: a streamline can only exist where there is a field,
    // so seeding beyond it only wastes attempts on empty space.
    seedArea: intersect(expanded, extent),
    // And the count follows the share of the screen the data actually fills, so
    // the density on screen stays put whether that data is a country or two
    // three-kilometre patches around a pair of weather stations. Spending the
    // whole budget on whatever is visible packs those patches solid.
    coverage: Math.min(1, area(intersect(viewport, extent)) / area(viewport)),
    segmentMeters: metresPerPixel * segmentPixels,
    metresPerPixel,
  };
}

/**
 * Traces streamlines through a wind field.
 *
 * A streamline is the path a massless particle takes when released into the
 * field. Each vertex carries a timestamp, which is what lets a trips layer
 * animate a trail running along it. Adapted from Esri's `animated-flow-ts`
 * (Apache-2.0).
 *
 * The step is a **fixed arc length**, not a fixed time step. That spaces the
 * vertices evenly along the line, and makes the time between them inversely
 * proportional to the speed — which is what makes fast wind animate fast.
 */
export function traceStreamlines(field: WindField, options: StreamlineOptions): Streamline[] {
  const base = { ...DEFAULTS, ...options };

  const extent: Box = {
    west: field.west,
    east: field.west + (field.columns - 1) * field.stepLon,
    south: field.south,
    north: field.south + (field.rows - 1) * field.stepLat,
  };

  // With a viewport the seeding area and the step follow the screen; without
  // one they fall back to the whole field and a fixed distance on the ground.
  const scaled = options.viewport
    ? viewportSettings(options.viewport, extent, base.segmentPixels, base.expandFactor)
    : { seedArea: extent, coverage: 1, segmentMeters: base.segmentMeters, metresPerPixel: 0 };

  const wanted = Math.round(options.count * scaled.coverage);
  if (wanted < 1 || area(scaled.seedArea) <= 0) {
    return [];
  }

  const step: Step =
    options.cycleMs === undefined
      ? { kind: 'arc', segmentMeters: scaled.segmentMeters }
      : {
          kind: 'time',
          seconds: options.cycleMs / 1000 / (base.maxVertices - 1),
          speedScale: speedScaleFor(
            field,
            scaled.seedArea,
            options.cycleMs,
            travelPixelsFor(scaled.seedArea, base.travelPixels, scaled.metresPerPixel),
            scaled.metresPerPixel
          ),
        };

  const settings = { ...base, step };
  const random = seededRandom(options.seed);
  const traced: Vertex[][] = [];

  // More attempts than lines asked for: some seeds land in calm air, in a hole
  // or next to the edge, and yield nothing usable.
  const maxAttempts = wanted * 4;

  for (let attempt = 0; attempt < maxAttempts && traced.length < wanted; attempt++) {
    const lon = scaled.seedArea.west + random() * (scaled.seedArea.east - scaled.seedArea.west);
    const lat = scaled.seedArea.south + random() * (scaled.seedArea.north - scaled.seedArea.south);

    const vertices = trace(field, lon, lat, settings);
    if (vertices) {
      traced.push(vertices);
    }
  }

  const scale = timeScale(traced, options.targetLifetimeMs);

  return traced.map((vertices, id) => {
    const total = vertices[vertices.length - 1].seconds;
    const meanSpeed = vertices.reduce((sum, p) => sum + p.speed, 0) / vertices.length;

    /**
     * When a cycle is given, every streamline is stretched onto the same window
     * so all of them are drawn at all times — the earth.nullschool look, where
     * what moves is a short trail rather than the whole line appearing and
     * vanishing.
     *
     * Only the *total* is normalised. The spacing of the vertices inside the
     * line keeps following the local wind, so a trail still slows through slack
     * air. What is lost is the speed contrast *between* lines; that moves to
     * colour, which is why `speed` rides along on every row.
     */
    const timeAt =
      options.cycleMs !== undefined && total > 0
        ? cycleClock(options.baseMs, options.cycleMs, options.lifeFraction, total, random)
        : (p: Vertex) => options.baseMs + offsetFor(id) + Math.round(p.seconds * 1000 * scale);

    return {
      path: vertices.map(
        (p) => [p.lon, p.lat, settings.altitudeMeters, timeAt(p)] as [number, number, number, number]
      ),
      speed: Number(meanSpeed.toFixed(2)),
    };
  });

  /**
   * Maps a streamline's own elapsed seconds onto the shared animation cycle.
   *
   * With no life fraction the line fills the cycle exactly, which keeps the
   * whole field on screen but makes every trail restart together when kepler
   * loops — a visible blink. A fraction below 1 shortens each line's window and
   * scatters its birth through the cycle, so trails come and go continuously,
   * the way a patch that is genuinely simulating flow should look. Births are
   * clamped so nothing runs past the end of the cycle, which would stretch
   * kepler's animation domain past the loop point.
   */
  function cycleClock(
    baseMs: number,
    cycleMs: number,
    lifeFraction: number | undefined,
    totalSeconds: number,
    nextRandom: () => number
  ): (p: Vertex) => number {
    const life = Math.min(1, Math.max(0.05, lifeFraction ?? 1)) * cycleMs;
    const birth = lifeFraction === undefined ? 0 : Math.round(nextRandom() * (cycleMs - life));
    return (p: Vertex) => baseMs + birth + Math.round((p.seconds / totalSeconds) * life);
  }

  function offsetFor(_id: number): number {
    return options.staggerMs === undefined ? 0 : Math.round(random() * options.staggerMs);
  }
}

/**
 * How much to compress physical time by.
 *
 * Thirty segments of 9 km at 8 m/s is over nine hours of real time. Animating
 * that needs a day-long domain and an hours-long trail, so the times get scaled
 * to a comfortable window. Scaling is uniform, so the *relative* speeds survive
 * — fast streamlines still animate faster, which is the whole visual cue.
 */
function timeScale(traced: Vertex[][], targetLifetimeMs?: number): number {
  if (targetLifetimeMs === undefined || traced.length === 0) {
    return 1;
  }

  const durations = traced.map((v) => v[v.length - 1].seconds).sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)];

  return median > 0 ? targetLifetimeMs / (median * 1000) : 1;
}

interface Vertex {
  lon: number;
  lat: number;
  seconds: number;
  /** Carried through so the rows can be coloured by wind speed. */
  speed: number;
}

/**
 * How a particle advances from one vertex to the next.
 *
 * `arc` steps a fixed distance, so vertices are evenly spaced and the *time*
 * between them carries the speed. `time` steps a fixed duration, so every line
 * spans the same window — all of them on screen at once — and the *distance*
 * between vertices carries the speed instead. The second is what the
 * earth.nullschool look needs: a trail that visibly races in strong wind and
 * crawls in slack air, rather than every trail moving at the same rate.
 */
type Step =
  | { kind: 'arc'; segmentMeters: number }
  | { kind: 'time'; seconds: number; speedScale: number };

function trace(
  field: WindField,
  startLon: number,
  startLat: number,
  settings: { step: Step; maxVertices: number; minSpeed: number }
): Vertex[] | null {
  let lon = startLon;
  let lat = startLat;
  let seconds = 0;

  const vertices: Vertex[] = [];

  for (let i = 0; i < settings.maxVertices; i++) {
    const velocity = sampleWindField(field, lon, lat);
    // Outside the domain: the line ends here rather than extrapolating.
    if (!velocity) {
      break;
    }

    const [u, v] = velocity;
    const speed = Math.hypot(u, v);

    // Only arc stepping divides by the speed, so only it blows up in calm air.
    // A fixed time step simply moves the particle very little, which is the
    // honest picture of slack wind.
    if (settings.step.kind === 'arc' && speed < settings.minSpeed) {
      break;
    }

    vertices.push({ lon, lat, seconds, speed });

    const dt =
      settings.step.kind === 'arc' ? settings.step.segmentMeters / speed : settings.step.seconds;
    const advance = settings.step.kind === 'arc' ? dt : dt * settings.step.speedScale;

    lat += (v * advance) / METRES_PER_DEGREE;
    lon += (u * advance) / (METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
    seconds += dt;
  }

  // A line needs two points; kepler forms no geometry from one.
  return vertices.length >= 2 ? vertices : null;
}

/**
 * How far a particle should travel in one cycle, in screen pixels.
 *
 * The nominal distance reads well across a country. Inside a patch a few
 * kilometres wide it is most of the patch, so particles sweep straight out of it
 * and the whole thing looks like a blob drifting rather than a flow looping in
 * place. Capping the travel to a share of the patch's size on screen keeps the
 * motion where the data is, at whatever scale the data happens to be.
 */
function travelPixelsFor(seedArea: Box, nominal: number, metresPerPixel: number): number {
  if (metresPerPixel <= 0) {
    return nominal;
  }

  const widthPx = ((seedArea.east - seedArea.west) * METRES_PER_DEGREE) / metresPerPixel;
  return Math.min(nominal, Math.max(8, widthPx * 0.25));
}

/**
 * How much to speed up the advection so the field reads at map scale.
 *
 * With a fixed time step, the ground a particle covers is set by the wind alone,
 * and over a country that is either invisible or clean off the screen. One
 * shared factor keeps every particle's speed *relative* to the others — which is
 * the whole point of stepping by time — while putting a typical one at a
 * legible number of pixels per cycle.
 *
 * Without a viewport there is no pixel to aim at, so physical speed stands.
 */
function speedScaleFor(
  field: WindField,
  seedArea: Box,
  cycleMs: number,
  travelPixels: number,
  metresPerPixel: number
): number {
  if (metresPerPixel <= 0) {
    return 1;
  }

  const speeds: number[] = [];
  const samples = 12;
  for (let j = 0; j <= samples; j++) {
    for (let i = 0; i <= samples; i++) {
      const uv = sampleWindField(
        field,
        seedArea.west + ((seedArea.east - seedArea.west) * i) / samples,
        seedArea.south + ((seedArea.north - seedArea.south) * j) / samples
      );
      if (uv) {
        speeds.push(Math.hypot(uv[0], uv[1]));
      }
    }
  }

  speeds.sort((a, b) => a - b);
  const median = speeds[Math.floor(speeds.length / 2)];
  if (!median) {
    return 1;
  }

  return (travelPixels * metresPerPixel) / (median * (cycleMs / 1000));
}

/**
 * Seeded pseudo-random generator (mulberry32).
 *
 * Determinism matters here: without it every refresh would re-seed the
 * particles somewhere else and the map would flicker into a different field of
 * lines on each query.
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function random(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
