# TiTiler, with one comparison in rio-tiler given a tolerance, and a `/zarr`
# router that also opens Icechunk repositories.
#
# Two changes that share an image because they share a reason: both exist so a
# public archive that the panel should be able to draw becomes drawable. The
# Icechunk half is explained at the top of `icechunk_app.py`; the tolerance is
# explained below.
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
# The patch gives the four comparisons a thousandth of a cell of slack, in both
# readers that carry them (`io/xarray.py` and `experimental/_zarr.py`; the
# `/zarr` router uses the latter). The tolerance scales with the grid rather
# than being a fixed number of degrees, because the residue grows with the
# number of steps in the coordinate array: 4e-13 here, but up to 8.6e-10 on a
# 0.001° global grid, which a fixed 1e-9 would barely clear. A thousandth of a
# cell stays far below any real overshoot at every resolution — a genuinely
# misplaced dataset is out by whole cells, not by a thousandth of one.
#
# It is applied as a patch rather than edited in place so `git diff` shows what
# changed against upstream, and so deleting one file and one build stanza puts
# the stock image back. It is the same change proposed upstream in
# https://github.com/cogeotiff/rio-tiler/pull/994; retire it when that ships.
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
assert 'xeps' in inspect.getsource(z.ZarrReader.__attrs_post_init__), 'zarr reader unpatched'; \
assert 'xeps' in inspect.getsource(x.XarrayReader.__attrs_post_init__), 'xarray reader unpatched'; \
print('rio-tiler bounds tolerance in place')"

# Icechunk. The wheel is `cp312-abi3`, so it installs on this image's Python 3.14
# through the stable ABI, and its only dependency is `zarr>=3.1` which the image
# already carries — no version of anything moves to make room for it.
RUN pip install --no-cache-dir "icechunk>=2,<3"

# The app that mounts the Icechunk-aware router. The base image launches
# `${MODULE_NAME}:${VARIABLE_NAME}` under gunicorn, so pointing MODULE_NAME at
# our module is the whole wiring — no command override in the compose file, and
# `docker run` on this image alone behaves the same as the deployed one.
COPY icechunk_app.py /opt/ubica/icechunk_app.py
ENV PYTHONPATH=/opt/ubica
ENV MODULE_NAME=icechunk_app

# Fail the build rather than the first request if the mount did not take. Read
# through the OpenAPI schema rather than `app.router.routes`, which holds
# FastAPI's private include wrappers; `paths` is the public view of the same
# thing and it also proves the routes actually resolved.
RUN python -c "\
import icechunk_app as a; \
paths = a.app.openapi()['paths']; \
zarr = [p for p in paths if p.startswith('/zarr')]; \
assert a.api_settings.disable_zarr, 'stock zarr router was not disabled: ours would be shadowed'; \
assert zarr, 'no /zarr paths mounted'; \
assert any(p.startswith('/cog') for p in paths), 'the other routers went missing'; \
assert a.zarr_factory.reader is a.AnyReader, 'router is not using AnyReader'; \
assert a.icechunk_href('https://example.com/x.zarr') is None, 'a plain store was routed to icechunk'; \
assert a.icechunk_href('icechunk+https://example.com/r.icechunk') == 'https://example.com/r.icechunk'; \
print(f'icechunk router in place, {len(zarr)} paths on /zarr')"
