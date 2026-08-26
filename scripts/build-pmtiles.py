#!/usr/bin/env python3
"""Bakes the daily rainfall COGs into PMTiles archives the browser reads alone.

A PMTiles archive is a pyramid of finished images in one file, read over range
requests. Nothing serves it: kepler opens it directly, which is the whole point
— a plugin installed from the Grafana catalogue has no TiTiler to point at, and
this is the shape of raster that does not need one.

The tiles are cut by the TiTiler already in this repository's docker-compose,
which is not a contradiction: the server is used **once, here, to build the
file**, and never again at draw time. That is the trade in one line — the
colours are decided now instead of in the layer panel, and in exchange the map
needs nothing but a static file server.

    docker run --rm --network host \
      -v kepler-grafana_raster-derived:/derived \
      -v "$PWD/scripts":/scripts:ro \
      python:3.12-alpine sh -c 'pip install -q pmtiles && python /scripts/build-pmtiles.py'

Options: --max-zoom (default 6), --colormap, --rescale, --pattern.
"""

import argparse
import glob
import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

# South America, the window the COGs were cut to. Tiles outside it hold nothing
# and are never requested.
BBOX = (-82.0, -56.0, -34.0, 13.0)

# Zoom 6 is where the pyramid stops, and that is not a budget decision: CHIRPS
# is a 0.05° grid — about 5 km — and a zoom-6 tile already carries 0.022° per
# pixel. Everything above it would be the same measurement drawn larger, at
# four times the tiles per level. deck.gl scales the last level it has.
MAX_ZOOM = 6

# WebP, measured against the alternatives on one tile of real rain:
#   PNG RGBA 51 KB · PNG paletted 11 KB · JPEG 15 KB · **WebP 9 KB**
# JPEG has no alpha, which the pyramid's edges need; the PNGs cost four to five
# times as much for a picture already quantised to 30 mm in uint16 steps.
TILE_FORMAT = 'webp'


def tiles_for_bbox(zoom, bbox):
    """Every tile of a zoom level that touches the window, in tileid order."""
    west, south, east, north = bbox
    n = 2 ** zoom

    def x_of(lon):
        return int((lon + 180.0) / 360.0 * n)

    def y_of(lat):
        rad = math.radians(max(min(lat, 85.05112878), -85.05112878))
        return int((1.0 - math.asinh(math.tan(rad)) / math.pi) / 2.0 * n)

    for x in range(max(x_of(west), 0), min(x_of(east) + 1, n)):
        for y in range(max(y_of(north), 0), min(y_of(south) + 1, n)):
            yield zoom, x, y


def fetch_tile(server, cog, zoom, x, y, colormap, rescale):
    """One rendered tile, or None where the raster does not reach."""
    query = urllib.parse.urlencode(
        {'url': cog, 'colormap_name': colormap, 'rescale': rescale}
    )
    url = f'{server}/cog/tiles/WebMercatorQuad/{zoom}/{x}/{y}.{TILE_FORMAT}?{query}'
    try:
        with urllib.request.urlopen(url, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        # 404 is the ordinary answer for a tile the COG does not cover, and a
        # missing tile is not a missing archive: the pyramid simply has a hole
        # there, which is what a bounded raster looks like.
        if error.code in (404, 500):
            return None
        raise


def build(cog, out, server, colormap, rescale, max_zoom):
    """Writes one archive, and reports what it cost."""
    written = 0
    total_bytes = 0
    with open(out, 'wb') as handle:
        writer = Writer(handle)
        # Ascending tileid, which the writer requires and which zoom-then-row
        # order happens to give: tile ids are assigned along a Hilbert curve
        # within a level, and every id at zoom z is below every id at z+1.
        for zoom in range(0, max_zoom + 1):
            for tile in sorted(tiles_for_bbox(zoom, BBOX), key=lambda t: zxy_to_tileid(*t)):
                data = fetch_tile(server, cog, *tile, colormap, rescale)
                if not data:
                    continue
                writer.write_tile(zxy_to_tileid(*tile), data)
                written += 1
                total_bytes += len(data)

        if written == 0:
            raise RuntimeError(f'{cog}: no tiles')

        west, south, east, north = BBOX
        writer.finalize(
            {
                'tile_type': TileType.WEBP,
                # The tiles are compressed images already; gzipping them again
                # buys nothing and costs every reader a decompression.
                'tile_compression': Compression.NONE,
                'min_lon_e7': int(west * 1e7),
                'min_lat_e7': int(south * 1e7),
                'max_lon_e7': int(east * 1e7),
                'max_lat_e7': int(north * 1e7),
            },
            {'name': os.path.basename(out), 'attribution': 'CHIRPS · UCSB Climate Hazards Center'},
        )
    return written, total_bytes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server', default='http://localhost:8088')
    parser.add_argument('--dir', default='/derived')
    parser.add_argument('--pattern', default='chirps-*.tif')
    parser.add_argument('--colormap', default='blues')
    # 0..65534 is the range `fetch-chirps.mjs` quantised 0..30 mm into. Stated
    # rather than read back, because the archive has no way to carry it: past
    # this point the numbers are gone and only the colours remain.
    parser.add_argument('--rescale', default='0,65534')
    parser.add_argument('--max-zoom', type=int, default=MAX_ZOOM)
    args = parser.parse_args()

    cogs = sorted(glob.glob(os.path.join(args.dir, args.pattern)))
    if not cogs:
        sys.exit(f'Nothing matching {args.pattern} in {args.dir}')

    print(f'{len(cogs)} rásteres · zoom 0–{args.max_zoom} · rampa {args.colormap}')
    grand_total = 0
    for index, cog in enumerate(cogs, start=1):
        out = re.sub(r'\.tiff?$', '.pmtiles', cog)
        if os.path.exists(out):
            print(f'  [{index:3}/{len(cogs)}] {os.path.basename(out)} — ya estaba')
            continue
        written, size = build(cog, out, args.server, args.colormap, args.rescale, args.max_zoom)
        grand_total += size
        print(f'  [{index:3}/{len(cogs)}] {os.path.basename(out)}  {written} teselas · {size / 1024:.0f} KB')

    print(f'\nListo: {grand_total / 1024 / 1024:.1f} MB en {args.dir}')


if __name__ == '__main__':
    main()
