import { WindField } from './buildWindField';
import { traceStreamlines } from './traceStreamlines';

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
