import { WebMercatorViewport } from '@deck.gl/core';
import { WindField } from './buildWindField';
import { ScreenCamera, Streamline, traceStreamlines } from './traceStreamlines';

/** A field with the same velocity everywhere, spanning ±10°. */
function uniformField(u: number, v: number): WindField {
  return {
    data: Float32Array.from([u, v, u, v, u, v, u, v]),
    columns: 2,
    rows: 2,
    west: -10,
    south: -10,
    stepLon: 20,
    stepLat: 20,
  };
}

/** The vertices of a traced streamline. */
const coords = (line: { path: number[][] }): number[][] => line.path;

describe('traceStreamlines', () => {
  it('traces a streamline as a path of [lng, lat, alt, ts] vertices', () => {
    const rows = traceStreamlines(uniformField(10, 0), { count: 1, seed: 1, baseMs: 1_000_000 });

    expect(rows).toHaveLength(1);
    expect(rows[0].speed).toBeGreaterThan(0);

    const coordinates: number[][] = coords(rows[0]);
    expect(coordinates.length).toBeGreaterThan(1);
    // deck's TripsLayer reads the fourth value of each vertex as its timestamp,
    // so a vertex short of one animates as if it were at the epoch.
    expect(coordinates.every((c) => c.length === 4)).toBe(true);

    // A purely eastward wind moves the particle east at constant latitude.
    const lons = coordinates.map((c) => c[0]);
    const lats = coordinates.map((c) => c[1]);
    expect(lons.every((lon, i) => i === 0 || lon > lons[i - 1])).toBe(true);
    expect(lats.every((lat) => Math.abs(lat - lats[0]) < 1e-9)).toBe(true);

    const times = coordinates.map((c) => c[3]);
    expect(times.every((t, i) => i === 0 || t > times[i - 1])).toBe(true);
  });

  it('steps by a fixed distance, so the time between vertices encodes the speed', () => {
    // The step is arc length, not time. Vertices therefore sit the same distance
    // apart whatever the wind does, and slow wind takes proportionally longer to
    // cross a segment — which is what makes fast streamlines animate fast.
    const opts = { count: 1, seed: 7, baseMs: 0, segmentMeters: 9_000 };

    const slow = coords(traceStreamlines(uniformField(2, 0), opts)[0]);
    const fast = coords(traceStreamlines(uniformField(20, 0), opts)[0]);

    const gap = (c: number[][]) => c[1][3] - c[0][3];
    expect(gap(slow) / gap(fast)).toBeCloseTo(10, 6);

    const spanDegrees = (c: number[][]) => Math.abs(c[1][0] - c[0][0]);
    expect(spanDegrees(slow)).toBeCloseTo(spanDegrees(fast), 6);
  });

  it('ends a streamline at the edge of the domain instead of extrapolating', () => {
    // Every line is capped at 30 vertices; a field that pushes every particle
    // out of a small domain must produce shorter lines than that.
    const narrow: WindField = {
      data: Float32Array.from([30, 0, 30, 0, 30, 0, 30, 0]),
      columns: 2,
      rows: 2,
      west: 0,
      south: 0,
      stepLon: 1,
      stepLat: 1,
    };

    const rows = traceStreamlines(narrow, { count: 5, seed: 3, baseMs: 0, maxVertices: 30 });

    for (const row of rows) {
      const coordinates: number[][] = coords(row);
      expect(coordinates.length).toBeLessThan(30);
      expect(coordinates.every((c) => c[0] >= 0 && c[0] <= 1)).toBe(true);
    }
  });

  it('produces no streamlines in calm air', () => {
    expect(traceStreamlines(uniformField(0.1, 0), { count: 5, seed: 3, baseMs: 0 })).toEqual([]);
  });

  it('draws the same lines for the same seed, and different ones otherwise', () => {
    // Without this a refresh would re-seed the particles somewhere else and the
    // map would flicker into a different field of lines on every query.
    const field = uniformField(10, 2);
    const at = (seed: number) => traceStreamlines(field, { count: 3, seed, baseMs: 0 });

    expect(at(42)).toEqual(at(42));
    expect(at(42)).not.toEqual(at(43));
  });

  it('staggers start times so the layer flows instead of pulsing', () => {
    // kepler has one clock per layer: a trip is only drawn during its own
    // interval. If every streamline started at the same instant they would all
    // appear and vanish together — a heartbeat, not a flow. This is the
    // equivalent of the `a_Random` attribute in Esri's shader.
    const rows = traceStreamlines(uniformField(10, 0), {
      count: 20,
      seed: 5,
      baseMs: 0,
      staggerMs: 60_000,
    });

    const starts = rows.map((r) => coords(r)[0][3] as number);

    expect(new Set(starts).size).toBeGreaterThan(10);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(20_000);
    expect(Math.max(...starts)).toBeLessThanOrEqual(60_000);
  });

  it('scales durations so the typical streamline lasts the requested lifetime', () => {
    // Physical time is unusable directly: 30 segments of 9 km at 8 m/s is over
    // nine hours, which would need a day-long domain and an hours-long trail.
    // Scaling preserves the *relative* speeds, which is the visual cue that
    // matters.
    const rows = traceStreamlines(uniformField(10, 0), {
      count: 15,
      seed: 9,
      baseMs: 0,
      targetLifetimeMs: 20_000,
      staggerMs: 0,
    });

    const durations = rows.map((r) => {
      const c: number[][] = coords(r);
      return c[c.length - 1][3] - c[0][3];
    });
    const median = [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)];

    expect(median).toBeGreaterThan(19_000);
    expect(median).toBeLessThan(21_000);
  });

  it('seeds inside the viewport, not across the whole field', () => {
    // Seeding the whole field wastes almost every line when zoomed in: they are
    // traced somewhere off screen and the visible area ends up nearly empty.
    const rows = traceStreamlines(uniformField(10, 0), {
      count: 40,
      seed: 11,
      baseMs: 0,
      viewport: { west: -1, south: -1, east: 1, north: 1, widthPx: 800, heightPx: 800 },
    });

    const starts = rows.map((r) => coords(r)[0] as number[]);
    expect(starts.length).toBeGreaterThan(0);

    // Expanded by the default factor, so lines exist slightly beyond the edge
    // and do not visibly stop at the border of the screen.
    for (const [lon, lat] of starts) {
      expect(Math.abs(lon)).toBeLessThan(2);
      expect(Math.abs(lat)).toBeLessThan(2);
    }
  });

  it('keeps streamlines the same length on screen as the viewport zooms', () => {
    // The step is a fixed number of *pixels*, so zooming in shortens it in
    // degrees. Without that, a zoomed-in view shows two enormous lines and a
    // zoomed-out one shows a solid mat.
    const field = uniformField(10, 0);
    const common = { count: 1, seed: 4, baseMs: 0 };

    const wide = traceStreamlines(field, {
      ...common,
      viewport: { west: -4, south: -4, east: 4, north: 4, widthPx: 800, heightPx: 800 },
    });
    const close = traceStreamlines(field, {
      ...common,
      viewport: { west: -1, south: -1, east: 1, north: 1, widthPx: 800, heightPx: 800 },
    });

    const spanDegrees = (rows: ReturnType<typeof traceStreamlines>) => {
      const c: number[][] = coords(rows[0]);
      return Math.abs(c[c.length - 1][0] - c[0][0]);
    };

    // Four times the geographic width at the same pixel width means each pixel
    // covers four times the ground, so the line must span four times as far.
    expect(spanDegrees(wide) / spanDegrees(close)).toBeCloseTo(4, 1);
  });

  it('seeds only where the field actually has data', () => {
    // A viewport wider than the data — zoomed out past the edge of the country —
    // would otherwise waste most of its seeds on empty space, and the lines that
    // did land would crowd into the data instead of spreading evenly.
    const rows = traceStreamlines(uniformField(10, 0), {
      count: 200,
      seed: 3,
      baseMs: 0,
      // El campo va de −10 a 10; la vista, de −40 a 40.
      viewport: { west: -40, south: -40, east: 40, north: 40, widthPx: 800, heightPx: 800 },
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const [lon, lat] = coords(row)[0] as number[];
      expect(Math.abs(lon)).toBeLessThanOrEqual(10);
      expect(Math.abs(lat)).toBeLessThanOrEqual(10);
    }
  });

  it('spends the budget in proportion to the screen the data fills', () => {
    // Holding the density constant per screen is what keeps two three-kilometre
    // patches from being packed solid with a country's worth of lines. The
    // budget itself has to be generous enough that a country covering a third of
    // the view still gets plenty — that was the real cause of an earlier round of
    // "there are fewer points", not this rule.
    const field = uniformField(10, 0); // cubre 20° × 20°
    const at = (halfSpan: number) =>
      traceStreamlines(field, {
        count: 400,
        seed: 8,
        baseMs: 0,
        viewport: {
          west: -halfSpan,
          south: -halfSpan,
          east: halfSpan,
          north: halfSpan,
          widthPx: 800,
          heightPx: 800,
        },
      }).length;

    expect(at(10)).toBe(400); // el dato llena la vista
    expect(at(20)).toBeCloseTo(100, -2); // ocupa un cuarto del área, un cuarto de las líneas
  });

  it('runs every streamline over the same window, so the field never thins out', () => {
    // The earth.nullschool look: every particle is on screen at all times, and
    // what moves is a short trail along its path. Staggering short-lived lines
    // instead leaves only a fraction alive at any instant, scattered at random —
    // which reads as gaps in the field rather than as flow.
    const rows = traceStreamlines(uniformField(10, 3), {
      count: 30,
      seed: 6,
      baseMs: 5_000,
      cycleMs: 60_000,
    });

    expect(rows.length).toBeGreaterThan(1);

    for (const row of rows) {
      const times = coords(row).map((c) => c[3]);
      expect(times[0]).toBe(5_000);
      expect(times[times.length - 1]).toBe(65_000);
    }
  });

  it('makes a streamline in fast wind longer than one in slack wind', () => {
    // With every line sharing one window, length is the only thing left to carry
    // speed: a particle in strong wind must cover more ground in the same time,
    // so its trail visibly races while a slow one crawls. Tracing a fixed number
    // of steps instead makes every line the same length and every trail move at
    // the same rate — which reads as a field where nothing is faster than
    // anything else.
    const span = (u: number) => {
      const field: WindField = {
        data: Float32Array.from([u, 0, u, 0, u, 0, u, 0]),
        columns: 2,
        rows: 2,
        west: -60,
        south: -60,
        stepLon: 120,
        stepLat: 120,
      };
      const [row] = traceStreamlines(field, { count: 1, seed: 5, baseMs: 0, cycleMs: 30_000 });
      const c: number[][] = coords(row);
      return Math.abs(c[c.length - 1][0] - c[0][0]);
    };

    expect(span(20) / span(2)).toBeCloseTo(10, 0);
  });

  it('spaces the vertices further apart as a streamline enters faster wind', () => {
    // Stepping by time makes every interval equal in *seconds*, so what has to
    // follow the local wind is the distance between vertices. That is also what
    // the eye reads as the trail accelerating: same time, more ground.
    const varying: WindField = {
      // Oeste flojo, este fuerte.
      data: Float32Array.from([1, 0, 20, 0, 1, 0, 20, 0]),
      columns: 2,
      rows: 2,
      west: 0,
      south: 0,
      stepLon: 4,
      stepLat: 4,
    };

    const [row] = traceStreamlines(varying, { count: 1, seed: 2, baseMs: 0, cycleMs: 10_000 });
    const c = coords(row);

    const gapAt = (i: number) => Math.abs(c[i + 1][0] - c[i][0]);

    expect(gapAt(c.length - 2)).toBeGreaterThan(gapAt(0));

    // Y los intervalos de tiempo sí son uniformes, que es lo que mantiene a
    // todas las líneas vivas durante el mismo ciclo.
    const times = c.map((vertex) => vertex[3]);
    expect(times[1] - times[0]).toBe(times[times.length - 1] - times[times.length - 2]);
  });
});

describe('traceStreamlines — continuous respawn', () => {
  it('spreads births through the cycle instead of restarting every line at once', () => {
    // With every line spanning the whole cycle they all reach the end together
    // and the layer blinks as kepler loops. Staggering the births within the
    // cycle makes the patch look like it is continuously simulating: some trails
    // fading out while others appear.
    const rows = traceStreamlines(uniformField(10, 2), {
      count: 60,
      seed: 21,
      baseMs: 0,
      cycleMs: 60_000,
      lifeFraction: 0.5,
    });

    const starts = rows.map((r) => coords(r)[0][3] as number);
    const ends = rows.map((r) => {
      const c = coords(r) as number[][];
      return c[c.length - 1][3] as number;
    });

    // Nacen repartidas, no todas en el instante cero.
    expect(new Set(starts).size).toBeGreaterThan(20);
    expect(Math.max(...starts)).toBeGreaterThan(20_000);

    // Y ninguna se sale del ciclo, que es el dominio de animación.
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ends)).toBeLessThanOrEqual(60_000);
  });

  it('still fills the cycle when no life fraction is given', () => {
    const rows = traceStreamlines(uniformField(10, 2), { count: 10, seed: 3, baseMs: 0, cycleMs: 60_000 });

    for (const row of rows) {
      const c = coords(row) as number[][];
      expect(c[0][3]).toBe(0);
      expect(c[c.length - 1][3]).toBe(60_000);
    }
  });
});

describe('traceStreamlines — lines cut short', () => {
  /**
   * A field so narrow that every particle leaves it long before its thirty
   * vertices are up: 0.01° is about 1.1 km, and at 100 m/s with a one-second
   * step a particle crosses it in a dozen.
   */
  const narrow: WindField = {
    data: Float32Array.from([100, 0, 100, 0, 100, 0, 100, 0]),
    columns: 2,
    rows: 2,
    west: 0,
    south: 0,
    stepLon: 0.01,
    stepLat: 0.01,
  };

  // 29 s over 29 steps is a step of exactly one second, and so exactly 1000 ms
  // between vertices for a line that runs its whole length.
  const options = { count: 20, seed: 5, baseMs: 0, cycleMs: 29_000, maxVertices: 30 };

  it('moves a line cut short at the same pace as a whole one in the same wind', () => {
    // The defect: every line was stretched over the same lifetime, so a line
    // with a third of the vertices spent three times as long on each of them
    // and crawled — right where a field has holes and edges.
    const drawn = traceStreamlines(narrow, { ...options, seamless: false });

    expect(drawn.length).toBeGreaterThan(0);
    for (const line of drawn) {
      expect(line.path.length).toBeLessThan(30);
      const times = line.path.map((vertex) => vertex[3]);
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1]).toBe(1000);
      }
    }
  });

  it('does not draw a short line a second time when it ends before the loop', () => {
    // The second drawing exists to carry a line across the seam. A line that is
    // over before the cycle is has nothing to carry, and a ghost of it a whole
    // cycle early is a line drawn where nothing is happening.
    const drawn = traceStreamlines(narrow, { ...options, lifeFraction: 1, seamless: true });

    for (const line of drawn) {
      const start = line.path[0][3];
      const end = line.path[line.path.length - 1][3];
      if (start < 0) {
        // A ghost: its twin must genuinely have overrun the cycle.
        expect(end + 29_000).toBeGreaterThan(29_000);
      }
    }
  });
});

describe('traceStreamlines — travel stays inside small patches', () => {
  it('shortens the travel when the data covers only a small patch of screen', () => {
    // 130 px of travel per cycle reads well across a country. Inside a patch a
    // few kilometres wide it is most of the patch, so the particles visibly
    // sweep out of it and the whole blob looks like it is drifting rather than
    // flowing in place. Capping the travel to a fraction of the patch's size on
    // screen keeps the loop where the data is.
    const spanOf = (west: number, east: number) => {
      const columns = Math.round((east - west) / 0.01) + 1;
      const data = new Float32Array(columns * 2 * 2);
      for (let i = 0; i < columns * 2; i++) {
        data[2 * i] = 6;
        data[2 * i + 1] = 0;
      }
      const field: WindField = {
        data,
        columns,
        rows: 2,
        west,
        south: 0,
        stepLon: 0.01,
        stepLat: east - west,
      };

      // Generoso a propósito: el recuento se escala por la cobertura, y un
      // parche diminuto con un presupuesto de una línea redondea a ninguna.
      const [row] = traceStreamlines(field, {
        count: 2000,
        seed: 4,
        baseMs: 0,
        cycleMs: 60_000,
        // Misma vista en ambos casos: sólo cambia cuánto de ella ocupa el dato.
        viewport: { west: -1, east: 1, south: -0.5, north: 1.5, widthPx: 1000, heightPx: 1000 },
      });

      const c: number[][] = coords(row);
      return Math.abs(c[c.length - 1][0] - c[0][0]);
    };

    const parcheGrande = spanOf(-0.8, 0.8);
    const parchePequeno = spanOf(-0.04, 0.04);

    expect(parchePequeno).toBeLessThan(parcheGrande / 3);
  });
});

describe('traceStreamlines — carrying the flow across the loop', () => {
  const CYCLE = 30_000;

  const lines = (seamless: boolean) =>
    traceStreamlines(uniformField(10, 2), {
      count: 400,
      seed: 4,
      baseMs: 0,
      cycleMs: CYCLE,
      lifeFraction: 0.55,
      seamless,
    });

  /** How many lines are mid-flight at a moment of the cycle. */
  const aliveAt = (drawn: Array<{ path: number[][] }>, t: number) =>
    drawn.filter((l) => l.path[0][3] <= t && t <= l.path[l.path.length - 1][3]).length;

  it('keeps the same number of lines alive from one end of the cycle to the other', () => {
    // The defect this exists for: with births clamped so no line outlives the
    // cycle, none is born in its last stretch and none has been alive long at
    // the start, so the field empties into the loop and refills out of it.
    const drawn = lines(true);
    const counts = [0, 0.25, 0.5, 0.75, 1].map((f) => aliveAt(drawn, f * CYCLE));

    expect(Math.min(...counts)).toBeGreaterThan(0.7 * Math.max(...counts));
  });

  it('empties at both ends without it, which is what it looks like', () => {
    const drawn = lines(false);

    expect(aliveAt(drawn, 0)).toBe(0);
    expect(aliveAt(drawn, CYCLE)).toBeLessThan(0.05 * aliveAt(drawn, CYCLE / 2));
  });

  it('draws the crossing lines twice, a whole cycle apart', () => {
    // The two are the same geometry either side of the loop: the first is
    // finishing as the playhead reaches the end, the second already mid-flight
    // the moment it wraps. deck reads a path's times as increasing, so one path
    // cannot do both.
    const drawn = lines(true);
    const ghosts = drawn.filter((l) => l.path[0][3] < 0);

    expect(ghosts.length).toBeGreaterThan(0);

    const twin = drawn.find(
      (l) => l.path[0][3] === ghosts[0].path[0][3] + CYCLE && l.speed === ghosts[0].speed
    );
    expect(twin).toBeDefined();
    // Same places, only the clock differs.
    expect(twin!.path.map((v) => [v[0], v[1]])).toEqual(ghosts[0].path.map((v) => [v[0], v[1]]));
  });

  it('spreads the births over the whole cycle rather than its first half', () => {
    const births = lines(true).map((l) => l.path[0][3]);
    const inLateCycle = births.filter((b) => b > 0.6 * CYCLE).length;

    expect(inLateCycle).toBeGreaterThan(0);
  });
});

describe('traceStreamlines — seeding through the camera', () => {
  /** A camera looking straight down at a box, mapping the screen onto it. */
  const cameraShowing = (box: { west: number; east: number; south: number; north: number }) => ({
    widthPx: 800,
    heightPx: 800,
    bounds: box,
    metresPerPixel: ((box.east - box.west) * 111_320) / 800,
    unproject: (x: number, y: number): [number, number] => [
      box.west + (x / 800) * (box.east - box.west),
      box.south + (1 - y / 800) * (box.north - box.south),
    ],
  });

  const field = uniformField(10, 2);
  const trace = (camera: ReturnType<typeof cameraShowing>, zoomResponse?: number) =>
    traceStreamlines(field, { count: 400, seed: 7, baseMs: 0, camera, zoomResponse });

  it('starts lines wherever the camera is looking, not where a flat box would be', () => {
    // The whole point of seeding by pixel: tilt the camera and the ground on
    // screen stops being a rectangle around the centre. Here the camera looks
    // at the top-right quarter of the field, and nothing should be seeded
    // outside it.
    const drawn = trace(cameraShowing({ west: 5, east: 9, south: 5, north: 9 }));

    expect(drawn.length).toBeGreaterThan(0);
    for (const line of drawn) {
      expect(line.path[0][0]).toBeGreaterThanOrEqual(5);
      expect(line.path[0][1]).toBeGreaterThanOrEqual(5);
    }
  });

  it('keeps the budget for the screen when the zoom response is 0', () => {
    // Esri's model, and what this drew before the knob existed: the same number
    // of lines whether the screen shows the whole field or a corner of it.
    // These two cameras show 81 and 4 square degrees, so a budget that followed
    // the ground would give the close one a twentieth of the lines — the case
    // the zoom-response-1 test below measures from the other side.
    const wide = trace(cameraShowing({ west: 0, east: 9, south: 0, north: 9 }), 0);
    const close = trace(cameraShowing({ west: 4, east: 6, south: 4, north: 6 }), 0);

    // Not tighter than half, because a ground cell's size is a power of two:
    // `levelFor` rounds the size this budget asks for to the nearest one, so
    // the cell can come back up to 1.41 times the size asked for and the count
    // — one over the square of it — as little as half the budget. These two
    // cameras round different ways, which is the whole of the gap between them
    // (342 lines against 272 here, both within that band of their own budget).
    // The threshold was 0.8 while the sample lattice still missed cells: the
    // wide camera missed 8% of its own and the close one none, which flattered
    // the ratio to 0.856 by losing lines rather than by placing them.
    expect(close.length).toBeGreaterThan(0.5 * wide.length);
  });

  it('spends the budget on the whole field when the zoom response is 1', () => {
    // Zooming in then shows only the share of the field that is on screen, so
    // the lines thin out and separate — what a person means by zooming in.
    const wide = trace(cameraShowing({ west: 0, east: 9, south: 0, north: 9 }), 1);
    const close = trace(cameraShowing({ west: 4, east: 6, south: 4, north: 6 }), 1);

    // A twentieth of the field's area is on screen, so a twentieth of the lines.
    expect(close.length).toBeLessThan(0.2 * wide.length);
  });

  // The budget test that used to live here compared two cameras that both
  // bottomed out at `levelFor`'s old one-degree floor, so it never actually
  // measured the budget — see "keeps the number of cells within budget at a
  // world-scale zoom" below, which replaces it with the real camera and the
  // zoom where that floor actually mattered.

  it('scales the advection by the whole field, so a pan across a speed gradient does not rescale a line', () => {
    // A line kept in the layer's per-hour cells map is reused on the next pan
    // as it was traced, so everything its geometry depends on has to be the
    // same after the pan as before it. The typical speed it is normalised
    // by was the median over the *visible* part of the field: panning from
    // slack air into a jet moved that median, and the lines kept from before
    // and the ones traced fresh beside them stepped five times apart
    // (measured across a 3 -> 15 m/s gradient).
    const gradient: WindField = {
      // 3 m/s along the west edge, 15 m/s along the east.
      data: Float32Array.from([3, 0, 15, 0, 3, 0, 15, 0]),
      columns: 2,
      rows: 2,
      west: 0,
      south: 0,
      stepLon: 10,
      stepLat: 10,
    };
    const traceThrough = (camera: ReturnType<typeof cameraShowing>) =>
      traceStreamlines(gradient, { count: 400, seed: 7, baseMs: 0, cycleMs: 60_000, camera });

    // The same scale, looking at the slack west and then the windy east; the
    // two views share the ground between 4° and 6°.
    const west = traceThrough(cameraShowing({ west: 0, east: 6, south: 2, north: 8 }));
    const east = traceThrough(cameraShowing({ west: 4, east: 10, south: 2, north: 8 }));

    const eastByCell = new Map(east.map((line) => [line.cell, line]));
    const shared = west.filter((line) => eastByCell.has(line.cell));
    expect(shared.length).toBeGreaterThan(10);
    for (const line of shared) {
      expect(eastByCell.get(line.cell)!.path).toEqual(line.path);
    }
  });

  it('draws nothing from a camera that shows no ground at all', () => {
    const sky = {
      widthPx: 800,
      heightPx: 800,
      bounds: { west: 0, east: 9, south: 0, north: 9 },
      metresPerPixel: 100,
      unproject: () => null,
    };

    expect(traceStreamlines(field, { count: 100, seed: 1, baseMs: 0, camera: sky })).toEqual([]);
  });
});

/**
 * A steady eastward field spanning enough ground for a real map camera.
 *
 * The file's `uniformField(u, v)` only spans ±10°, which is plenty when a test
 * also invents its own tiny coordinate system, but a camera centred on a real
 * place — Ecuador's, below — sits nowhere near that domain: every seed would
 * fall outside it and trace nothing. This is the same idea, a uniform wind
 * over a 2×2 grid, stretched to cover the whole Mercator range instead.
 */
function wideEastwardField(): WindField {
  return {
    data: Float32Array.from([8, 0, 8, 0, 8, 0, 8, 0]),
    columns: 2,
    rows: 2,
    west: -180,
    south: -85,
    stepLon: 360,
    stepLat: 170,
  };
}

describe('traceStreamlines — anchored to the ground', () => {
  const field = wideEastwardField();

  /** A camera over the field, as `flowFieldDeckLayer.makeScreenCamera` builds one. */
  function cameraOver(centre: [number, number], zoom: number, pitch = 0, bearing = 0): ScreenCamera {
    const viewport = new WebMercatorViewport({
      longitude: centre[0],
      latitude: centre[1],
      zoom,
      pitch,
      bearing,
      width: 800,
      height: 600,
    });
    const groundAt = (x: number, y: number): [number, number] | null => {
      const [lng, lat] = viewport.unproject([x, y]);
      return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) < 85 ? [lng, lat] : null;
    };
    const corners = [groundAt(0, 0)!, groundAt(800, 600)!];
    return {
      widthPx: 800,
      heightPx: 600,
      bounds: {
        west: Math.min(corners[0][0], corners[1][0]),
        east: Math.max(corners[0][0], corners[1][0]),
        south: Math.min(corners[0][1], corners[1][1]),
        north: Math.max(corners[0][1], corners[1][1]),
      },
      metresPerPixel: viewport.metersPerPixel,
      unproject: groundAt,
    };
  }

  /**
   * The density `flowFieldLayer.ts` actually ships, not a token count.
   *
   * At a few hundred lines a cell is many times wider than the sample lattice's
   * own step, so every cell on screen is landed on however crudely the lattice
   * is walked, and a reuse or evenness test measures nothing. At 9,000 a cell is
   * about six pixels across: the two lattices are the same order of size, which
   * is where every defect this block exists to catch actually shows.
   */
  const BASE = { count: 9_000, seed: 7, baseMs: 0, cycleMs: 60_000, lifeFraction: 0.5, maxVertices: 30 };

  /** Degrees of longitude per screen pixel at zoom 8 — deck's world is 512 px at zoom 0. */
  const DEG_PER_PX = 360 / (512 * Math.pow(2, 8));

  /**
   * What a pan of this many pixels may cost, as a share of the lines on screen.
   *
   * The whole point of anchoring a line to the ground is that a pan only pays
   * for the ground it brings on screen: a drag of `panPx` across an 800-pixel
   * panel uncovers a strip of `panPx/800` of it, and every line outside that
   * strip was already traced and must come back from the cache. Anything worse
   * is lines being lost to the sample lattice rather than to the pan — the
   * failure this test exists for, measured at 74.8% for a 3.6-pixel pan that
   * should have cost half a percent. One point of slack absorbs the cells
   * straddling the strip's own edge.
   */
  const reuseFloor = (panPx: number) => 1 - panPx / 800 - 0.01;

  function reuseAcross(panPx: number, pitch: number) {
    const cells = new Map<string, Streamline[] | null>();
    const before = traceStreamlines(field, { ...BASE, camera: cameraOver([-79, -2], 8, pitch), cells });
    const after = traceStreamlines(field, {
      ...BASE,
      camera: cameraOver([-79 + panPx * DEG_PER_PX, -2], 8, pitch),
      cells,
    });
    const kept = new Set(before.map((line) => line.cell));
    return { before, after, kept, shared: after.filter((line) => kept.has(line.cell)) };
  }

  it('keeps the lines it has already traced when the map is panned', () => {
    // What this ends: the seeds were pixels, so the same random sequence fell
    // on different ground and every line jumped at once.
    const { before, after, kept, shared } = reuseAcross(3.64, 0);

    expect(shared.length / after.length).toBeGreaterThan(reuseFloor(3.64));
    // And the ones that were kept are the same geometry, not a fresh trace.
    const sample = after.find((line) => kept.has(line.cell))!;
    expect(before.find((line) => line.cell === sample.cell)!.path[0]).toEqual(sample.path[0]);
  });

  it('pays for a pan only in the ground the pan uncovered', () => {
    // A drag is a sequence of small pans, and a tilted map is the case where
    // the sample lattice and the cell lattice disagree most, so both are
    // measured. Before the lattice was stepped to match the cells — and while
    // a jitter still carried each sample up to a whole step away from where
    // the walk put it — these came out at 74.8 / 73.2 / 68.8 flat and
    // 79.4 / 69.1 / 66.4 tilted: a 3.6-pixel pan, an 800th of the screen,
    // threw away a quarter of the field.
    for (const pitch of [0, 60]) {
      for (const panPx of [3.64, 10, 50]) {
        const { after, shared } = reuseAcross(panPx, pitch);
        expect(shared.length / after.length).toBeGreaterThan(reuseFloor(panPx));
      }
    }
  });

  it('keeps every band of a tilted screen through a pan, not just the near ones', () => {
    // The bands near the horizon are where a cell is flattest against the
    // screen, and they were the worst hit: band 0 reused 57.7% where the
    // screen as a whole managed 79.4%. A band that loses its lines on every
    // pan is a band that visibly reshuffles while the reader drags.
    const { after, kept } = reuseAcross(3.64, 60);
    const viewport = new WebMercatorViewport({
      longitude: -79 + 3.64 * DEG_PER_PX,
      latitude: -2,
      zoom: 8,
      pitch: 60,
      bearing: 0,
      width: 800,
      height: 600,
    });

    const total = new Array(8).fill(0);
    const reused = new Array(8).fill(0);
    for (const line of after) {
      const [x, y] = viewport.project([line.path[0][0], line.path[0][1]]);
      if (x < 0 || x > 800 || y < 0 || y > 600) {
        continue;
      }
      const band = Math.min(7, Math.floor((y / 600) * 8));
      total[band]++;
      if (kept.has(line.cell)) {
        reused[band]++;
      }
    }

    for (let band = 0; band < 8; band++) {
      expect(total[band]).toBeGreaterThan(0);
      expect(reused[band] / total[band]).toBeGreaterThan(reuseFloor(3.64));
    }
  });

  it('keeps most lines through a pan on a rotated map', () => {
    // No test above sets a bearing, which is why nothing caught this: taking
    // a lattice's pitch from a step's larger *compass* component reads the
    // step's own length correctly only when the two screen axes line up with
    // the two compass axes. Off that alignment the reading falls short —
    // worst at 45°, where a step splits evenly between both components and
    // each alone is only ~71% of the step's real length — so the lattice
    // stepped too far and checkerboarded across a cell's diagonal. Measured
    // on the code this guards against, a bearing of 45° kept only 69.9% of
    // lines through a 10 px pan where bearing 0 kept 98.6%.
    const bearing = 45;
    const turned = new WebMercatorViewport({
      longitude: -79,
      latitude: -2,
      zoom: 8,
      pitch: 0,
      bearing,
      width: 800,
      height: 600,
    });
    // Panned by where the screen's own point 10 px right of centre now sits
    // on the ground, not by a fixed shift in longitude — "right" is no
    // longer "east" once the map is turned, and this is what a drag under
    // rotation actually moves.
    const panned = turned.unproject([800 / 2 + 10, 600 / 2]) as [number, number];

    const cells = new Map<string, Streamline[] | null>();
    const before = traceStreamlines(field, { ...BASE, camera: cameraOver([-79, -2], 8, 0, bearing), cells });
    const after = traceStreamlines(field, { ...BASE, camera: cameraOver(panned, 8, 0, bearing), cells });

    const kept = new Set(before.map((line) => line.cell));
    const shared = after.filter((line) => kept.has(line.cell));
    expect(shared.length / after.length).toBeGreaterThan(0.9);
  });

  it('fills a tilted screen from top to bottom', () => {
    // A ground lattice with one step for the whole screen piles its lines up
    // against the horizon: measured on kepler's, 4,580 in the top quarter of
    // the screen against 272 in the bottom. Sizing a band's cells from the
    // east-west ground per pixel alone only halves that — at this density it
    // left the top quarter with 7,161 against the bottom's 1,932, a ratio of
    // 3.71 — because a tilt stretches the *other* axis, which an east-west
    // measurement cannot see.
    const camera = cameraOver([-79, -2], 8, 60);
    const viewport = new WebMercatorViewport({
      longitude: -79,
      latitude: -2,
      zoom: 8,
      pitch: 60,
      bearing: 0,
      width: 800,
      height: 600,
    });

    const lines = traceStreamlines(field, { ...BASE, camera });
    const bands = [0, 0, 0, 0];
    for (const line of lines) {
      const [x, y] = viewport.project([line.path[0][0], line.path[0][1]]);
      if (x < 0 || x > 800 || y < 0 || y > 600) {
        continue;
      }
      bands[Math.min(3, Math.floor((y / 600) * 4))]++;
    }

    const most = Math.max(...bands);
    const least = Math.min(...bands);
    expect(least).toBeGreaterThan(0);
    expect(most / least).toBeLessThan(3);
    // And specifically not top-heavy: the quarter nearest the horizon is the
    // one the old sizing packed solid, and it is the one a reader sees as a
    // band of mush across the distance.
    expect(bands[0]).toBeLessThan(bands[3] * 1.5);
  });

  it('lets the budget set the line count, not the cell tiling', () => {
    // `count` is a budget per screen. It stopped being one when the cells
    // took over the seeding: 11,002 lines flat and 17,822 at a pitch of 60
    // against a budget of 9,000, each one a full 30-vertex trace, and the
    // tilted camera the more expensive of the two — precisely backwards,
    // since a tilt shows the distance at a coarser scale, not a finer one.
    //
    // What holds is that *every* count stays inside the cell lattice's own
    // quantisation of the budget. `levelFor` rounds a cell to a power of two,
    // so the cell it returns is between 0.71 and 1.41 times the size asked
    // for, and the count — one over the square of that — between half the
    // budget and twice it. Closing that band needs a cell size that is not a
    // power of two, which `groundCells.ts` owns and this module cannot reach.
    //
    // What does *not* hold is any ratio between the tilted count and the flat
    // one, which is what this test asserted until the sweep below was run.
    // Flat and tilted round to different levels, and which way each rounds
    // moves with the zoom, so their ratio swings while both stay in the band:
    // measured from zoom 6 to 11 in quarter steps, the flat count runs from
    // 0.59x the budget to 1.66x while the tilted one only runs 1.10x to 1.31x,
    // and tilted/flat reaches 1.92 at zooms 6.75, 7.75, 8.75 and 9.75. An
    // assertion of 1.25 there passed at zoom 8 by coincidence and failed on
    // cameras a reader can reach with one scroll. Judging the tilt against a
    // flat count that dips with the rounding measures the rounding, not the
    // tilt — which is why the bound below is against the budget, not a ratio.
    //
    // Four quarter-zooms, because the quantisation is periodic in zoom with a
    // period of one — zoom 9 tiles exactly as zoom 8 does — so these four
    // walk the whole cycle. Flat keeps the wider [0.5, 2] band a camera
    // looking straight down has always carried — measured here, z8 alone
    // reaches 1.66x, the same power-of-two rounding as always, nothing to do
    // with a tilt. A tilt must not add to that ceiling: every tilted count at
    // these four zooms measured at most 1.30x, well inside [0.5, 1.5], so
    // that is the band it is held to. Sizing a cell from the east-west ground
    // per pixel alone instead of the area under a pixel — the defect this
    // test exists for — puts the tilted count at 2.63x, 2.39x, 2.20x and
    // 2.23x of the budget at these same four zooms, over both ceilings.
    for (const zoom of [8, 8.25, 8.5, 8.75]) {
      for (const pitch of [0, 60]) {
        const lines = traceStreamlines(field, {
          ...BASE,
          camera: cameraOver([-79, -2], zoom, pitch),
        });

        expect(lines.length).toBeGreaterThan(BASE.count * 0.5);
        expect(lines.length).toBeLessThan(BASE.count * 2);
        if (pitch !== 0) {
          expect(lines.length).toBeLessThan(BASE.count * 1.5);
        }
      }
    }
  });

  it('keeps the number of cells within budget at a world-scale zoom', () => {
    // `levelFor` was floored at one degree — no cell coarser than that —
    // which is fine at the zoom this module was built for, but a camera
    // pulled back to see most of the planet covers many degrees per pixel,
    // and the floor stopped the cells from growing to match: on the commit
    // this guards against, that asked for 29,715 cells at zoom 1 and 51,009
    // at zoom 0.5, against a budget of 9,000 (verified by running this
    // exact assertion against that commit — it fails, at both zooms). The
    // test this replaces compared two cameras that both bottomed out at
    // that same one-degree floor, so it never actually measured the budget.
    //
    // Cells, not lines: `seamless` draws a line twice when it crosses the
    // loop, a cost this module pays on purpose (see `emit`'s own doc
    // comment), not one the seeding lattice should be charged for.
    const budget = 9_000;
    for (const zoom of [0.5, 1]) {
      const cells = new Map<string, Streamline[] | null>();
      traceStreamlines(field, { ...BASE, count: budget, camera: cameraOver([-79, -2], zoom), cells });

      // Floored as well as capped: a cell that grew too far would tile the
      // planet in a handful of them and pass a one-sided assertion while
      // drawing almost nothing. Measured here, 7,577 cells at zoom 0.5 and
      // 10,293 at zoom 1 — the same half-to-twice band the budget test above
      // holds the ordinary zooms to, and for the same reason.
      expect(cells.size).toBeGreaterThan(budget * 0.5);
      expect(cells.size).toBeLessThan(budget * 1.5);
    }
  });

  it('keeps a non-seamless line born before the cycle ends', () => {
    // None of the camera tests above set `cycleMs`, so none of them could
    // have caught this: a non-seamless line's birth has to land inside
    // `[0, cycleMs - life]`, the window `birthWithin` itself is limited to,
    // or the line is still alive when the cycle loops with no second
    // emission to carry it across the seam — the exact cut trail
    // `seamless: false` exists to avoid. Mapping a cell's raw phase
    // straight onto the whole cycle regardless of that window was the
    // regression: a high-phase cell would be born late enough to run well
    // past the end of a 60 s cycle.
    const lines = traceStreamlines(field, {
      ...BASE,
      camera: cameraOver([-79, -2], 8),
      seamless: false,
    });

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const birth = line.path[0][3];
      const end = line.path[line.path.length - 1][3];
      expect(birth).toBeGreaterThanOrEqual(BASE.baseMs);
      expect(end).toBeLessThanOrEqual(BASE.baseMs + BASE.cycleMs);
    }
  });

  it("gives a cell its birth from its own phase, not from the order it was traced in", () => {
    // Isolates the property that keeps a re-traced line from restarting
    // under the reader: deleting `phaseOf` from the camera branch breaks
    // nothing that the reuse tests above would catch, because a shared
    // `cells` cache just hands the second call back the same cached object
    // regardless of what decided its birth the first time. Two independent
    // calls with no cache, over the same camera but different seeds, visit
    // the same cells in the same order either way — the order comes from
    // walking the screen, not from `options.seed` — so a birth that came
    // from the random draw order rather than from the cell's own phase
    // would still happen to match between them. Comparing the vertex time
    // itself, not just the geometry, is what actually pins the phase down.
    const camera = cameraOver([-79, -2], 8);
    const first = traceStreamlines(field, { ...BASE, camera, seed: 1 });
    const second = traceStreamlines(field, { ...BASE, camera, seed: 2 });

    const birthOf = new Map(first.map((line) => [line.cell, line.path[0][3]]));
    const shared = second.filter((line) => birthOf.has(line.cell));
    expect(shared.length).toBeGreaterThan(0);
    for (const line of shared) {
      expect(line.path[0][3]).toBe(birthOf.get(line.cell));
    }

    // A constant phase passes every check above: it is still "the same
    // value both times", since `first` and `second` visit the same cells
    // in the same order and a constant does not depend on which cell it is
    // asked for. What no constant can do is spread the births out — a real,
    // per-cell phase should scatter them across most of the cycle, and a
    // constant collapses them onto a single instant.
    const distinctBirths = new Set(first.map((line) => line.path[0][3])).size;
    expect(distinctBirths).toBeGreaterThan(first.length / 2);
  });
});

describe('traceStreamlines — over terrain', () => {
  const field = uniformField(10, 0);
  // Seeded to the west of 0.5° and pinned there with `expandFactor: 1`, so the
  // first vertex lands somewhere predictable rather than anywhere in the
  // field's whole ±10° domain.
  const BASE = {
    count: 1,
    seed: 1,
    baseMs: 0,
    viewport: { west: -1, south: -1, east: 0.4, north: 1, widthPx: 800, heightPx: 800 },
    expandFactor: 1,
  };

  it('gives every vertex the height under it', () => {
    const lines = traceStreamlines(field, {
      ...BASE,
      altitudeAt: (lon: number) => 1000 + lon * 10,
    });
    const [lon, , height] = lines[0].path[0];
    expect(height).toBeCloseTo(1000 + lon * 10, 5);
  });

  it('carries the last height it knew across a hole', () => {
    // `trace()` never reads `altitudeAt` — see its own doc comment — so the
    // lon/lat of every vertex is exactly the same whatever this call answers.
    // A reference trace whose `altitudeAt` never returns null records that
    // real path, and the hole's boundary is placed *on* it rather than
    // guessed at from the seed and the field: guessing is what let the
    // original version of this test pass without ever reaching the hole it
    // meant to test (a 3.6-pixel-scale seed near lon ≈ -0.12 never advanced
    // past lon ≈ 0.13 in 30 vertices, so `lon > 0.5` was never true).
    const reference = traceStreamlines(field, { ...BASE, altitudeAt: () => 0 })[0];
    const lons = reference.path.map((vertex) => vertex[0]);
    expect(lons.length).toBeGreaterThan(4);

    // A steady eastward wind moves lon strictly upward from one vertex to the
    // next (see "traces a streamline..." above), so a point strictly between
    // two consecutive vertices is a hard line: everything up to it still sees
    // the ground, everything from there on has fallen into the hole.
    const mid = Math.floor(lons.length / 2);
    const boundary = (lons[mid - 1] + lons[mid]) / 2;

    const lines = traceStreamlines(field, {
      ...BASE,
      altitudeAt: (lon: number) => (lon > boundary ? null : 700),
    });
    const path = lines[0].path;

    // The hole is genuinely entered, not merely declared in the setup.
    const firstInHole = path.findIndex((vertex) => vertex[0] > boundary);
    expect(firstInHole).toBeGreaterThan(0);

    // Every vertex before the boundary reads 700 straight off `altitudeAt`;
    // every vertex from the boundary on carries whatever the line last read,
    // which happens to be 700 throughout, so this also catches a height
    // invented at the hole rather than carried into it.
    for (const [, , height] of path) {
      expect(height).toBe(700);
    }
    // And specifically: the first vertex inside the hole carries exactly what
    // the vertex immediately before it had, not a fresh answer and not a
    // dropped one.
    expect(path[firstInHole][2]).toBe(path[firstInHole - 1][2]);
  });
});
