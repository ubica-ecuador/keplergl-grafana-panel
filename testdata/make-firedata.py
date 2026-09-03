#!/usr/bin/env python3
"""Convert the CAMS per-country daily series into Parquet for the fire dashboard.

    pip install pyarrow

Everything else in the fire-emissions dashboard is read live from ECMWF's public
Parquet store — no ETL, no local copy. These two files are the exception, and
the reason is narrow: CAMS publishes the per-country daily series as **Arrow IPC
inside gzip**, and DuckDB cannot read that over HTTP. `read_arrow` and
`read_ipc` do not exist in the 1.4.0 core, and the community `arrow` extension
installs but fails on the compressed stream with

    IO Error: Expected continuation token (0xFFFFFFFF) but got ...

The alternative is deriving 23 years of history from the 0.1° pixels, which
means reading two dozen monthly files per chart: 15 s for the "same window each
year" bars even with row-group pruning, and wholly impractical for the
cumulative-by-year chart. Converting once costs 4 MB per variable and makes both
charts resolve in about a second.

The output is gitignored — 8 MB of derived data that regenerates in a minute, so
the repo keeps the recipe rather than the result. Run this once before opening the
fire-emissions dashboard, and again when a new year appears (the store adds one
every January); the run is idempotent and the values are CAMS's own.
"""

import gzip
import time
import urllib.error
import urllib.request
from pathlib import Path

import pyarrow as pa
import pyarrow.ipc as ipc
import pyarrow.parquet as pq

ROOT = "https://sites.ecmwf.int/data/cams/products/gfas/v2_gisco_fp"
OUT = Path(__file__).parent / "fire"

# `cfire` is carbon emissions (kg/day here — the pixels use t/day), `frpfire` is
# fire radiative power (W here — the pixels use MW). Mind the mismatch: the two
# sources of the same quantity do not share units.
VARIABLES = ("cfire", "frpfire")

# admin0 feeds the country history charts, admin1 the subdivision ones. The
# admin1 files are six times the size — 26 MB a variable against 4 — because
# there are 4 620 subdivisions to 271 countries.
LEVELS = ("admin0", "admin1")

# The record starts in 2003. The end is deliberately open: a year that does not
# exist yet 404s and simply ends the loop.
FIRST_YEAR = 2003
LAST_YEAR = 2100


def read_series(url: str, attempts: int = 4) -> pa.Table:
    """One year of `(day_idx, region_idx, value)`, un-gzipped and parsed.

    Retried because the store stalls now and then on a cold file: a full run is
    48 requests, and one dropped read would otherwise lose the whole variable.
    A 404 is not a stall — it means the year does not exist — so it is re-raised
    at once for the caller to treat as the end of the record.
    """
    for attempt in range(attempts):
        try:
            raw = urllib.request.urlopen(url, timeout=120).read()
            break
        except urllib.error.HTTPError:
            raise
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(2 * (attempt + 1))
    buf = pa.BufferReader(gzip.decompress(raw))
    try:
        # Files written with the random-access format carry an ARROW1 header.
        return ipc.open_file(buf).read_all()
    except pa.ArrowInvalid:
        buf.seek(0)
        return ipc.open_stream(buf).read_all()


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for variable in VARIABLES:
        for level in LEVELS:
            path = OUT / f"{variable}_{level}.parquet"
            tables = []
            for year in range(FIRST_YEAR, LAST_YEAR):
                url = f"{ROOT}/series/{variable}/{level}/{year}.arrow.gz"
                try:
                    tables.append(read_series(url))
                except urllib.error.HTTPError as err:
                    if err.code == 404:
                        break
                    raise

            if not tables:
                raise SystemExit(f"no series for {variable}/{level} — did the store move?")

            table = pa.concat_tables(tables)
            pq.write_table(table, path, compression="zstd")
            print(
                f"{variable}/{level}: {len(tables)} years, {table.num_rows:,} rows "
                f"-> {path.name} ({path.stat().st_size / 1e6:.2f} MB)"
            )


if __name__ == "__main__":
    main()
