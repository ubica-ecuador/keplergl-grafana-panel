#!/usr/bin/env python3
"""Build the fixtures for the "Ancestry Mosaic" dashboard (provisioning-sources).

The dashboard replicates the New York Times ancestry map of July 2026 on top of
this panel. The NYT does not publish its derived dataset, but it does name its
source -- the American Community Survey -- and every input below is a work of
the U.S. federal government, so all of it is public domain.

    python3 -m venv .venv && .venv/bin/pip install duckdb
    .venv/bin/python testdata/make-ancestrydata.py

No API key. api.census.gov now rejects keyless requests (302 -> "Missing Key"),
so this reads the *table-based summary files* instead, which are served straight
off www2.census.gov with no credentials at all. They are far larger than the
equivalent API calls -- about 300 MB against a few megabytes -- but a fixture
generator that anyone can run without registering for anything is worth the
bandwidth. Downloads are cached in testdata/.cache/ and reused.

Outputs land in testdata/ancestry/ and are NOT committed: ~65 MB of derived
Parquet is a poor fit for git when this script rebuilds it byte-identically.
That last part is a constraint, not a hope -- see make-testdata.py, which
refuses to randomise its fixtures so that a regeneration produces no diff. The
dot layer here needs 1.35 million scattered points, and it gets them from
hash(geoid, i) rather than an RNG, so two runs agree exactly. Byte-identical
also demands a *total* ORDER BY on every output: ties left unbroken get
reordered by DuckDB's parallel writer from one run to the next.

A note on the data, repeated in the dashboard's header panel because it changes
how the map should be read: ACS ancestry is a multiple-response, self-reported
question, and it is not the same universe as Hispanic origin or detailed race.
The three tables are stacked here to reach the ~200 groups the NYT shows, and
per-tract totals are renormalised where they overlap. See build_long_table().
"""

import sys
import urllib.request
from pathlib import Path

import duckdb

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
OUT = HERE / "ancestry"

YEAR = 2024
SF = f"https://www2.census.gov/programs-surveys/acs/summary_file/{YEAR}/table-based-SF"
TIGER = "https://www2.census.gov/geo/tiger/GENZ2024/shp"

SHELLS = f"ACS{YEAR}5YR_Table_Shells.txt"

# The three tables that together approximate the NYT's "nearly 200 groups".
# B04006 alone is only the ancestry question (109 groups, and it routes most
# Hispanic respondents out), so it has to be stacked with detailed Hispanic
# origin and detailed Asian race to cover the country.
TABLES = {
    "B04006": "ancestry",         # People Reporting Ancestry
    "B03001": "hispanic_origin",  # Hispanic or Latino Origin by Specific Origin
    "B02015": "asian_group",      # Asian Alone by Selected Groups
}

# Leaves that are residual buckets rather than groups. They are dropped from the
# group list and instead fold into the "Sin reportar" remainder computed per
# tract, which keeps the dot layer summing to the actual population.
EXCLUDED = {
    "B04006_108",  # Other groups
    "B04006_109",  # Unclassified or not reported
    "B03001_002",  # Not Hispanic or Latino
    "B02015_033",  # Other Asian, specified
    "B02015_034",  # Other Asian, not specified
    "B02015_035",  # Two or more Asian
    # "Afghan" is the only label appearing in two tables (B04006_002 ancestry and
    # B02015_029 Asian-alone). Keeping both would double-count it, so the
    # race-table copy loses -- the ancestry question is the map's primary axis.
    "B02015_029",
}

RESIDUAL = "Sin ascendencia reportada"

# One dot per this many people, and the number is set by the *city* view, not
# the national one: at 1:1000 a metro of nine million is nine thousand dots
# scattered over a wide panel, which reads as confetti rather than as a mosaic.
# 1:250 gives Chicago ~38k dots and the country ~1.35M.
#
# The country never ships all 1.35M. Every dot carries a BUCKET column, and the
# dashboard's WHERE clause keeps a fraction of the buckets that depends on how
# much of the world is on screen -- a quarter nationally, all four buckets at
# metro zoom. Because the buckets cycle through each tract's group-ordered dot
# sequence, any subset of them holds the same group proportions as the whole.
PEOPLE_PER_DOT = 250
DOT_BUCKETS = 4

# ~0.0015 deg is roughly 150 m. Tract borders survive; the file halves.
SIMPLIFY_TOLERANCE = 0.0015

H3_RESOLUTION = 5

# The seven groups that get their own hue on the map; everything else, including
# the unreported remainder, collapses into OTHER.
#
# Seven is not a round number, it is the measured ceiling. A dot map is an
# all-pairs colour problem -- any two groups can end up adjacent -- and under
# that constraint the largest set of hues that clears CVD separation (deltaE >= 8),
# the normal-vision floor (>= 15) and 3:1 contrast against a dark basemap is
# seven. Eight fails. The dashboard's saved colorRange carries the matching
# hues, so changing this list means changing that palette too.
PALETTE_GROUPS = [
    "German",
    "Mexican",
    "English",
    "Irish",
    "American",
    "Italian",
    "Puerto Rican",
]
OTHER = "Otros grupos"


def color_group_sql(column: str) -> str:
    """CASE mapping a group name onto its palette slot, or OTHER."""
    listed = ", ".join(f"'{g}'" for g in PALETTE_GROUPS)
    return f"CASE WHEN {column} IN ({listed}) THEN {column} ELSE '{OTHER}' END"


def fetch(url: str, dest: Path) -> Path:
    """Download once into the cache. Nothing here ever changes for a given year."""
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  cached  {dest.name}")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  fetch   {dest.name} <- {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    urllib.request.urlretrieve(url, tmp)
    tmp.rename(dest)
    return dest


def download_inputs() -> None:
    print("Inputs:")
    fetch(f"{SF}/documentation/{SHELLS}", CACHE / SHELLS)
    for table in TABLES:
        name = f"acsdt5y{YEAR}-{table.lower()}.dat"
        fetch(f"{SF}/data/5YRData/{name}", CACHE / name)
    fetch(f"{TIGER}/cb_2024_us_tract_500k.zip", CACHE / "cb_2024_us_tract_500k.zip")


def connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("INSTALL h3 FROM community; LOAD h3;")
    return con


def load_groups(con: duckdb.DuckDBPyConnection) -> list[tuple[str, str, str]]:
    """Map variable code -> human label, keeping only leaves of the table tree.

    The shells file carries the hierarchy as an indent level, and every parent
    label ends in a colon ("Arab:", "Central American:"). Summing parents and
    children together would double-count, so the colon is the filter. B02015
    additionally has pure header rows with no variable code at all.
    """
    con.execute(
        f"""
        CREATE OR REPLACE TABLE groups AS
        SELECT "Unique ID" AS varcode,
               "Table ID"  AS tbl,
               Label       AS ancestry
        FROM read_csv(?, delim='|', header=true, quote='',
                      types={{'Line':'VARCHAR','Indent':'VARCHAR'}})
        WHERE "Table ID" IN ({",".join("?" for _ in TABLES)})
          AND "Unique ID" IS NOT NULL
          AND Label NOT LIKE '%:'
          AND "Unique ID" NOT IN ({",".join("?" for _ in EXCLUDED)})
        ORDER BY varcode
        """,
        [str(CACHE / SHELLS), *TABLES, *sorted(EXCLUDED)],
    )
    rows = con.execute("SELECT varcode, tbl, ancestry FROM groups ORDER BY varcode").fetchall()
    print(f"  {len(rows)} ancestry groups across {len(TABLES)} tables")
    return rows


def build_long_table(con: duckdb.DuckDBPyConnection, groups) -> None:
    """(geoid, ancestry, source, estimate) for every census tract, zeros dropped.

    Each summary file holds every geography in the country -- nation, states,
    counties, places, ZCTAs, block groups -- in one pipe-delimited table with a
    column per variable. Summary level 140 (census tract) is the prefix
    '1400000US' on GEO_ID, and the 11 digits after it are the TIGER GEOID.
    """
    by_table: dict[str, list[tuple[str, str]]] = {}
    for varcode, tbl, ancestry in groups:
        by_table.setdefault(tbl, []).append((varcode, ancestry))

    parts = []
    for tbl, items in by_table.items():
        path = str(CACHE / f"acsdt5y{YEAR}-{tbl.lower()}.dat")
        # The .dat columns are B04006_E002, not the API's B04006_002E.
        cols = ",\n            ".join(
            f'''"{tbl}_E{varcode.split("_")[1]}"::BIGINT AS "{ancestry}"'''
            for varcode, ancestry in items
        )
        names = ", ".join(f'"{ancestry}"' for _, ancestry in items)
        parts.append(
            f"""
        SELECT geoid, ancestry, '{TABLES[tbl]}' AS source, estimate FROM (
            SELECT geoid, {names}
            FROM (
                SELECT substr(GEO_ID, 10) AS geoid,
            {cols}
                FROM read_csv('{path}', delim='|', header=true, quote='')
                WHERE starts_with(GEO_ID, '1400000US')
            )
        ) UNPIVOT (estimate FOR ancestry IN ({names}))
        """
        )

    con.execute(
        "CREATE OR REPLACE TABLE tract_ancestry AS "
        + " UNION ALL ".join(parts)
        + " -- keep only groups actually present; ~95% of the matrix is zero"
    )
    con.execute("DELETE FROM tract_ancestry WHERE estimate IS NULL OR estimate <= 0")

    # Total population comes from the ancestry table's own total line, which is
    # the whole resident population rather than an ancestry-specific universe.
    b04 = str(CACHE / f"acsdt5y{YEAR}-b04006.dat")
    con.execute(
        f"""
        CREATE OR REPLACE TABLE tract_pop AS
        SELECT substr(GEO_ID, 10) AS geoid, "B04006_E001"::BIGINT AS total_pop
        FROM read_csv('{b04}', delim='|', header=true, quote='')
        WHERE starts_with(GEO_ID, '1400000US')
        """
    )
    n_rows, n_tracts = con.execute(
        "SELECT (SELECT count(*) FROM tract_ancestry), (SELECT count(*) FROM tract_pop)"
    ).fetchone()
    pop = con.execute("SELECT sum(total_pop) FROM tract_pop").fetchone()[0]
    print(f"  {n_tracts:,} tracts, {n_rows:,} non-zero group rows, {pop:,} people")


def build_geometry(con: duckdb.DuckDBPyConnection) -> None:
    """Simplified tract polygons plus their bounding boxes and internal points.

    The bbox columns are not redundant with the geometry: the dashboard filters
    by map viewport, and a plain BETWEEN on four DOUBLE columns is something
    Parquet can prune with row-group statistics, while ST_Intersects has to
    decode all 85k geometries first. Sorting by H3 cell gives those row groups
    spatial locality, which is what makes the pruning actually bite.
    """
    tract_zip = f"/vsizip/{CACHE / 'cb_2024_us_tract_500k.zip'}"
    # The cartographic boundary file already carries the state and county names,
    # so no second shapefile is needed. It publishes no interior point though,
    # hence ST_PointOnSurface -- ST_Centroid would fall outside the horseshoe and
    # crescent tracts that ring a lake or a bay, and the dot fallback below
    # depends on that point actually being inside the polygon.
    #
    # Coordinates are NAD83 (EPSG:4269) rather than WGS84. The two differ by
    # about a metre in the continental US, which is well under a tract's width
    # and far under the map's rendering resolution, so no reprojection.
    con.execute(
        f"""
        CREATE OR REPLACE TABLE tract_geom AS
        SELECT t.GEOID AS geoid,
               t.NAMELSAD AS name,
               t.NAMELSADCO AS county,
               t.STATE_NAME AS state,
               t.STUSPS AS state_abbr,
               ST_SimplifyPreserveTopology(t.geom, {SIMPLIFY_TOLERANCE}) AS geometry,
               ST_Y(ST_PointOnSurface(t.geom)) AS latitude,
               ST_X(ST_PointOnSurface(t.geom)) AS longitude,
               ST_XMin(t.geom) AS minx, ST_YMin(t.geom) AS miny,
               ST_XMax(t.geom) AS maxx, ST_YMax(t.geom) AS maxy,
               ST_Area(t.geom) AS bbox_fill
        FROM ST_Read('{tract_zip}') t
        """
    )
    # Ratio of polygon area to bbox area drives how hard rejection sampling has
    # to work later; a coastal tract shaped like a comma can be under 5%.
    con.execute(
        """
        ALTER TABLE tract_geom ADD COLUMN fill_ratio DOUBLE;
        UPDATE tract_geom SET fill_ratio = CASE
            WHEN (maxx-minx) * (maxy-miny) > 0
            THEN least(1.0, greatest(0.02, bbox_fill / ((maxx-minx) * (maxy-miny))))
            ELSE 1.0 END;
        """
    )
    n = con.execute("SELECT count(*) FROM tract_geom").fetchone()[0]
    print(f"  {n:,} tract polygons simplified")


def build_tracts(con: duckdb.DuckDBPyConnection) -> None:
    """One row per tract: population, centroid, and the three leading groups."""
    con.execute(
        """
        CREATE OR REPLACE TABLE tract_rank AS
        SELECT geoid, ancestry, estimate,
               row_number() OVER (PARTITION BY geoid ORDER BY estimate DESC, ancestry) AS rnk
        FROM tract_ancestry
        """
    )
    con.execute(
        """
        CREATE OR REPLACE TABLE tracts AS
        SELECT g.geoid, g.name, g.county, g.state, g.state_abbr,
               p.total_pop,
               g.latitude, g.longitude,
               max(CASE WHEN r.rnk = 1 THEN r.ancestry END) AS top1_ancestry,
               max(CASE WHEN r.rnk = 1 THEN r.estimate END) AS top1_people,
               max(CASE WHEN r.rnk = 2 THEN r.ancestry END) AS top2_ancestry,
               max(CASE WHEN r.rnk = 2 THEN r.estimate END) AS top2_people,
               max(CASE WHEN r.rnk = 3 THEN r.ancestry END) AS top3_ancestry,
               max(CASE WHEN r.rnk = 3 THEN r.estimate END) AS top3_people
        FROM tract_geom g
        JOIN tract_pop p USING (geoid)
        LEFT JOIN tract_rank r ON r.geoid = g.geoid AND r.rnk <= 3
        GROUP BY ALL
        """
    )
    con.execute(
        """
        ALTER TABLE tracts ADD COLUMN top1_pct DOUBLE;
        ALTER TABLE tracts ADD COLUMN top2_pct DOUBLE;
        ALTER TABLE tracts ADD COLUMN top3_pct DOUBLE;
        UPDATE tracts SET
            top1_pct = CASE WHEN total_pop > 0 THEN top1_people::DOUBLE / total_pop END,
            top2_pct = CASE WHEN total_pop > 0 THEN top2_people::DOUBLE / total_pop END,
            top3_pct = CASE WHEN total_pop > 0 THEN top3_people::DOUBLE / total_pop END;
        """
    )


def build_dots(con: duckdb.DuckDBPyConnection) -> None:
    """One point per PEOPLE_PER_DOT residents, scattered inside its tract.

    This is the layer that reproduces the NYT mosaic: colour by `ancestry` and
    the overlap of neighbouring groups reads as a blend without kepler having to
    blend anything.

    Two things are deliberate. Placement is rejection sampling against the real
    polygon rather than a jitter around the centroid, because at metro zoom the
    difference between dots that respect a coastline and dots that do not is the
    whole illusion. And the group assignment is a contiguous cumulative split of
    each tract's dot range, not a weighted random draw -- proportions come out
    exact, and a tract with 40% Irish shows 40% Irish dots every single run.
    """
    con.execute(
        f"""
        CREATE OR REPLACE TABLE tract_dots_plan AS
        SELECT g.geoid, g.minx, g.miny, g.maxx, g.maxy, g.fill_ratio,
               g.latitude, g.longitude, g.state_abbr,
               greatest(1, round(p.total_pop / {PEOPLE_PER_DOT}.0)::INT) AS n_dots
        FROM tract_geom g JOIN tract_pop p USING (geoid)
        WHERE p.total_pop > 0
        """
    )
    total_dots = con.execute("SELECT sum(n_dots) FROM tract_dots_plan").fetchone()[0]
    print(f"  planning {total_dots:,} dots")

    # Oversample by the inverse fill ratio so that, after throwing away the
    # candidates that miss the polygon, enough survive. Capped at 40x because a
    # handful of pathological tracts would otherwise dominate the whole run.
    con.execute(
        f"""
        CREATE OR REPLACE TABLE dot_candidates AS
        SELECT p.geoid, p.state_abbr,
               p.minx + (hash(p.geoid || 'x' || s.i) % 1000000) / 1000000.0 * (p.maxx - p.minx) AS longitude,
               p.miny + (hash(p.geoid || 'y' || s.i) % 1000000) / 1000000.0 * (p.maxy - p.miny) AS latitude,
               s.i
        FROM tract_dots_plan p,
             generate_series(1, least(40 * p.n_dots, ceil(p.n_dots / p.fill_ratio * 1.6)::BIGINT) + 8) AS s(i)
        """
    )
    con.execute(
        """
        CREATE OR REPLACE TABLE dot_positions AS
        SELECT geoid, state_abbr, longitude, latitude,
               row_number() OVER (PARTITION BY geoid ORDER BY i) AS rn
        FROM (
            SELECT c.*
            FROM dot_candidates c
            JOIN tract_geom g USING (geoid)
            WHERE ST_Contains(g.geometry, ST_Point(c.longitude, c.latitude))
        )
        """
    )
    # Tracts whose polygon swallowed every candidate (slivers, tiny islands)
    # still deserve their dots; fall back to the published internal point.
    con.execute(
        """
        CREATE OR REPLACE TABLE dot_shortfall AS
        SELECT p.geoid, p.state_abbr, p.longitude, p.latitude,
               coalesce(d.placed, 0) AS placed,
               p.n_dots - coalesce(d.placed, 0) AS missing
        FROM tract_dots_plan p
        LEFT JOIN (SELECT geoid, count(*) AS placed FROM dot_positions GROUP BY geoid) d
               USING (geoid)
        WHERE p.n_dots > coalesce(d.placed, 0)
        """
    )
    con.execute(
        """
        INSERT INTO dot_positions
        SELECT geoid, state_abbr, longitude, latitude, placed + s.i
        FROM dot_shortfall, generate_series(1, missing) AS s(i)
        """
    )

    # Per-tract group shares, with the unreported remainder made explicit so the
    # dots add up to the population rather than to the sum of the groups.
    con.execute(
        f"""
        CREATE OR REPLACE TABLE tract_shares AS
        WITH summed AS (
            SELECT geoid, sum(estimate) AS grouped FROM tract_ancestry GROUP BY geoid
        ), base AS (
            SELECT p.geoid, p.total_pop, coalesce(s.grouped, 0) AS grouped,
                   greatest(p.total_pop, coalesce(s.grouped, 0)) AS denom
            FROM tract_pop p LEFT JOIN summed s USING (geoid)
            WHERE p.total_pop > 0
        )
        SELECT a.geoid, a.ancestry, a.estimate::DOUBLE / b.denom AS share
        FROM tract_ancestry a JOIN base b USING (geoid)
        UNION ALL
        SELECT geoid, '{RESIDUAL}', (denom - grouped)::DOUBLE / denom
        FROM base WHERE denom > grouped
        """
    )
    # Rounding each boundary independently let two groups claim the same dot in
    # 34 tracts, so the upper bound is rounded once and the lower bound is just
    # the previous group's upper bound. Contiguous by construction: no dot can
    # fall in two ranges, and none can fall in none.
    con.execute(
        """
        CREATE OR REPLACE TABLE dot_alloc AS
        SELECT geoid, ancestry,
               coalesce(lag(hi) OVER (PARTITION BY geoid ORDER BY ord), 0) AS lo,
               hi
        FROM (
            SELECT s.geoid, s.ancestry,
                   row_number() OVER w AS ord,
                   least(round(p.n_dots * (sum(s.share) OVER w)), p.n_dots) AS hi
            FROM tract_shares s
            JOIN tract_dots_plan p USING (geoid)
            WINDOW w AS (PARTITION BY s.geoid ORDER BY s.share DESC, s.ancestry
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
        )
        """
    )
    con.execute(
        f"""
        CREATE OR REPLACE TABLE dots AS
        SELECT d.latitude, d.longitude, a.ancestry,
               {color_group_sql("a.ancestry")} AS color_group,
               ((d.rn - 1) % {DOT_BUCKETS})::TINYINT AS bucket,
               d.geoid, d.state_abbr AS state
        FROM dot_positions d
        JOIN dot_alloc a ON a.geoid = d.geoid AND d.rn > a.lo AND d.rn <= a.hi
        """
    )
    n = con.execute("SELECT count(*) FROM dots").fetchone()[0]
    print(f"  {n:,} dots placed")


def build_h3(con: duckdb.DuckDBPyConnection) -> None:
    """Aggregate the dots into H3 cells for the hexagon layer.

    Precomputed here rather than in the dashboard on purpose: the DuckDB data
    source is provisioned with `INSTALL spatial; LOAD spatial;` and nothing
    else, and h3 is a community extension. Shipping the index as a column keeps
    the datasource provisioning untouched.
    """
    con.execute(
        f"""
        CREATE OR REPLACE TABLE h3_cells AS
        WITH celled AS (
            SELECT h3_latlng_to_cell_string(latitude, longitude, {H3_RESOLUTION}) AS h3,
                   ancestry
            FROM dots
        ), per_group AS (
            SELECT h3, ancestry, count(*) * {PEOPLE_PER_DOT} AS people,
                   row_number() OVER (PARTITION BY h3 ORDER BY count(*) DESC, ancestry) AS rnk
            FROM celled GROUP BY h3, ancestry
        )
        SELECT h3,
               sum(people)::BIGINT AS count,
               max(CASE WHEN rnk = 1 THEN ancestry END) AS dominant_ancestry,
               max(CASE WHEN rnk = 1 THEN people END)::BIGINT AS dominant_people
        FROM per_group GROUP BY h3
        """
    )
    n = con.execute("SELECT count(*) FROM h3_cells").fetchone()[0]
    print(f"  {n:,} H3 cells at resolution {H3_RESOLUTION}")


def write_outputs(con: duckdb.DuckDBPyConnection) -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    def copy(sql: str, name: str) -> None:
        path = OUT / name
        con.execute(f"COPY ({sql}) TO '{path}' (FORMAT PARQUET, COMPRESSION ZSTD)")
        print(f"  wrote {name}  {path.stat().st_size / 1e6:.1f} MB")

    copy(
        f"""
        SELECT geoid, name, county, state, state_abbr, total_pop, latitude, longitude,
               top1_ancestry,
               {color_group_sql("top1_ancestry")} AS top1_color_group,
               top1_people, top1_pct,
               top2_ancestry, top2_people, top2_pct,
               top3_ancestry, top3_people, top3_pct
        FROM tracts ORDER BY h3_latlng_to_cell_string(latitude, longitude, 3), geoid  -- geoid is unique
        """,
        "tracts.parquet",
    )
    copy(
        """
        SELECT g.geoid, g.geometry, g.minx, g.miny, g.maxx, g.maxy
        FROM tract_geom g JOIN tract_pop p USING (geoid)
        ORDER BY h3_latlng_to_cell_string(g.latitude, g.longitude, 3), g.geoid
        """,
        "tracts-geom.parquet",
    )
    copy(
        """
        SELECT a.geoid, a.ancestry, a.source, a.estimate,
               CASE WHEN p.total_pop > 0 THEN a.estimate::DOUBLE / p.total_pop END AS pct
        FROM tract_ancestry a JOIN tract_pop p USING (geoid)
        ORDER BY a.ancestry, a.geoid  -- (ancestry, geoid) is unique
        """,
        "tract-ancestry.parquet",
    )
    copy(
        """
        SELECT latitude, longitude, ancestry, color_group, bucket, geoid, state FROM dots
        ORDER BY h3_latlng_to_cell_string(latitude, longitude, 3),
                 geoid, latitude, longitude, ancestry, bucket
        """,
        "dots.parquet",
    )
    copy(
        f"""
        SELECT h3, count, dominant_ancestry,
               {color_group_sql("dominant_ancestry")} AS dominant_color_group,
               dominant_people
        FROM h3_cells ORDER BY h3
        """,
        "h3.parquet",
    )
    copy(
        """
        SELECT a.ancestry, any_value(a.source) AS source,
               sum(a.estimate)::BIGINT AS national_total,
               count(DISTINCT a.geoid) AS tracts_present
        FROM tract_ancestry a GROUP BY a.ancestry ORDER BY national_total DESC
        """,
        "ancestries.parquet",
    )


def main() -> int:
    download_inputs()
    con = connect()
    print("Groups:")
    groups = load_groups(con)
    print("Estimates:")
    build_long_table(con, groups)
    print("Geometry:")
    build_geometry(con)
    build_tracts(con)
    print("Dots:")
    build_dots(con)
    print("Hexagons:")
    build_h3(con)
    print("Writing:")
    write_outputs(con)
    print(f"\nDone. Fixtures in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
