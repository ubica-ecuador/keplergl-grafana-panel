# TiTiler, with one comparison in rio-tiler given a tolerance.
#
# The upstream image is used unchanged in every other respect; this exists for a
# single bug, and it is worth writing down because the symptom points nowhere
# near the cause.
#
# rio-tiler refuses a WGS84 dataset whose bounds fall outside (-180,-90,180,90),
# allowing half a cell of overshoot for grids whose outer cells are centred on
# the poles. CAMS publishes its global atmospheric composition forecast on a
# 0.4° grid whose south edge lands on -90.20000000000041 — which is -90.2 plus a
# float residue of 4e-13 — so the allowance misses by that much and every single
# tile answers `500 Invalid geographic bounds`. Nothing about the message
# suggests the data is fine and the arithmetic is not.
#
# The patch adds a 1e-9 degree tolerance to the four comparisons, in both
# readers that carry them (`io/xarray.py` and `experimental/_zarr.py`; the
# `/zarr` router uses the latter). A tolerance of 1e-9 degrees is about 0.1 mm
# on the ground: far below any real grid, far above any float residue.
#
# It is applied as a patch rather than edited in place so `git diff` shows what
# changed against upstream, and so deleting one file and one build stanza puts
# the stock image back. Retire it when rio-tiler ships the tolerance itself.
FROM ghcr.io/developmentseed/titiler:2.2.1

COPY rio-tiler-bounds-tolerance.patch /tmp/rio-tiler-bounds-tolerance.patch

# `--forward` so rebuilding on an image that already carries the fix is a no-op
# rather than an interactive prompt, and an explicit `python -c` afterwards so a
# patch that applied to nothing fails the build instead of shipping quietly.
RUN patch -p1 --forward -d /usr/local/lib/python3.14/site-packages \
      < /tmp/rio-tiler-bounds-tolerance.patch \
 && rm /tmp/rio-tiler-bounds-tolerance.patch \
 && python -c "\
import inspect, rio_tiler.experimental._zarr as z, rio_tiler.io.xarray as x; \
assert '_edge_eps' in inspect.getsource(z.ZarrReader.__attrs_post_init__), 'zarr reader unpatched'; \
assert '_edge_eps' in inspect.getsource(x.XarrayReader.__attrs_post_init__), 'xarray reader unpatched'; \
print('rio-tiler bounds tolerance in place')"
