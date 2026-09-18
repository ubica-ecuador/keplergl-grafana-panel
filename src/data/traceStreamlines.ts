import { sampleWindField, WindField } from './buildWindField';
import { cellAt, keyOf, levelFor, phaseOf, seedOf, sizeAt } from './groundCells';

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
  /**
   * The ground cell this line is anchored to — see `groundCells.ts`.
   *
   * Only set for a line seeded through a `camera`: the viewport and no-camera
   * paths seed at a scattered point, not a patch of ground a caller could look
   * up again.
   */
  cell?: string;
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
   * Carry a line whose life runs past the end of the cycle round to the start of
   * it, so the field never empties and never refills — see `emit`.
   */
  seamless?: boolean;
  /**
   * Rescale times so the median streamline lasts this long. Omit to keep
   * physical time.
   *
   * A no-op together with `camera` and no `cycleMs`: the camera path collects
   * finished streamlines directly rather than raw vertices, so there is no
   * median left to measure by the time this would apply.
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
   *
   * Superseded by `camera` where one is available: a viewport is a rectangle of
   * ground, which is only what the screen shows when the map is looking straight
   * down.
   */
  viewport?: Viewport;
  /**
   * The camera the map is looking through, which is not the same thing as a
   * rectangle of ground — see `ScreenCamera`.
   */
  camera?: ScreenCamera;
  /**
   * Lines already traced, by ground cell.
   *
   * Handed in by the layer, which keeps one of these per forecast hour. A cell
   * in here is not traced again, which is what makes panning cheap and keeps a
   * line from moving under the reader.
   */
  cells?: Map<string, Streamline[] | null>;
  /**
   * How much the line count follows the ground rather than the screen, from 0 to
   * 1 — see `zoomFactor`.
   */
  zoomResponse?: number;
  /** Step length in screen pixels when a viewport is given. */
  segmentPixels?: number;
  /** How far past the edge of the screen to seed, as a multiple of the extent. */
  expandFactor?: number;
}

/**
 * The camera the map is looking through.
 *
 * A `Viewport` is a rectangle of ground, and that is only what the screen shows
 * when the map looks straight down. Tilt it and the ground on screen becomes a
 * trapezoid reaching towards the horizon — several times deeper up-range than
 * the flat rectangle is tall — and rotating it turns that trapezoid on the
 * compass as well. Seeding the rectangle then leaves the top half of the screen
 * bare, which reads as the field being clipped.
 *
 * So the tracer is handed the camera rather than a box, and seeds by picking
 * pixels and asking what ground is under them. The density it aims for is a
 * count per *screen*, and this makes that true by construction at any pitch,
 * bearing and zoom, instead of true only when looking straight down.
 */
export interface ScreenCamera {
  widthPx: number;
  heightPx: number;
  /** The ground under a screen pixel, or null where the pixel shows sky. */
  unproject(x: number, y: number): [number, number] | null;
  /** The ground the screen shows at all, as a box around the trapezoid. */
  bounds: Box;
  /** Metres per pixel at the centre of the view. */
  metresPerPixel: number;
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
 * levels keep their real proportion to each other. Returns 1 with no width or no
 * height, so nothing is invented when there is nothing to stack.
 *
 * The width is measured **across the middle of the screen** — metres per pixel
 * times the panel's width — and not from the ground the camera can see. Those
 * two are the same thing looking straight down and wildly different once the map
 * is tilted, where the visible ground runs to the horizon: measured over
 * Ecuador at a pitch of 50, the trapezoid was twelve times wider than the view,
 * which lifted a 3 km level to 600 km and threw the whole stack off the north of
 * the screen. What a person means by "how wide is this view" does not change
 * when they tilt the camera, and neither does this.
 */
export function stackExaggeration(tallest: number, metresAcross?: number): number {
  if (!metresAcross || tallest <= 0) {
    return 1;
  }

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
/** A rectangle of ground. */
export interface Box {
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

/**
 * What the tracer needs, worked out from the camera.
 *
 * `coverage` is the whole of the zoom response, and the two ends of it are
 * different questions. At 0 the count is a budget for the *screen*: the field
 * looks the same at every scale, which is Esri's model and what this drew
 * before. At 1 it is a budget for the *field*: zooming in shows only the share
 * of it that is on screen, so the lines thin out and separate — what a person
 * means by zooming into something. In between the two are blended, which is
 * usually where a map that is looked at across several scales wants to sit.
 *
 * The share is capped at 1 so that zooming out past the data never asks for more
 * lines than the budget, only for the whole of it.
 */
function cameraSettings(camera: ScreenCamera, extent: Box, segmentPixels: number, zoomResponse = 0) {
  const whole = area(extent);
  const onScreen = area(intersect(camera.bounds, extent));
  const share = whole > 0 ? Math.min(1, onScreen / whole) : 1;
  const response = Math.min(1, Math.max(0, zoomResponse));

  return {
    // Only used to sample typical speeds; the seeds themselves come from the
    // screen, so this needs to be where the data and the view overlap.
    seedArea: intersect(camera.bounds, extent),
    coverage: Math.pow(share, response),
    segmentMeters: camera.metresPerPixel * segmentPixels,
    metresPerPixel: camera.metresPerPixel,
  };
}

/**
 * Below this, a pitch stops being a sampling step and starts being a loop
 * that never ends — the floor a degenerate camera (looking edge-on at the
 * ground, say) cannot push through.
 */
const MIN_CELL_PITCH_PX = 2;

/**
 * How much of a cell's own pixel pitch the sample lattice steps by.
 *
 * Stepping exactly one pitch pairs samples with cells one to one only where
 * the two lattices are in phase. Where they are not — and they never are for
 * long, because the cells are pinned to the ground and the samples to the
 * screen — two consecutive samples straddle a cell and miss it, and the cells
 * clipped by the edge of a band or of the screen are missed outright.
 * Measured at the density the plugin ships (9,000), a lattice stepped at
 * exactly one pitch reached 73% of the cells on screen flat and 68% at a
 * pitch of 60, and since which cells it missed moved with the camera, a
 * 3.6-pixel pan — an 800th of the screen — lost a quarter of its lines to
 * nothing but that.
 *
 * Any share below one already puts a sample inside every whole cell, so all a
 * finer lattice can add is the cells clipped at an edge — and measurement
 * says it adds nothing worth having. This constant has now been flipped
 * between 0.8, a half and a third more than once, so here are all three at
 * density 9,000, with deck's own viewport, flat and at a pitch of 60:
 *
 * | share | reuse flat, 3.6/10/50 px | reuse at pitch 60 | `unproject` calls |
 * |-------|--------------------------|-------------------|-------------------|
 * | 0.8   | 99.3 / 98.6 / 93.6       | 99.6 / 98.9 / 94.1 | 24.0k flat, 18.1k tilted |
 * | 0.5   | 100.0 / 99.3 / 94.3      | 99.6 / 98.9 / 94.0 | 60.9k flat, 42.6k tilted |
 * | 0.33  | 99.3 / 98.6 / 93.6       | 99.6 / 98.8 / 94.1 | 121.6k flat, 75.1k tilted |
 *
 * All three agree to within a point on every pan and both pitches — including
 * the near-horizon band, the one a tilt hurts most, where the worst band of
 * the eight reused 99.6% at 0.8 against 99.6% at a half — and they agree to
 * within a hundred lines on the count and to two decimal places on the
 * evenness of a tilted screen. So 0.8 is chosen on cost, not on coverage: it
 * is two and a half times cheaper than a half and five times cheaper than a
 * third, for the same picture. A finer share is not a safety margin, it is
 * only more `unproject` calls — `seen` absorbs every duplicate sample and a
 * cell is traced exactly once whatever the share, so what a finer lattice
 * spends is never `trace` calls.
 */
const SAMPLE_STEP_SHARE = 0.8;

/**
 * The ground-cell level for a band of the screen, and how many screen pixels
 * one of its cells spans along each screen axis there.
 *
 * The level comes from the ground **area** one pixel covers, not from the
 * east-west span alone. Cells of `s` degrees tile a screen of `W·H` pixels
 * `W·H·areaPerPixel / s²` times, so the size that reproduces the budget is
 * `s = spacingPx · √areaPerPixel` — the geometric mean of the ground per
 * pixel on the two axes. Sizing from east-west alone ignores that a tilted
 * camera stretches only the other axis: at a pitch of 60 a pixel near the
 * horizon covers several times more ground north-south than east-west, so
 * the distance was tiled with far more, far flatter cells than the budget
 * asked for — 17,822 lines against a budget of 9,000, with the top quarter
 * of the screen carrying 3.7 times the lines of the bottom.
 *
 * Both the area and the two pitches are measured from the vectors a step
 * across and a step down the screen trace on the ground, rather than from one
 * number per compass axis, because a rotated map turns the screen against the
 * compass: at a bearing of 90 a step down the screen changes no latitude at
 * all, and a north-south reading would call that zero ground per pixel and
 * size the whole band off a division by nothing.
 *
 * The pitches are what the lattice is stepped by, and they are a separate
 * question from the size: `levelFor` rounds to the nearest power of two, so
 * the cell it returns is anywhere from 0.7 to 1.4 times the size asked for,
 * and a tilted cell that is `spacingPx` wide is only a few pixels tall. A
 * lattice stepped by `spacingPx` on both axes therefore does not track the
 * cells at all.
 */
function bandSampling(
  camera: ScreenCamera,
  y: number,
  spacingPx: number
): { level: number; pitchX: number; pitchY: number } | null {
  const here = camera.unproject(camera.widthPx / 2, y);
  const across = camera.unproject(camera.widthPx / 2 + 1, y);
  const down = camera.unproject(camera.widthPx / 2, y + 1);
  if (!here || !across || !down) {
    return null;
  }

  const stepX: [number, number] = [across[0] - here[0], across[1] - here[1]];
  const stepY: [number, number] = [down[0] - here[0], down[1] - here[1]];

  // Square degrees under one pixel: the determinant of those two steps, which
  // is the same number however the map is turned. Zero means the band is
  // looking at the ground edge-on and has no size to measure; skipped rather
  // than divided by.
  const areaPerPixel = Math.abs(stepX[0] * stepY[1] - stepY[0] * stepX[1]);
  if (!(areaPerPixel > 0)) {
    return null;
  }

  // `levelFor` takes metres and divides them straight back out by the same
  // east-west factor; multiplying by it here is how a target in degrees is
  // handed to a metres-shaped signature without touching `groundCells.ts`,
  // which is closed.
  const eastPerDegree = METRES_PER_DEGREE * Math.max(0.2, Math.cos((here[1] * Math.PI) / 180));
  const level = levelFor(Math.sqrt(areaPerPixel) * eastPerDegree, spacingPx, here[1]);
  const sizeDegrees = sizeAt(level);

  // Taken from the faster-moving of a step's two components, so the lattice
  // never steps further than the cell reaches on the axis that is changing
  // quickest: under a bearing the screen's x runs partly north, and counting
  // only the longitude it covers would overstate how far a sample may travel
  // and start skipping cells again.
  const pitchOf = (step: [number, number]) =>
    Math.max(
      MIN_CELL_PITCH_PX,
      (SAMPLE_STEP_SHARE * sizeDegrees) / Math.max(Math.abs(step[0]), Math.abs(step[1]))
    );

  return { level, pitchX: pitchOf(stepX), pitchY: pitchOf(stepY) };
}

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

  // Three ways to decide where to start lines and how long a step is, in
  // descending order of how much they know about what the user is looking at.
  const scaled = options.camera
    ? cameraSettings(options.camera, extent, base.segmentPixels, options.zoomResponse)
    : options.viewport
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

  const camera = options.camera;
  const lines: Streamline[] = [];

  if (!camera) {
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
  }

  // `emit` closes over `scale`, so it has to exist before the camera branch
  // below can call it — `traced` is only ever filled by the branch above, so
  // computing this here rather than after both branches changes nothing for
  // either of them.
  const scale = timeScale(traced, options.targetLifetimeMs);

  if (camera) {
    /**
     * Walked in horizontal bands rather than seeded at one uniform spacing:
     * on a tilted camera the ground a pixel covers grows several times over
     * from the bottom of the screen to the top, and a single cell size for
     * the whole view is exactly what piled every line against the horizon.
     * Each band gets the cell size the ground *there* calls for, so the
     * count of lines per screen stays roughly even from top to bottom.
     *
     * The lattice within a band is stepped at a fraction of that cell's own
     * pixel pitch — measured along each screen axis by `bandSampling` — not
     * at this uniform `spacingPx`: a cell sized from `spacingPx` is not
     * `spacingPx` pixels wide on screen (rounding) or tall (tilt), and
     * sampling at the wrong pitch is what let the lattice miss whole cells,
     * a different set on every pan.
     *
     * A cell replaces the pixel as the unit of seeding: two calls that land
     * on the same patch of ground get the same seed point and the same birth
     * phase (`seedOf`/`phaseOf`, both pure functions of the cell), and the
     * `cells` cache below skips retracing it altogether. That is what lets a
     * pan reuse the lines it already drew instead of jumping all of them to
     * a fresh set of random pixels.
     */
    const spacingPx = Math.max(4, Math.sqrt((camera.widthPx * camera.heightPx) / Math.max(1, wanted)));
    // Fine enough to track the ground's foreshortening without walking every
    // scanline as its own band.
    const bands = 8;
    const seen = new Set<string>();

    for (let band = 0; band < bands; band++) {
      const top = (band / bands) * camera.heightPx;
      const height = camera.heightPx / bands;
      const middle = top + height / 2;

      const sampling = bandSampling(camera, middle, spacingPx);
      if (sampling === null) {
        continue;
      }
      const { level, pitchX, pitchY } = sampling;

      for (let y = top; y < top + height; y += pitchY) {
        for (let x = 0; x < camera.widthPx; x += pitchX) {
          // Sampled where the lattice actually falls. There was a jitter here
          // while a sample *was* a seed; now it only names a cell, and
          // `seedOf` places the line inside that cell, so all a jitter could
          // do was carry a sample a whole pitch from where the step put it —
          // leaving some cells sampled twice and others not at all.
          const at = camera.unproject(x, y);
          if (!at) {
            continue;
          }

          const cell = cellAt(level, at[0], at[1]);
          const key = keyOf(cell);
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);

          const cached = options.cells?.get(key);
          if (cached !== undefined) {
            if (cached) {
              lines.push(...cached);
            }
            continue;
          }

          const [lon, lat] = seedOf(cell);
          const vertices = trace(field, lon, lat, settings);
          const emitted = vertices ? emit(vertices, key, phaseOf(cell)) : null;
          options.cells?.set(key, emitted);
          if (emitted) {
            lines.push(...emitted);
          }
        }
      }
    }
  }

  return camera ? lines : traced.flatMap((vertices, id) => emit(vertices, id));

  /**
   * One traced polyline as the streamlines that draw it — usually one, and two
   * when it has to cross the loop.
   *
   * When a cycle is given, every streamline is stretched onto the same window,
   * so what moves is a short trail rather than the whole line appearing and
   * vanishing — the earth.nullschool look. Only the *total* is normalised: the
   * spacing of the vertices inside the line keeps following the local wind, so a
   * trail still slows through slack air. What is lost is the speed contrast
   * *between* lines; that moves to colour, which is why `speed` rides along.
   *
   * The window is a whole line's, not each line's own. A line cut short by a
   * hole or the edge of the field lives for less of it rather than being
   * stretched over all of it: stretched, a line of ten vertices spent three
   * times as long on each as a line of thirty, and crawled through the same
   * wind — exactly where a field has holes.
   *
   * A line whose life runs past the end of the cycle is emitted a second time,
   * with every vertex time a whole cycle earlier. The two are the same geometry
   * seen either side of the loop: as the playhead reaches the end the first is
   * finishing, and the moment it wraps to the start the second is already
   * mid-flight, at the same place, with the same trail behind it. deck reads a
   * path's timestamps as increasing, so a line that wraps cannot be one path —
   * and without the second the field visibly empties into the loop and refills
   * out of it.
   */
  function emit(vertices: Vertex[], id: string | number, phase?: number): Streamline[] {
    const total = vertices[vertices.length - 1].seconds;
    const meanSpeed = vertices.reduce((sum, p) => sum + p.speed, 0) / vertices.length;
    const speed = Number(meanSpeed.toFixed(2));
    const pathOf = (timeAt: (p: Vertex) => number): Streamline['path'] =>
      vertices.map((p) => [p.lon, p.lat, settings.altitudeMeters, timeAt(p)] as [number, number, number, number]);
    // Only the camera path calls this with a real ground cell; the viewport
    // and no-camera paths pass their loop index, which names nothing a caller
    // could look up again.
    const cell = typeof id === 'string' ? id : undefined;

    if (options.cycleMs === undefined || total <= 0) {
      return [
        {
          path: pathOf((p) => options.baseMs + offsetFor(id) + Math.round(p.seconds * 1000 * scale)),
          speed,
          cell,
        },
      ];
    }

    const cycleMs = options.cycleMs;
    const share = Math.min(1, Math.max(0.05, options.lifeFraction ?? 1));
    const life = share * cycleMs;
    // The cell's own phase when it has one, so a line re-traced after a pan or
    // a change of forecast hour carries on where it was instead of starting
    // its trail again from nothing. Mapped into the same window `birthWithin`
    // is itself limited to — the whole cycle when the loop is seamless, but
    // only as far as `cycleMs - life` when it is not — or a line born from a
    // high phase would still be alive past the end of a non-seamless cycle
    // with no second emission to carry it: exactly the cut trail
    // `seamless: false` exists to avoid.
    const birth =
      phase === undefined
        ? birthWithin(cycleMs, life)
        : Math.round(phase * (options.seamless ? cycleMs : cycleMs - life));
    const timeAt = (shift: number) => (p: Vertex) =>
      options.baseMs + birth - shift + Math.round(p.seconds * 1000 * share);

    // What this line actually lives for, which is less than `life` when it was
    // cut short: only a line that genuinely overruns the cycle has a crossing to
    // carry.
    const lived = total * 1000 * share;
    const lines = [{ path: pathOf(timeAt(0)), speed, cell }];
    if (options.seamless && birth + lived > cycleMs) {
      lines.push({ path: pathOf(timeAt(cycleMs)), speed, cell });
    }
    return lines;
  }

  /**
   * When in the cycle a line is born.
   *
   * Seamless, the whole cycle is fair game and the overrun is carried round by
   * the second emission. Without it the birth has to be clamped so the line ends
   * before the loop does — which is exactly why the field then empties towards
   * the end of every cycle, and starts each one from nothing: no line is born in
   * the last `life` of the window, and none has been alive long at the start.
   */
  function birthWithin(cycleMs: number, life: number): number {
    if (options.seamless) {
      return Math.round(random() * cycleMs);
    }
    return options.lifeFraction === undefined ? 0 : Math.round(random() * (cycleMs - life));
  }

  function offsetFor(_id: string | number): number {
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
