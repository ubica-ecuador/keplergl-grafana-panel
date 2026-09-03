#!/usr/bin/env python3
"""Build the fixtures for the "HydroSHEDS" dashboard (provisioning-sources).

    python3 -m venv .venv && .venv/bin/pip install duckdb
    .venv/bin/python testdata/make-hydrodata.py

Two of the dashboard's four maps animate water moving downstream, and that is
the whole reason this file exists. The static river network needs no ETL at all
-- HydroSHEDS v2 is published as a public ArcGIS feature service in Esri's
Living Atlas, and the dashboard reads it live through Infinity, the same way
aqueduct.json reads WRI's. But v2 carries no discharge and no distance to the
sea, and without one of those there is nothing to animate: a river network is a
pile of lines until you know which way and how fast.

HydroRIVERS v1 carries both. It is coarser (15 arc-seconds against v2's 1) and
that difference is visible when you zoom in, which the dashboard's header panel
says out loud. In exchange it gives DIS_AV_CMS (mean discharge, m3/s) and
DIST_DN_KM (kilometres to the river mouth), and the second one is the find:
measured over all 3,012,534 upstream/downstream pairs in the Americas it is
strictly monotone decreasing downstream, every single one, with a mean drop per
reach (2.503 km) that matches the mean reach length (2.494 km). That makes it a
ready-made clock. No recursive descent of NEXT_DOWN, no graph traversal at all
-- subtract it from its own maximum and you have how far this water has come.

Vertex order is the other thing that had to be checked rather than assumed, and
it holds: in 72,656 of 72,656 pairs the last vertex of a reach is the first
vertex of the reach below it. The geometry already runs upstream to downstream,
so nothing here reverses anything.

Why a local ETL at all, when this repository prefers to read live (see the
docstring of make-firedata.py for the same argument): the source is a zipped
Esri file geodatabase, and DuckDB cannot read one over HTTP. `ST_Read` on
`/vsizip//vsicurl/https://...` does not fail with an error, it **segfaults the
process**. Downloading the four regional archives -- 220 MB, cached -- and
reading them locally through `/vsizip/` works, needs no GDAL and no geopandas,
and takes about 18 seconds for all 3,068,592 reaches.

Outputs land in testdata/hydro/ and are NOT committed. As in make-testdata.py
and make-ancestrydata.py the run is deterministic -- no RNG anywhere, and a
*total* ORDER BY on every output, because ties left unbroken get reordered by
DuckDB's parallel writer between runs and the point of not committing derived
Parquet is that regenerating it produces no diff.
"""

import sys
import urllib.request
from pathlib import Path

import duckdb

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
OUT = HERE / "hydro"

BASE = "https://data.hydrosheds.org/file/HydroRIVERS"

# The four archives that together cover the Americas. Greenland is included
# because the Esri service covers it and a map that stops at its coast looks
# like a bug rather than a choice.
REGIONS = {
    "sa": "South America",
    "na": "North and Central America",
    "ar": "Arctic (northern Canada)",
    "gr": "Greenland",
}

# The decomposition network. Strahler order never decreases downstream, so any
# `ORD_STRA >= k` cut is closed under going downstream: every reach in it reaches
# the sea through other reaches in it. That is what makes it safe to decompose
# once at 4 and let the dashboard filter to 6 or 7 later -- filtering a path by
# order leaves a contiguous *suffix* of it, never a hole in the middle.
MIN_PATH_ORDER = 4

# ~0.02 deg is about 2 km, well under a pixel at the zooms the static network is
# looked at. Simplifying before the merge is what keeps 390,290 reaches down to
# 414,773 vertices.
NETWORK_TOLERANCE = 0.02

# A ~110 m coordinate grid. Purely a transport saving and a large one: three
# decimals instead of fifteen halves the GeoJSON, 16.4 MB to 7.3.
NETWORK_PRECISION = 0.001

# The animated layer carries every vertex as its own row, so it is simplified
# harder than the static one and cut to the trunk. ~0.01 deg is about 1.1 km.
TRIP_TOLERANCE = 0.01

# The widest set the dashboard's `ordenTrip` variable can ask for.
MIN_TRIP_ORDER = 6

# Seven hues, not eight. The repository already measured that ceiling for the
# ancestry dot map, and a river network has the same all-pairs problem: any two
# basins can end up adjacent. Basins are coloured by a hash of MAIN_RIV rather
# than by any ordered quantity -- neighbouring basins landing on different hues
# is the whole point, because that is what makes the drainage divides visible.
BASIN_HUES = 7

# Three velocity-field resolutions, switched by the dashboard's `campo` variable.
# See build_flow_field() for why these grids have to be dilated at all; the
# radius is the reason there are three of them rather than one.
#
#   (grid step in degrees, minimum discharge m3/s, dilation radius in cells)
#
# The tracer advances a particle by a fixed number of *pixels* per cycle, so on
# the ground its step grows with the zoom: about 67 km per vertex across the
# whole of the Americas, against 0.4 km over a single basin. A step longer than
# the corridor is half a corridor wide throws the particle straight out of the
# river into a hole, where the trace ends after two vertices -- which is exactly
# what the continental view looked like on the 0.1 deg grid: a field of dots.
# So the coarse grid is not a lower-quality version of the fine one, it is the
# one whose 83 km corridors a continental step can stay inside.
#
# Measured: 0250 -> 49,765 rows, 90% of cells interpolable, 83 km half-width;
# 0100 -> 127,053 rows, 77%, 22 km; 0050 -> 149,297 rows, 82%, 11 km. Each
# builds in about a second.
FIELDS = {
    "0250": (0.25, 100.0, 3),
    "0100": (0.1, 100.0, 2),
    "0050": (0.05, 500.0, 3),
}

# Metres per second, and the floor is not cosmetic: traceStreamlines drops any
# streamline whose speed falls below its `minSpeed` default of 0.5, so a cell
# under that draws nothing at all. Real rivers run roughly 0.3-2 m/s and the
# log keeps the Amazon from dwarfing everything else.
SPEED_SQL = "least(2.0, greatest(0.6, 0.3 + 0.35 * log10(1 + dis)))"


def fetch(url: str, dest: Path) -> Path:
    """Download once into the cache. HydroRIVERS v1.0 is frozen -- 2022 data."""
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  cached  {dest.name}  {dest.stat().st_size / 1e6:.0f} MB")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  fetch   {dest.name} <- {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    urllib.request.urlretrieve(url, tmp)
    tmp.rename(dest)
    return dest


def download_inputs() -> None:
    print("Inputs:")
    for region in REGIONS:
        fetch(f"{BASE}/HydroRIVERS_v10_{region}.gdb.zip", CACHE / f"HydroRIVERS_v10_{region}.gdb.zip")


def connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    # OpenFileGDB ships with the spatial extension's bundled GDAL, so the zipped
    # Esri geodatabases need nothing else installed.
    con.execute("INSTALL spatial; LOAD spatial;")
    return con


def load_reaches(con: duckdb.DuckDBPyConnection) -> None:
    """Read the four archives into one table of reaches.

    ST_LineMerge collapses the single-part MultiLineStrings HydroRIVERS stores
    into plain LineStrings, which is what lets ST_Points below return the
    vertices in order. ST_Force2D drops a Z ordinate that is always zero.
    """
    for i, region in enumerate(REGIONS):
        path = CACHE / f"HydroRIVERS_v10_{region}.gdb.zip"
        verb = "CREATE OR REPLACE TABLE reaches AS" if i == 0 else "INSERT INTO reaches"
        con.execute(
            f"""
            {verb}
            SELECT '{region}' AS region,
                   HYRIV_ID, NEXT_DOWN, MAIN_RIV,
                   LENGTH_KM, DIST_DN_KM, UPLAND_SKM,
                   DIS_AV_CMS, ORD_STRA,
                   ST_LineMerge(ST_Force2D(Shape)) AS g
            FROM ST_Read('/vsizip/{path}')
            """
        )
        total = con.execute("SELECT count(*) FROM reaches").fetchone()[0]
        print(f"  {region}  {REGIONS[region]:<28} total {total:,}")


def build_paths(con: duckdb.DuckDBPyConnection) -> None:
    """Cut the river network into continuous paths, source to sea.

    This is the change that made the animation work at all. Drawn one reach per
    trip, a comet can only travel the reach's own ~2.5 km, which at a continental
    zoom is a fifth of a pixel: what appeared on screen was a field of blinking
    specks, not water going anywhere. A path is a real river -- the longest is
    5,680 km of the Mississippi, 1,362 reaches end to end -- so a comet released
    on one actually travels down it.

    The cut is the standard main-stem decomposition. Every reach keeps exactly
    one upstream continuation, the tributary with the largest upstream area; the
    other tributaries at a confluence start paths of their own. That partitions
    the network -- every reach on exactly one path, no reach on two -- and every
    path is geometrically contiguous, which is what lets the merge in
    build_network() collapse each one into a single LineString.

    Verified on the result at ORD_STRA >= 4: 390,290 reaches, 17,066 paths, no
    reach duplicated, none missing, and **zero joints wider than 2 km** between
    consecutive reaches of a path.
    """
    con.execute(
        f"""
        CREATE OR REPLACE TABLE net AS
        SELECT * FROM reaches WHERE ORD_STRA >= {MIN_PATH_ORDER}
        """
    )
    # NEXT_DOWN = 0 marks an outlet, so it is not a real downstream id.
    con.execute(
        """
        CREATE OR REPLACE TABLE main_up AS
        SELECT NEXT_DOWN AS down_id, max_by(HYRIV_ID, UPLAND_SKM) AS up_id
        FROM net WHERE NEXT_DOWN <> 0 GROUP BY NEXT_DOWN
        """
    )
    con.execute(
        """
        CREATE OR REPLACE TABLE path_members AS
        WITH RECURSIVE
        -- A path begins wherever no reach continues into this one: a headwater,
        -- or a reach whose tributaries are all below the order cut.
        starts AS (
            SELECT n.HYRIV_ID FROM net n
            WHERE NOT EXISTS (SELECT 1 FROM main_up m WHERE m.down_id = n.HYRIV_ID)
        ),
        walk AS (
            SELECT HYRIV_ID AS path_id, HYRIV_ID AS reach_id, 0 AS step FROM starts
            UNION ALL
            SELECT w.path_id, n.NEXT_DOWN, w.step + 1
            FROM walk w
            JOIN net n ON n.HYRIV_ID = w.reach_id
            JOIN main_up m ON m.down_id = n.NEXT_DOWN AND m.up_id = n.HYRIV_ID
        )
        SELECT * FROM walk
        """
    )
    reaches, paths, longest = con.execute(
        """
        SELECT count(*), count(DISTINCT path_id),
               (SELECT round(max(km)) FROM (
                    SELECT sum(n.LENGTH_KM) AS km FROM path_members p
                    JOIN net n ON n.HYRIV_ID = p.reach_id GROUP BY p.path_id))
        FROM path_members
        """
    ).fetchone()
    print(f"  {reaches:,} reaches on {paths:,} paths, longest {longest:,.0f} km")


def build_network(con: duckdb.DuckDBPyConnection) -> None:
    """One row per river, its whole course as a single LineString.

    The static network is what the two animated maps are drawn *on*. Without it
    the particles float over a black continent with nothing to be flowing along,
    which is most of why the first version read as confetti.

    Merging by path rather than emitting one feature per reach is what makes it
    affordable: 390,290 features become 17,066, carrying the same 414,773
    vertices. ST_LineMerge returns a plain LineString for every one of them,
    which is the decomposition's contiguity showing up as a postcondition.
    """
    con.execute(
        f"""
        CREATE OR REPLACE TABLE network AS
        SELECT p.path_id,
               max_by(n.MAIN_RIV, n.UPLAND_SKM) AS rio,
               max(n.ORD_STRA)   AS orden,
               max(n.DIS_AV_CMS) AS caudal,
               sum(n.LENGTH_KM)  AS km,
               ST_ReducePrecision(
                   ST_LineMerge(ST_Collect(list(
                       ST_SimplifyPreserveTopology(n.g, {NETWORK_TOLERANCE}) ORDER BY p.step))),
                   {NETWORK_PRECISION}) AS g
        FROM path_members p
        JOIN net n ON n.HYRIV_ID = p.reach_id
        GROUP BY p.path_id
        """
    )
    rows, verts, mb = con.execute(
        """
        SELECT count(*), sum(ST_NPoints(g)), sum(length(ST_AsGeoJSON(g))) / 1048576.0
        FROM network
        """
    ).fetchone()
    print(f"  {rows:,} rivers, {verts:,} vertices, {mb:.1f} MB of GeoJSON")


def build_path_vertices(con: duckdb.DuckDBPyConnection) -> None:
    """One row per vertex, in the order the water passes it.

    `avance_km` is the animation's clock, and it stays defined globally --
    max(DIST_DN_KM) - DIST_DN_KM + distance along the reach -- rather than as a
    distance from each path's own start. That is deliberate: DIST_DN_KM is
    continuous across confluences, so a global measure keeps a tributary and the
    trunk it joins in phase. Per-path distances would put them out of step and
    every junction would show a visible seam.

    Reaches meet at a shared point, so the second copy is dropped; deck.gl
    tolerates a zero-length step but it costs a row per reach for nothing.

    The step is geodesic. A degree of longitude is 111 km at the equator and 30
    in the Canadian Arctic, and this dataset spans both.
    """
    con.execute(
        f"""
        CREATE OR REPLACE TABLE path_vertices AS
        WITH ordered AS (
            SELECT p.path_id, p.step,
                   n.HYRIV_ID, n.MAIN_RIV, n.DIS_AV_CMS, n.ORD_STRA, n.DIST_DN_KM,
                   ST_SimplifyPreserveTopology(n.g, {TRIP_TOLERANCE}) AS g
            FROM path_members p
            JOIN net n ON n.HYRIV_ID = p.reach_id
            WHERE n.ORD_STRA >= {MIN_TRIP_ORDER}
        ),
        pts AS (
            SELECT o.*, u.i AS vi, ST_X(u.d.geom) AS lon, ST_Y(u.d.geom) AS lat
            FROM ordered o, unnest(ST_Dump(ST_Points(o.g))) WITH ORDINALITY AS u(d, i)
        ),
        stepped AS (
            SELECT *,
                   coalesce(ST_Distance_Sphere(
                       ST_Point(lag(lon) OVER w, lag(lat) OVER w), ST_Point(lon, lat)
                   ) / 1000.0, 0.0) AS step_km
            FROM pts
            WINDOW w AS (PARTITION BY HYRIV_ID ORDER BY vi)
        ),
        located AS (
            SELECT path_id, step, vi, lat, lon,
                   MAIN_RIV, DIS_AV_CMS, ORD_STRA, DIST_DN_KM,
                   (SELECT max(DIST_DN_KM) FROM reaches) - DIST_DN_KM
                       + sum(step_km) OVER (PARTITION BY HYRIV_ID ORDER BY vi) AS avance_km
            FROM stepped
        )
        SELECT path_id,
               row_number() OVER (PARTITION BY path_id ORDER BY step, vi) AS seq,
               lat AS latitude,
               lon AS longitude,
               DIS_AV_CMS AS caudal,
               ORD_STRA   AS orden,
               MAIN_RIV   AS rio,
               round(DIST_DN_KM)::INTEGER AS dist_mar_km,
               avance_km
        FROM located
        -- Consecutive reaches share their joint, so the same point arrives twice.
        QUALIFY lag(lat) OVER (PARTITION BY path_id ORDER BY step, vi) IS DISTINCT FROM lat
             OR lag(lon) OVER (PARTITION BY path_id ORDER BY step, vi) IS DISTINCT FROM lon
        """
    )
    verts, paths, span = con.execute(
        "SELECT count(*), count(DISTINCT path_id), round(max(avance_km)) FROM path_vertices"
    ).fetchone()
    print(f"  {verts:,} vertices on {paths:,} paths, {span:,.0f} km from the furthest headwater")


def build_flow_field(con: duckdb.DuckDBPyConnection, name: str, step: float, threshold: float, radius: int) -> None:
    """A regular lat/lon grid of water velocity, for the streamline layer.

    The panel already knows how to animate one of these: a query returning
    lat/lon/u/v with no trip id is picked up by detectFields, assembled by
    buildWindField, blurred by smoothWindField and traced by traceStreamlines.
    So the only job here is to turn a network of lines into a field of vectors.

    Each consecutive pair of vertices gives a unit vector pointing downstream;
    those get averaged per grid cell weighted by discharge, so where a big river
    and a creek share a cell the big one wins. The eastward component is scaled
    by cos(lat) -- a degree of longitude is not a degree of latitude, and
    without it every river in the Arctic would appear to run east.

    Then the field is **dilated**, and that step is not optional. sampleWindField
    interpolates bilinearly and refuses a cell if any of its four corners is a
    hole, which is correct -- it is what stops wind being drawn through a
    mountain. But a river is one cell wide, so a grid of only river cells has
    almost no complete 2x2 block anywhere and the tracer draws nothing at all.
    Spreading each cell's vector over a disc of neighbouring cells, weighted by
    1/(1+distance), widens rivers into corridors the tracer can follow.
    Measured: 69% of cells interpolable at radius 1, 75% at 2, 82% at 3.
    """
    r2 = radius * radius
    con.execute(
        f"""
        CREATE OR REPLACE TABLE field_{name} AS
        WITH pts AS (
            SELECT HYRIV_ID, DIS_AV_CMS, u.i AS i,
                   ST_X(u.d.geom) AS lon, ST_Y(u.d.geom) AS lat
            FROM reaches, unnest(ST_Dump(ST_Points(g))) WITH ORDINALITY AS u(d, i)
            WHERE DIS_AV_CMS >= {threshold}
        ),
        seg AS (
            SELECT a.DIS_AV_CMS AS dis,
                   (a.lon + b.lon) / 2 AS lon,
                   (a.lat + b.lat) / 2 AS lat,
                   (b.lon - a.lon) * cos(radians((a.lat + b.lat) / 2)) AS dx,
                   b.lat - a.lat AS dy
            FROM pts a
            JOIN pts b ON a.HYRIV_ID = b.HYRIV_ID AND b.i = a.i + 1
        ),
        unit AS (
            SELECT dis, lon, lat, dx / len AS ex, dy / len AS ey
            FROM (SELECT *, sqrt(dx * dx + dy * dy) AS len FROM seg)
            WHERE len > 0
        ),
        cell AS (
            SELECT floor(lon / {step})::INTEGER AS cx,
                   floor(lat / {step})::INTEGER AS cy,
                   sum(dis * ex) / sum(dis) AS ex,
                   sum(dis * ey) / sum(dis) AS ey,
                   max(dis) AS dis
            FROM unit
            GROUP BY 1, 2
        ),
        ring AS (
            SELECT dxi, dyi
            FROM generate_series(-{radius}, {radius}) t1(dxi),
                 generate_series(-{radius}, {radius}) t2(dyi)
            WHERE dxi * dxi + dyi * dyi <= {r2}
        ),
        spread AS (
            SELECT c.cx + ring.dxi AS cx,
                   c.cy + ring.dyi AS cy,
                   c.ex, c.ey, c.dis,
                   1.0 / (1.0 + sqrt(ring.dxi * ring.dxi + ring.dyi * ring.dyi)) AS w
            FROM cell c, ring
        ),
        merged AS (
            SELECT cx, cy,
                   sum(w * dis * ex) / sum(w * dis) AS ex,
                   sum(w * dis * ey) / sum(w * dis) AS ey,
                   max(dis) AS dis
            FROM spread
            GROUP BY 1, 2
        ),
        speeded AS (
            SELECT *,
                   sqrt(ex * ex + ey * ey) AS len,
                   {SPEED_SQL} AS speed
            FROM merged
        )
        SELECT
            -- Cell centres, so the values land exactly on the lattice axisOf
            -- infers. Rounding keeps float noise well inside its 5% tolerance.
            --
            -- The DOUBLE cast is load-bearing: a bare 0.1 is a DECIMAL literal
            -- in DuckDB, which makes the product DECIMAL, and the data source's
            -- Go driver does not hand those to Grafana as numbers.
            round((cy + 0.5) * CAST({step} AS DOUBLE), 6) AS lat,
            round((cx + 0.5) * CAST({step} AS DOUBLE), 6) AS lon,
            round(ex / len * speed, 4) AS u,
            round(ey / len * speed, 4) AS v,
            round(dis, 1) AS caudal
        FROM speeded
        WHERE len > 0
        """
    )
    rows, nlat, nlon = con.execute(
        f"""
        SELECT count(*),
               (max(lat) - min(lat)) / CAST({step} AS DOUBLE) + 1,
               (max(lon) - min(lon)) / CAST({step} AS DOUBLE) + 1
        FROM field_{name}
        """
    ).fetchone()
    print(f"  {name}  {step}deg, >={threshold:.0f} m3/s, r={radius}: "
          f"{rows:,} cells on a {round(nlon):,}x{round(nlat):,} lattice")


# The dozen basins whose mouths are unmistakable, so the ranking table reads as
# rivers rather than as a column of integers. HydroRIVERS carries no names at
# all -- MAIN_RIV is just an id -- and these were assigned by matching each
# basin's outlet coordinate, upstream area and length against the published
# figures. Everything below them stays unnamed on purpose: naming a basin from
# its outlet alone stops being reliable once the big ones are gone.
BASIN_NAMES = {
    60443230: "Amazonas",
    60023012: "Orinoco",
    70814357: "Mississippi",
    61504467: "Paraná",
    70367865: "San Lorenzo",
    60545016: "Tocantins-Araguaia",
    80044492: "Mackenzie",
    70386275: "Columbia",
    60001946: "Magdalena",
    80176904: "Yukon",
    61494133: "Uruguay",
    60078950: "Essequibo",
    70283328: "Fraser",
    70897360: "Grijalva-Usumacinta",
    61026669: "São Francisco",
    70045262: "Nelson",
    70790485: "Mobile",
    60030949: "Atrato",
}


def build_rivers(con: duckdb.DuckDBPyConnection) -> None:
    """One row per main river, for the ranking table beside the maps.

    MAIN_RIV is HydroRIVERS' id for a whole basin. Discharge only grows
    downstream, so max(DIS_AV_CMS) over the basin is the discharge at its mouth
    and max(DIST_DN_KM + LENGTH_KM) is the length of its longest path.

    The mouth's coordinates come from the reach with DIST_DN_KM = 0, not from
    the one with the largest discharge. On a single channel those are the same
    reach; on a delta they are not, and taking the discharge maximum puts the
    São Francisco 700 km inland, at the last point before the flow splits.
    """
    con.execute(
        """
        CREATE OR REPLACE TABLE rivers AS
        WITH agg AS (
            SELECT MAIN_RIV,
                   min_by(HYRIV_ID, DIST_DN_KM) AS outlet_id,
                   max(DIS_AV_CMS) AS caudal,
                   max(UPLAND_SKM) AS cuenca_km2,
                   max(DIST_DN_KM + LENGTH_KM) AS largo_km,
                   max(ORD_STRA) AS orden,
                   sum(LENGTH_KM) AS red_km,
                   count(*) AS tramos
            FROM reaches
            GROUP BY MAIN_RIV
        )
        SELECT a.MAIN_RIV AS rio,
               a.caudal, a.cuenca_km2, a.largo_km, a.orden, a.red_km, a.tramos,
               ST_Y(ST_EndPoint(r.g)) AS latitude,
               ST_X(ST_EndPoint(r.g)) AS longitude
        FROM agg a
        JOIN reaches r ON r.HYRIV_ID = a.outlet_id
        """
    )
    named = ", ".join(f"({rid}, '{name}')" for rid, name in sorted(BASIN_NAMES.items()))
    con.execute(
        f"""
        CREATE OR REPLACE TABLE rivers AS
        SELECT coalesce(n.nombre, '') AS nombre, r.*
        FROM rivers r
        LEFT JOIN (VALUES {named}) AS n(rio, nombre) ON n.rio = r.rio
        """
    )
    total, named_n = con.execute("SELECT count(*), count(*) FILTER (WHERE nombre <> '') FROM rivers").fetchone()
    print(f"  {total:,} main rivers, {named_n} named")


def write_outputs(con: duckdb.DuckDBPyConnection) -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    def copy(sql: str, name: str) -> None:
        path = OUT / name
        con.execute(f"COPY ({sql}) TO '{path}' (FORMAT PARQUET, COMPRESSION ZSTD)")
        print(f"  wrote {name}  {path.stat().st_size / 1e6:.1f} MB")

    # Ascending by discharge, so the great rivers are the last rows and kepler
    # draws them over their own tributaries rather than under them. path_id
    # breaks the ties, which is what keeps two runs byte-identical.
    copy(
        f"""
        SELECT path_id, rio, (hash(rio) % {BASIN_HUES})::INTEGER AS cuenca_color,
               orden, caudal, km,
               CAST(ST_AsGeoJSON(g) AS VARCHAR) AS geojson
        FROM network ORDER BY caudal, path_id
        """,
        "network.parquet",
    )
    copy(
        f"""
        SELECT path_id, seq, latitude, longitude, caudal, orden, rio,
               (hash(rio) % {BASIN_HUES})::INTEGER AS cuenca_color,
               dist_mar_km, avance_km
        FROM path_vertices ORDER BY path_id, seq
        """,
        "path-vertices.parquet",
    )
    for name in FIELDS:
        copy(f"SELECT lat, lon, u, v, caudal FROM field_{name} ORDER BY lat, lon", f"flowfield-{name}.parquet")
    copy(
        """
        SELECT nombre, rio, caudal, cuenca_km2, largo_km, orden, red_km, tramos, latitude, longitude
        FROM rivers ORDER BY caudal DESC, rio
        """,
        "rivers.parquet",
    )


def main() -> int:
    download_inputs()
    con = connect()
    print("Reaches:")
    load_reaches(con)
    print("Paths:")
    build_paths(con)
    print("Network:")
    build_network(con)
    print("Path vertices:")
    build_path_vertices(con)
    print("Velocity fields:")
    for name, (step, threshold, radius) in FIELDS.items():
        build_flow_field(con, name, step, threshold, radius)
    print("Rivers:")
    build_rivers(con)
    print("Writing:")
    write_outputs(con)
    print(f"\nDone. Fixtures in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
