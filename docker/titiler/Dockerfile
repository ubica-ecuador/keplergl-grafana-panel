# TiTiler, with rio-tiler floored at the release that fixes one bounds check,
# and a `/zarr` router that also opens Icechunk repositories.
#
# Two changes that share an image because they share a reason: both exist so a
# public archive that the panel should be able to draw becomes drawable. The
# Icechunk half is explained at the top of `icechunk_app.py`; the floor is
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
# float residue of 4e-13 — so the allowance missed by that much and every single
# tile answered `500 Invalid geographic bounds`. Nothing about the message
# suggested the data was fine and the arithmetic was not.
#
# This was carried as a patch until the fix landed upstream
# (https://github.com/cogeotiff/rio-tiler/pull/994, released in rio-tiler 9.4.4
# on 2026-09-09); now it is only a version floor. The four comparisons go
# through `rio_tiler.utils._check_geographic_bounds`, which compares with
# `math.isclose`. The residue is float noise on numbers of magnitude 90 and 180,
# so it scales with the coordinate and not with the cell: 4e-13 here, but
# 8.6e-10 on a 0.001° global grid and 6.0e-09 on a 0.0001° one — a fixed 1e-9
# would clear the first and reject the second. `math.isclose` is already
# denominated in the right unit; its default tolerance is 9e-08° at the poles,
# about a centimetre, inside a half-cell allowance that is 22 km on the CAMS
# grid. A genuinely misplaced dataset is out by whole cells and still raises.
#
# The floor has to be stated because no base image carries it yet: titiler's
# own range (`rio-tiler>=9.0,<10.0`) admits 9.4.4, but since 2.2.2 the image is
# built from a `uv.lock` that pins 9.4.3, and this 2.2.1 base ships 9.4.2.
# Delete the stanza once a base image ships 9.4.4 or newer.
FROM ghcr.io/developmentseed/titiler:2.2.1

# The check asserts the behaviour rather than the version: a floor only says
# which release was installed, and what matters is that the CAMS grid is
# accepted and a misplaced one is still refused. `_check_geographic_bounds` is
# private, so the import is also how a build would learn that a future rio-tiler
# moved it — which is why the upper bound is there.
RUN pip install --no-cache-dir "rio-tiler>=9.4.4,<10" \
 && python -c "\
import rio_tiler; \
from rio_tiler.utils import _check_geographic_bounds as within; \
assert within((-180.2, -90.20000000000041, 180.2, 90.2), 0.4, 0.4), 'the CAMS grid is still rejected'; \
assert not within((-181.0, -91.0, 181.0, 91.0), 0.4, 0.4), 'a misplaced grid is being accepted'; \
print(f'rio-tiler {rio_tiler.__version__} tolerates the float residue')"

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
