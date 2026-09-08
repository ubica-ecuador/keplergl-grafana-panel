"""TiTiler whose `/zarr` router can also open Icechunk repositories.

A growing number of public archives — dynamical.org's NOAA GFS among them — have
stopped publishing a plain Zarr tree over HTTP and ship an Icechunk repository
instead. An Icechunk repo is not a Zarr tree: its chunk objects are named by
opaque ULIDs and the mapping from array coordinates to object lives inside a
manifest, so an object store handed to `xarray.open_dataset` finds no
`zarr.json` and there is nothing to open. Only the `icechunk` client resolves
it, by reading a pointer object, then a snapshot, then the manifests.

That resolving cannot happen in the browser. The library's browser build is WASM
that hands a `SharedArrayBuffer` to a worker, and a Grafana page is not
cross-origin isolated, so the hand-off dies with `DataCloneError: SharedArrayBuffer
transfer requires self.crossOriginIsolated`. It has to happen server side, and
this is the server that was already there.

Two deliberate choices:

* The router replaces the stock one at `/zarr` rather than sitting beside it at
  `/icechunk`. The panel spells the route out when it builds a tile url
  (`src/data/zarrTileUrl.ts`), so a second prefix would mean a plugin change and
  a plugin that only works against this image. Dispatching on the url instead
  costs one function: anything that does not name Icechunk goes to the stock
  opener untouched, and the raster dashboards that already exist keep working.

* The dataset is cached with a deadline. Opening the GFS repo costs about four
  seconds — a 491 KB pointer, a snapshot, then the metadata — which no tile can
  afford, but the upstream cache never expires and dynamical commits a new
  forecast every six hours. An eternal cache would freeze the archive at
  whatever the container saw when it started, and that freeze would look like an
  archive that stopped updating rather than like a cache.

Addressing, in the `url` parameter the panel already sends:

    icechunk+https://bucket.s3.region.amazonaws.com/prefix.icechunk
    stac+https://stac.dynamical.org/noaa-gfs-forecast/collection.json

Prefer the second. dynamical rolls the repository version (`v0.2.7` today) and
asks callers not to hard-code the location; a dashboard holding the bucket url
breaks by itself the day they publish the next one, and breaks with a 404 that
says nothing about versions.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
from functools import lru_cache
from typing import Any, Callable

import attr
import xarray

# Ordering, not style: the stock application mounts its own `/zarr` router at
# import time unless this is set, and FastAPI matches routes in the order they
# were added, so a second `/zarr` added afterwards would never see a request.
# Unmounting the first one after the fact was the other option and it is worse:
# `app.router.routes` holds `_IncludedRouter` wrappers whose prefix lives in a
# private `include_context`, a shape that changed between FastAPI versions and
# will change again. This flag is a documented setting.
os.environ.setdefault("TITILER_API_DISABLE_ZARR", "TRUE")

from titiler.application.main import api_settings, app, titiler_templates  # noqa: E402
from titiler.xarray.extensions import DatasetMetadataExtension, ValidateExtension  # noqa: E402
from titiler.xarray.factory import TilerFactory as XarrayTilerFactory  # noqa: E402
from titiler.xarray.io import Reader, open_zarr  # noqa: E402

# Which asset of a STAC Collection holds the repository. dynamical publishes both
# `icechunk` (an s3:// path) and `icechunk-https`; only the second is reachable
# without credentials or a region, which is what this server wants.
STAC_ASSET = os.environ.get("ICECHUNK_STAC_ASSET", "icechunk-https")

# Seconds a resolved repository stays open. Fifteen minutes is a quarter of the
# six-hour cadence of a GFS run: short enough that a new forecast shows up on its
# own, long enough that the cost of opening is amortised over a whole session of
# panning. Every tile of one screen shares one entry, and — because the entry
# holds a snapshot rather than a branch — shares one *version*, so a screenful of
# tiles can never be half old forecast and half new one.
CACHE_TTL = int(os.environ.get("ICECHUNK_CACHE_TTL", "900"))

# Bytes of decompressed chunks each open repository keeps in memory.
#
# Icechunk ships this **off** — `num_bytes_chunks: 0` — so by default every read
# fetches and decompresses its chunk again, however many times the same one is
# asked for. That default is wrong for everything this server does, because a
# chunk here is enormous next to a request: GFS packs 105 lead times and 30.25°
# of latitude and longitude into one 0.91 MiB object, so a screenful of tiles and
# a whole regional grid of statistics all live inside a single chunk.
#
# Measured against GFS, reading the same one-cell window five times:
#
#     off      1.12 s, 1.82 s, 1.80 s, 0.80 s …   every read pays in full
#     on       3.37 s, then 0.007 s               460x on every read but the first
#
# and the shape of request that this makes possible — 81 separate windows, which
# is what one `/zarr/statistics` call over a 9x9 grid does — goes from 90 s to
# 0.68 s.
#
# The number is per repository and per worker, so the ceiling is this times the
# live entries of the cache above times `WEB_CONCURRENCY`. 128 MiB holds about
# twenty of GFS's chunks unpacked, which is a region at any zoom; raise it for a
# server that serves several archives at once, and watch the multiplication.
CHUNK_CACHE_BYTES = int(
    os.environ.get("ICECHUNK_CHUNK_CACHE_BYTES", str(128 * 1024 * 1024))
)


# Repositories to hold open, comma separated, so that no request ever pays for
# opening one.
#
# Opening the GFS repo costs about 4.6 seconds — a 491 KB pointer, a snapshot,
# then the metadata — and that is charged to whichever request arrives first.
# Under gunicorn it is charged four times, once per worker, because each has its
# own cache. That is survivable for a tile, which is one request among dozens.
# It is fatal for a dashboard that measures a lattice, because DuckDB's
# `http_client` gives up on a response after ten seconds and offers no setting
# to say otherwise: measured against a cold server, requests of nine cells took
# 6.5 s, 7.2 s, 8.1 s and 10.3 s — the last one over the edge — while the same
# requests warm took 1.1 s. Splitting the work into smaller requests does not
# help, because the cost is the opening and not the cells.
#
# So the opening moves off the request path entirely: a daemon thread per worker
# opens these at boot and re-opens them before the cache above retires them, at
# a third of its lifetime. The thread never lets an exception escape — a
# repository that cannot be reached at boot must not stop a server whose other
# routes have nothing to do with it, and the next pass will try again.
PRELOAD = [a.strip() for a in os.environ.get("ICECHUNK_PRELOAD", "").split(",") if a.strip()]


def _keep_open() -> None:
    """Open every preloaded repository, again and again, in the background."""
    while True:
        for src_path in PRELOAD:
            try:
                open_icechunk(src_path)
            except Exception as exc:  # noqa: BLE001 - a boot must not depend on this
                print(f"icechunk preload failed for {src_path}: {exc!r}", flush=True)

        time.sleep(max(CACHE_TTL // 3, 30))


def icechunk_href(src_path: str) -> str | None:
    """The https url of the repository `src_path` names, or None if it names none.

    Returning None rather than raising is the dispatch: a plain store url is not
    an error here, it is the other branch.
    """
    scheme, plus, rest = src_path.partition("+")
    if not plus or not rest.startswith(("http://", "https://")):
        return None

    if scheme == "icechunk":
        return rest

    if scheme == "stac":
        with urllib.request.urlopen(rest, timeout=30) as response:
            collection = json.load(response)

        assets = collection.get("assets") or {}
        if STAC_ASSET not in assets:
            raise ValueError(
                f"STAC Collection {rest} has no {STAC_ASSET!r} asset "
                f"(it has: {', '.join(sorted(assets)) or 'none'})"
            )
        return assets[STAC_ASSET]["href"]

    return None


@lru_cache(maxsize=8)
def _open_icechunk(
    src_path: str,
    group: str | None,
    decode_times: bool,
    decode_coords: str,
    _deadline: int,
) -> xarray.Dataset:
    """Open one repository, memoised until `_deadline` moves.

    `_deadline` is a bucket number, not a time: it takes part in the cache key
    for no other reason than to change, which retires the entry that holds the
    previous one. A plain TTL would need a background sweep or a lock; this needs
    neither, and `maxsize` retires the stale entries.
    """
    import icechunk

    href = icechunk_href(src_path)
    assert href is not None, f"{src_path} is not an Icechunk url"

    config = icechunk.RepositoryConfig.default()
    config.caching = icechunk.CachingConfig(num_bytes_chunks=CHUNK_CACHE_BYTES)

    repo = icechunk.Repository.open(icechunk.http_storage(href), config=config)
    session = repo.readonly_session("main")

    open_args: dict[str, Any] = {
        "engine": "zarr",
        "decode_coords": decode_coords,
        "decode_times": decode_times,
    }
    if group is not None:
        open_args["group"] = group

    return xarray.open_dataset(session.store, **open_args)


def open_icechunk(
    src_path: str,
    group: str | None = None,
    decode_times: bool = True,
    decode_coords: str = "all",
    **kwargs: Any,
) -> xarray.Dataset:
    """Open an Icechunk repository as a dataset."""
    return _open_icechunk(
        src_path,
        group,
        decode_times,
        decode_coords,
        int(time.time() // CACHE_TTL),
    )


def open_any(src_path: str, **kwargs: Any) -> xarray.Dataset:
    """Open a store, whichever kind of store it turns out to be."""
    if icechunk_href(src_path) is not None:
        return open_icechunk(src_path, **kwargs)

    return open_zarr(src_path, **kwargs)


@attr.s
class AnyReader(Reader):
    """The stock Zarr reader, with an opener that also speaks Icechunk."""

    opener: Callable[..., xarray.Dataset] = attr.ib(default=open_any)


zarr_factory = XarrayTilerFactory(
    reader=AnyReader,
    router_prefix="/zarr",
    extensions=[
        DatasetMetadataExtension(),
        ValidateExtension(),
    ],
    enable_telemetry=api_settings.telemetry_enabled,
    templates=titiler_templates,
)

app.include_router(zarr_factory.router, prefix="/zarr", tags=["Zarr"])

if PRELOAD:
    threading.Thread(target=_keep_open, name="icechunk-preload", daemon=True).start()

