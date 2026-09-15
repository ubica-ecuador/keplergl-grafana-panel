#!/usr/bin/env python3
"""Build the week of New York taxi trips the nyc-taxi-live dashboard replays.

    pip install duckdb

The dashboard pretends to be live: it maps the current time in New York onto
one week of 2015 (Monday 14 to Sunday 20 September), keeping the weekday and the
time of day, so rush hour on the map is rush hour in Manhattan. 2015 and 2026
share a calendar, which is why "today, eleven years ago" lines up to the weekday.

**Why QuestDB's demo and not the TLC.** The trip records the NYC Taxi & Limousine
Commission publishes today no longer carry coordinates for any year: the 2015
and 2016 files were reprocessed into Parquet with only `PULocationID` and
`DOLocationID`, and the original CSV bucket (`s3://nyc-tlc`) answers 403. The
public QuestDB demo (`demo.questdb.io`) still holds the original rows with
latitude and longitude up to mid-2016, and serves any query as CSV through
`/exp`. It is somebody else's demo instance, so this recipe mirrors one week
rather than letting a dashboard depend on it.

Three things in that table are not what their names say, and each one is
handled below rather than discovered on the map:

  * **The pickup coordinates are swapped.** `pickup_latitude` holds the
    longitude and `pickup_longitude` the latitude, in every year (98 % of rows
    fall in NYC's longitude band on 2010, 2013, 2015 and 2016 alike). The
    dropoff pair is correct. QuestDB's own dashboard works around it by mapping
    its heatmap's latitude to `pickup_longitude`.
  * **The timestamps say UTC and are not.** They carry a `Z`, but TLC records
    are New York wall-clock time. They are kept here as naive timestamps, and
    parsed from text so that no client time zone gets a chance to shift them —
    reading the CSV with automatic detection moved every trip by the local
    offset of the machine running this.
  * **About 1 % of rows are GPS noise**: coordinates at 0,0, trips that end
    before they start or run for days. Those are dropped.

The H3 cells the map aggregates on are computed here too, so the dashboard's
queries need no community extension — the data source only has to read Parquet.

The output (83 MB, 3.09 million trips) is gitignored and takes about 40 s to
build; the downloaded CSVs are cached under testdata/.cache/taxi so a second run
does not fetch ~370 MB again.
"""

import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import duckdb

HERE = Path(__file__).parent
CACHE = HERE / ".cache" / "taxi"
OUT = HERE / "taxi" / "trips-2015-w38.parquet"

EXPORT = "https://demo.questdb.io/exp"
FIRST_DAY = date(2015, 9, 14)  # a Monday, like 14 September 2026
DAYS = 7

# A box around the five boroughs, generous enough to keep Newark airport runs.
SOUTH, NORTH, WEST, EAST = 40.49, 40.93, -74.27, -73.68

COLUMNS = (
    "cab_type, pickup_datetime, dropoff_datetime, "
    "pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude, "
    "passenger_count, trip_distance, fare_amount, tip_amount, total_amount"
)


def fetch_day(day: date, attempts: int = 4) -> Path:
    """One day of trips as QuestDB's CSV export, cached on disk."""
    target = CACHE / f"{day.isoformat()}.csv"
    if target.exists() and target.stat().st_size > 0:
        return target

    query = f"SELECT {COLUMNS} FROM trips WHERE pickup_datetime IN '{day.isoformat()}'"
    # The demo answers 403 to urllib's default `Python-urllib/3.x` agent — and
    # only to that: curl's, a custom one, or none at all all get a 200.
    request = urllib.request.Request(
        f"{EXPORT}?{urllib.parse.urlencode({'query': query})}",
        headers={"User-Agent": "kepler-grafana make-taxidata.py"},
    )
    partial = target.with_suffix(".part")
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=300) as response, open(partial, "wb") as out:
                while chunk := response.read(1 << 20):
                    out.write(chunk)
            break
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(3 * (attempt + 1))
    partial.rename(target)
    return target


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)

    files = []
    for offset in range(DAYS):
        day = FIRST_DAY + timedelta(days=offset)
        started = time.time()
        files.append(str(fetch_day(day)))
        print(f"{day}  {time.time() - started:5.1f} s")

    con = duckdb.connect()
    con.execute("INSTALL h3 FROM community; LOAD h3;")

    # Every column as text first: the timestamps must not be interpreted as UTC,
    # and an empty field in a numeric column should not abort the whole read.
    con.execute(
        f"""
        CREATE TABLE raw AS
        SELECT * FROM read_csv({files}, header = true, all_varchar = true)
        """
    )

    con.execute(
        f"""
        CREATE TABLE trips AS
        WITH typed AS (
          SELECT
            cab_type,
            strptime(left(pickup_datetime, 19), '%Y-%m-%dT%H:%M:%S') AS pickup_time,
            strptime(left(dropoff_datetime, 19), '%Y-%m-%dT%H:%M:%S') AS dropoff_time,
            -- Swapped at the source; see the module docstring.
            TRY_CAST(pickup_longitude AS DOUBLE) AS pickup_lat,
            TRY_CAST(pickup_latitude AS DOUBLE) AS pickup_lon,
            TRY_CAST(dropoff_latitude AS DOUBLE) AS dropoff_lat,
            TRY_CAST(dropoff_longitude AS DOUBLE) AS dropoff_lon,
            TRY_CAST(passenger_count AS INTEGER) AS passengers,
            TRY_CAST(trip_distance AS DOUBLE) AS distance_mi,
            TRY_CAST(fare_amount AS DOUBLE) AS fare,
            TRY_CAST(tip_amount AS DOUBLE) AS tip,
            TRY_CAST(total_amount AS DOUBLE) AS total
          FROM raw
        )
        SELECT
          *,
          h3_latlng_to_cell_string(pickup_lat, pickup_lon, 7) AS pickup_h3_7,
          h3_latlng_to_cell_string(dropoff_lat, dropoff_lon, 7) AS dropoff_h3_7,
          h3_latlng_to_cell_string(pickup_lat, pickup_lon, 8) AS pickup_h3_8,
          h3_latlng_to_cell_string(dropoff_lat, dropoff_lon, 8) AS dropoff_h3_8,
          h3_latlng_to_cell_string(pickup_lat, pickup_lon, 9) AS pickup_h3_9,
          h3_latlng_to_cell_string(dropoff_lat, dropoff_lon, 9) AS dropoff_h3_9
        FROM typed
        WHERE pickup_lat BETWEEN {SOUTH} AND {NORTH} AND pickup_lon BETWEEN {WEST} AND {EAST}
          AND dropoff_lat BETWEEN {SOUTH} AND {NORTH} AND dropoff_lon BETWEEN {WEST} AND {EAST}
          AND dropoff_time > pickup_time
          AND dropoff_time <= pickup_time + INTERVAL 3 HOUR
          AND fare >= 0
        """
    )

    print("\nday          raw     kept")
    for day, raw, kept in con.execute(
        """
        SELECT r.day, r.n, coalesce(t.n, 0)
        FROM (SELECT left(pickup_datetime, 10) AS day, count(*) AS n FROM raw GROUP BY 1) r
        LEFT JOIN (SELECT pickup_time::DATE::VARCHAR AS day, count(*) AS n FROM trips GROUP BY 1) t USING (day)
        ORDER BY 1
        """
    ).fetchall():
        print(f"{day}  {raw:7d}  {kept:7d}  ({100 * kept / raw:.1f} %)")

    # Sorted by pickup time, in row groups small enough that a ten-minute
    # window touches one or two of them.
    con.execute(
        f"""
        COPY (SELECT * FROM trips ORDER BY pickup_time)
        TO '{OUT}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)
        """
    )
    print(f"\n{OUT.relative_to(HERE.parent)}  {OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
