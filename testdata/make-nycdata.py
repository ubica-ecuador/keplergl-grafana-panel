#!/usr/bin/env python3
"""Mirror the three NYC datasets the nyc-skyline dashboard draws.

Only needed when the mirror must change — the outputs are committed, so the
sources bench works without running this. Requires duckdb:

    pip install duckdb

The upstream is a public GeoLens catalogue, `datasets.geolibre.app`, reached
through its unauthenticated export endpoint:

    /api/datasets/<id>/export?format=parquet

That endpoint would serve the dashboard directly — it answers in about two
seconds and honours `bbox=` and `where=` server-side — but it is somebody
else's demo instance, and a bench that stops working when a stranger redeploys
is not a bench. Hence the mirror. It also sidesteps a trap: the export is
generated per request, so its ETag changes between the range reads DuckDB makes
while parsing a remote parquet, and the read aborts with "the remote file has
changed" unless `SET unsafe_disable_etag_checks = true` precedes it. Against a
static file on nginx that whole problem is gone.

The three datasets are public: NYC building footprints with surveyed roof
heights (NYC Open Data 5zhs-2jue, public domain) and the MTA subway lines and
stations (data.ny.gov, open data). GeoLens is the messenger, not the source.

Trimmed rather than copied, in the spirit of the 256x256 GeoTIFFs next door:

  * Buildings keep the six columns the dashboard reads, and their coordinates
    are rounded to 1e-6 degrees — about 11 cm, well past what a building
    footprint means. 3.82 MB becomes 2.25.
  * The 29 subway lines are one feature per service running the whole length of
    the city, so their geometry dwarfs everything else: 8.6 MB of WKT. Simplified
    at 5e-5 degrees (~5 m, invisible at any zoom where a subway line is a line
    rather than a corridor) they cost 0.03 MB — ninety times less.
  * Stations are 496 points. Nothing to trim.

Total: 2.3 MB for 22,324 buildings, 29 lines and 496 stations.
"""

from pathlib import Path

import duckdb

HERE = Path(__file__).parent

EXPORT = "https://datasets.geolibre.app/api/datasets/{id}/export?format=parquet"

# GeoLens dataset ids, from the project shared at
# share.geolibre.app/giswqs/nyc-buildings-and-subways.
BUILDINGS = "4a0bd0db-cd92-424a-8a2e-62d270ae918a"
LINES = "fd3a8635-1f38-4b51-a18f-784ea84abbbf"
STATIONS = "c646ff35-82eb-442f-a524-efcbb1645023"

# What each mirror keeps. The geometry expression is the whole point of the
# trim, so it sits next to the column list rather than in the copy helper.
MIRRORS = [
    (
        "nyc-buildings.parquet",
        BUILDINGS,
        """bin, height_roof, ground_elevation, shape_area, construction_year, era,
           ST_ReducePrecision(geometry, 0.000001) AS geometry""",
    ),
    (
        "nyc-subway-lines.parquet",
        LINES,
        "service, service_name, ST_Simplify(geometry, 0.00005) AS geometry",
    ),
    (
        "nyc-subway-stations.parquet",
        STATIONS,
        """stop_name, daytime_routes, division, structure, borough, ada,
           geometry""",
    ),
]


def main() -> None:
    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial")
    # See the module docstring: the upstream export is generated per request, so
    # its ETag differs between the range reads of a single parquet parse.
    con.sql("SET unsafe_disable_etag_checks = true")

    for name, dataset_id, columns in MIRRORS:
        url = EXPORT.format(id=dataset_id)
        con.sql(
            f"COPY (SELECT {columns} FROM read_parquet('{url}')) "
            f"TO '{HERE / name}' (FORMAT parquet, COMPRESSION zstd)"
        )

    for name, _, _ in MIRRORS:
        f = HERE / name
        rows = con.sql(f"SELECT count(*) FROM read_parquet('{f}')").fetchone()[0]
        print(f"{name:28} {f.stat().st_size:>9,} bytes  {rows:>6,} rows")


if __name__ == "__main__":
    main()
