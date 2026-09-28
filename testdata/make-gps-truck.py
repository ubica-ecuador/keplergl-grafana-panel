#!/usr/bin/env python3
"""Build the GPS truck track dashboard: a real road, a synthetic truck.

    python3 testdata/make-gps-truck.py            # from the saved route
    python3 testdata/make-gps-truck.py --fetch    # ask OSRM for the route again

The route is real: OSRM's public demo server routed it over OpenStreetMap from
Hamburg to Reading, Pennsylvania, along PA-61 — 27.5 km, the corridor of the CSS
Electronics truck demo this dashboard was modelled on. It is saved, trimmed to
the two things used (the geometry and OSRM's speed per segment), in
testdata/gps-truck/route.json, so a rebuild does not depend on somebody else's
demo server. Route data © OpenStreetMap contributors, ODbL.

Everything the truck does is made up, deterministically (seeded):

  * **Speed**, one sample a second: OSRM's speed per segment, capped at a
    truck's 86 km/h, slowed for curves (1.8 m/s² sideways), with seven stops of
    18–45 s at junctions, truck acceleration (0.55 m/s²) and braking
    (1.1 m/s²), and a slow drift of a few km/h around the target.
  * **Position**: the route walked at that speed, with ~1.5 m of GPS jitter.
  * **Elevation**: a smooth profile from the Blue Mountain foothills down to
    the Schuylkill at Reading, with a little sensor noise. Not a DEM.

Two copies of one dashboard are written, because the benches carry different
data sources and the data is inlined either way:

  * provisioning/dashboards/gpsTruckTrack.json — TestData, for :3000.
  * provisioning-sources/dashboards/gps-truck-track.json — Infinity, for :3002
    and grafana.ubica.ec, which have no TestData.

Neither source filters by time, so the map and the stats cut the rows to the
dashboard range with a `$__from`/`$__to` transformation — what `$__timeFilter`
would do in a database query. The map's time brush goes to two hidden
variables and comes back as an annotation region on the two graphs.
"""

import argparse
import json
import math
import random
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROUTE = ROOT / 'testdata' / 'gps-truck' / 'route.json'
OSRM = (
    'https://router.project-osrm.org/route/v1/driving/-75.9816,40.5557;-75.9270,40.3357'
    '?overview=full&geometries=geojson&annotations=speed'
)
START_MS = 1768313444000  # 2026-01-13T14:10:44Z, 09:10:44 in Pennsylvania
EARTH_RADIUS = 6371008.8
STEP = 5.0  # metres between points of the densified route


def fetch_route() -> None:
    with urllib.request.urlopen(OSRM, timeout=30) as response:
        route = json.load(response)['routes'][0]
    trimmed = {
        'source': 'OSRM demo server, ' + OSRM.split('?')[0],
        'attribution': '© OpenStreetMap contributors, ODbL',
        'coordinates': route['geometry']['coordinates'],
        'speed': route['legs'][0]['annotation']['speed'],
    }
    ROUTE.parent.mkdir(parents=True, exist_ok=True)
    ROUTE.write_text(json.dumps(trimmed) + '\n')


def haversine(a, b) -> float:
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dl, dp = math.radians(b[0] - a[0]), la2 - la1
    h = math.sin(dp / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS * math.asin(math.sqrt(h))


def bearing(a, b) -> float:
    y = math.sin(math.radians(b[0] - a[0])) * math.cos(math.radians(b[1]))
    x = math.cos(math.radians(a[1])) * math.sin(math.radians(b[1])) - math.sin(math.radians(a[1])) * math.cos(
        math.radians(b[1])
    ) * math.cos(math.radians(b[0] - a[0]))
    return math.degrees(math.atan2(y, x))


def drive(coords, seg_speed):
    """The route walked by a truck at one sample a second."""
    random.seed(7)
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + haversine(coords[i - 1], coords[i]))
    total = cum[-1]
    grid = [i * STEP for i in range(int(total // STEP) + 1)] + [total]

    def locate(s):
        lo, hi = 0, len(cum) - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        t = 0 if cum[hi] == cum[lo] else (s - cum[lo]) / (cum[hi] - cum[lo])
        a, b = coords[lo], coords[hi]
        return lo, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

    points, limit = [], []
    for s in grid:
        segment, point = locate(s)
        points.append(point)
        limit.append(min(seg_speed[min(segment, len(seg_speed) - 1)] * 0.95, 86 / 3.6))

    # Curves: the heading change over ±30 m bounds the speed.
    k = 6
    for i in range(k, len(points) - k):
        turn = abs((bearing(points[i], points[i + k]) - bearing(points[i - k], points[i]) + 180) % 360 - 180)
        if turn > 3:
            radius = (k * STEP) / math.radians(turn)
            limit[i] = min(limit[i], math.sqrt(1.8 * radius))

    for fraction in (0.0, 0.12, 0.38, 0.71, 0.86, 0.93, 1.0):
        limit[min(int(fraction * (len(points) - 1)), len(points) - 1)] = 0.0

    speed = limit[:]
    for i in range(1, len(speed)):
        speed[i] = min(speed[i], math.sqrt(speed[i - 1] ** 2 + 2 * 0.55 * STEP))
    for i in range(len(speed) - 2, -1, -1):
        speed[i] = min(speed[i], math.sqrt(speed[i + 1] ** 2 + 2 * 1.1 * STEP))

    stops = {i for i, v in enumerate(speed) if v == 0.0}
    rows, t, s, i, dwell_until, drift = [], 0.0, 0.0, 0, None, 0.0
    while i < len(points) - 1:
        if i in stops and dwell_until is None and 0 < i < len(points) - 1:
            dwell_until = t + random.randint(18, 45)
        if dwell_until is not None and t < dwell_until:
            v = 0.0
        else:
            if dwell_until is not None:
                stops.discard(i)
                dwell_until = None
            v = max(0.6, (speed[i] + speed[i + 1]) / 2)
        if v > 0:
            drift = 0.96 * drift + random.gauss(0, 0.28)
        shown = max(0.0, v + drift) if v > 0.6 else 0.0
        rows.append((START_MS + int(t * 1000), i, s, shown))
        s += v
        while i < len(points) - 1 and grid[i + 1] <= s:
            i += 1
        t += 1.0
    rows.append((START_MS + int(t * 1000), len(points) - 1, total, 0.0))
    return points, rows, total


def elevation(fraction: float) -> float:
    return (
        128
        - 58 * fraction
        + 22 * math.sin(2 * math.pi * fraction * 2.3 + 0.4)
        + 9 * math.sin(2 * math.pi * fraction * 7.1 + 1.3)
        + 3 * math.sin(2 * math.pi * fraction * 19.0)
    )


def track():
    route = json.loads(ROUTE.read_text())
    points, rows, total = drive(route['coordinates'], route['speed'])
    out = {k: [] for k in ('time', 'latitude', 'longitude', 'speed_kmh', 'elevation_m', 'distance_km')}
    for ms, idx, dist, v in rows:
        lon, lat = points[idx]
        lat += random.gauss(0, 1.5) / 111320
        lon += random.gauss(0, 1.5) / (111320 * math.cos(math.radians(lat)))
        out['time'].append(ms)
        out['latitude'].append(round(lat, 6))
        out['longitude'].append(round(lon, 6))
        out['speed_kmh'].append(round(v * 3.6, 1))
        out['elevation_m'].append(round(elevation(dist / total) + random.gauss(0, 0.4), 1))
        out['distance_km'].append(round(dist / 1000, 3))

    # Cumulative climb with a 3 m hysteresis, so sensor noise does not count as
    # climbing. Cumulative columns let a stat take `range` over any window.
    gain, ref, climb = 0.0, out['elevation_m'][0], []
    for e in out['elevation_m']:
        if e - ref >= 3:
            gain += e - ref
            ref = e
        elif ref - e >= 3:
            ref = e
        climb.append(round(gain, 1))
    out['climb_m'] = climb
    out['elapsed_s'] = [(x - out['time'][0]) // 1000 for x in out['time']]
    return out


COLUMNS = ['time', 'latitude', 'longitude', 'speed_kmh', 'elevation_m', 'distance_km', 'climb_m', 'elapsed_s']
TESTDATA = {'type': 'grafana-testdata-datasource', 'uid': 'trlxrdZVk'}
INFINITY = {'type': 'yesoreyeram-infinity-datasource', 'uid': 'infinity'}
DASHBOARD_DS = {'type': 'datasource', 'uid': '-- Dashboard --'}
# The map's quantize ramp matches Grafana's continuous-GrYlRd on the speed graph.
SPEED_COLORS = ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027']
# Neither source filters by time: this is the `$__timeFilter` a database would apply.
IN_RANGE = {
    'id': 'filterByValue',
    'options': {
        'type': 'include',
        'match': 'all',
        'filters': [
            {'fieldName': 'time', 'config': {'id': 'greaterOrEqual', 'options': {'value': '$__from'}}},
            {'fieldName': 'time', 'config': {'id': 'lowerOrEqual', 'options': {'value': '$__to'}}},
        ],
    },
}


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def map_target(data, source):
    if source == 'testdata':
        frame = [
            {
                'schema': {
                    'name': 'gps',
                    'fields': [{'name': n, 'type': 'time' if n == 'time' else 'number'} for n in COLUMNS],
                },
                'data': {'values': [data[n] for n in COLUMNS]},
            }
        ]
        return {'datasource': TESTDATA, 'refId': 'A', 'scenarioId': 'raw_frame', 'rawFrameContent': json.dumps(frame)}
    csv = '\n'.join([','.join(COLUMNS)] + [','.join(str(data[n][r]) for n in COLUMNS) for r in range(len(data['time']))])
    return {
        'datasource': INFINITY,
        'refId': 'A',
        'type': 'csv',
        'source': 'inline',
        'format': 'table',
        'parser': 'backend',
        'data': csv,
        'columns': [
            {'selector': n, 'text': n, 'type': 'timestamp_epoch' if n == 'time' else 'number'} for n in COLUMNS
        ],
    }


def brush_annotation(source):
    base = {
        'name': 'Map time brush',
        'enable': True,
        'hide': False,
        'iconColor': 'rgba(255, 179, 0, 0.22)',
        'filter': {'exclude': False, 'ids': [2, 3]},
    }
    if source == 'testdata':
        return {
            **base,
            'datasource': TESTDATA,
            'target': {
                'refId': 'Brush',
                'datasource': TESTDATA,
                'scenarioId': 'csv_content',
                'csvContent': 'time,timeEnd,text\n${brush_from},${brush_to},Map time brush',
            },
        }
    return {
        **base,
        'datasource': INFINITY,
        'target': {
            'refId': 'Brush',
            'type': 'json',
            'source': 'inline',
            'format': 'table',
            'parser': 'backend',
            'data': '[{"time":"${brush_from}","timeEnd":"${brush_to}","text":"Map time brush"}]',
            'columns': [
                {'selector': 'time', 'text': 'time', 'type': 'timestamp'},
                {'selector': 'timeEnd', 'text': 'timeEnd', 'type': 'timestamp'},
                {'selector': 'text', 'text': 'text', 'type': 'string'},
            ],
        },
    }


def stat(pid, title, x, field, calc, unit, color, decimals=None):
    return {
        'id': pid,
        'type': 'stat',
        'title': title,
        'gridPos': {'h': 4, 'w': 4, 'x': x, 'y': 0},
        'datasource': DASHBOARD_DS,
        'targets': [{'datasource': DASHBOARD_DS, 'refId': 'A', 'panelId': 1}],
        'transformations': [IN_RANGE],
        'fieldConfig': {
            'defaults': {
                'unit': unit,
                'color': {'mode': 'fixed', 'fixedColor': color},
                **({'decimals': decimals} if decimals is not None else {}),
            },
            'overrides': [],
        },
        'options': {
            'reduceOptions': {'calcs': [calc], 'fields': f'/^{field}$/', 'values': False},
            'colorMode': 'background',
            'graphMode': 'none',
            'textMode': 'value',
            'justifyMode': 'center',
        },
    }


def series(pid, title, y, field, unit, custom, color, extra=None):
    return {
        'id': pid,
        'type': 'timeseries',
        'title': title,
        'gridPos': {'h': 10, 'w': 12, 'x': 0, 'y': y},
        'datasource': DASHBOARD_DS,
        'targets': [{'datasource': DASHBOARD_DS, 'refId': 'A', 'panelId': 1}],
        'transformations': [{'id': 'filterFieldsByName', 'options': {'include': {'names': ['time', field]}}}],
        'fieldConfig': {
            # One axis width, so the two graphs' time axes line up.
            'defaults': {'unit': unit, 'color': color, 'custom': {**custom, 'axisWidth': 64}, **(extra or {})},
            'overrides': [],
        },
        'options': {'tooltip': {'mode': 'single'}, 'legend': {'showLegend': False}},
    }


def dashboard(data, source):
    t = data['time']
    map_panel = {
        'id': 1,
        'type': 'ubica-keplergl-panel',
        'title': 'GPS position',
        'description': 'Route © OpenStreetMap contributors (ODbL), routed by OSRM; speed and elevation are '
        'synthetic. Hover a graph, the track or the time bar: the others follow.',
        # Half the width: the minified time bar squeezes between two dates and needs room.
        'gridPos': {'h': 20, 'w': 12, 'x': 12, 'y': 4},
        'transformations': [IN_RANGE],
        'datasource': TESTDATA if source == 'testdata' else INFINITY,
        'targets': [map_target(data, source)],
        'options': {
            'showSidePanel': False,
            'timeSync': 'variables',
            'timeVariables': {'from': 'brush_from', 'to': 'brush_to'},
            'hoverSync': True,
            'hoverPublishSpike': True,
            'hoverMaxAgeSeconds': 10,
            'mapConfig': {
                'version': 'v1',
                'config': {
                    'visState': {
                        'layers': [
                            {
                                'id': 'gps-track',
                                'type': 'point',
                                'config': {
                                    'dataId': 'grafana-A',
                                    'label': 'GPS track',
                                    'columnMode': 'points',
                                    'columns': {'lat': 'latitude', 'lng': 'longitude'},
                                    'isVisible': True,
                                    'visConfig': {
                                        'radius': 3,
                                        'fixedRadius': False,
                                        'opacity': 0.9,
                                        'outline': False,
                                        'filled': True,
                                        'colorRange': {
                                            'name': 'Truck speed',
                                            'type': 'sequential',
                                            'category': 'Custom',
                                            'colors': SPEED_COLORS,
                                        },
                                    },
                                },
                                'visualChannels': {
                                    'colorField': {'name': 'speed_kmh', 'type': 'real'},
                                    'colorScale': 'quantize',
                                },
                            }
                        ],
                        'filters': [
                            {
                                'dataId': ['grafana-A'],
                                'id': 'gps-time',
                                'name': ['time'],
                                'type': 'timeRange',
                                'value': [t[0], t[-1]],
                                'enabled': True,
                                'view': 'minified',
                                'plotType': {'type': 'histogram'},
                                'animationWindow': 'free',
                                'speed': 1,
                                'timezone': 'America/New_York',
                            }
                        ],
                        'splitMaps': [],
                        'interactionConfig': {
                            'tooltip': {
                                'enabled': True,
                                'fieldsToShow': {
                                    'grafana-A': [
                                        {'name': 'speed_kmh', 'format': None},
                                        {'name': 'elevation_m', 'format': None},
                                        {'name': 'distance_km', 'format': None},
                                    ]
                                },
                            }
                        },
                    },
                    'mapState': {
                        'latitude': 40.447,
                        'longitude': -75.955,
                        'zoom': 10.6,
                        'bearing': 0,
                        'pitch': 0,
                        'dragRotate': False,
                    },
                    'mapStyle': {'styleType': 'grafana-topographic-terrain'},
                },
            },
        },
    }
    panels = [
        stat(10, 'Distance', 0, 'distance_km', 'range', 'lengthkm', '#1e88e5', 1),
        stat(11, 'Duration', 4, 'elapsed_s', 'range', 'dtdurations', '#3949ab'),
        stat(12, 'Average speed', 8, 'speed_kmh', 'mean', 'velocitykmh', '#43a047', 0),
        stat(13, 'Max speed', 12, 'speed_kmh', 'max', 'velocitykmh', '#fb8c00', 0),
        stat(14, 'Elevation gain', 16, 'climb_m', 'range', 'lengthm', '#8d6e63', 0),
        stat(15, 'Max elevation', 20, 'elevation_m', 'max', 'lengthm', '#6d4c41', 0),
        series(
            2,
            'Speed (km/h)',
            4,
            'speed_kmh',
            'velocitykmh',
            {'lineWidth': 2, 'fillOpacity': 20, 'gradientMode': 'scheme', 'showPoints': 'never'},
            {'mode': 'continuous-GrYlRd'},
            {'min': 0, 'max': 90},
        ),
        series(
            3,
            'Elevation (m)',
            14,
            'elevation_m',
            'lengthm',
            {'lineWidth': 2, 'fillOpacity': 35, 'gradientMode': 'opacity', 'showPoints': 'never'},
            {'mode': 'fixed', 'fixedColor': '#8d6e63'},
        ),
        map_panel,
    ]
    pad = 60_000
    return {
        'uid': 'gps-truck-track',
        'title': 'GPS truck track',
        'tags': ['kepler', 'gps', 'temporal-cursor'],
        'editable': True,
        # Shared crosshair: the graphs publish their cursor, and the map follows it.
        'graphTooltip': 1,
        'schemaVersion': 39,
        'panels': panels,
        'templating': {
            'list': [
                {
                    'name': name,
                    'label': name,
                    'type': 'textbox',
                    'hide': 2,
                    'query': '',
                    'current': {'text': '', 'value': ''},
                    'options': [],
                }
                for name in ('brush_from', 'brush_to')
            ]
        },
        'annotations': {
            'list': [
                {
                    'builtIn': 1,
                    'datasource': {'type': 'grafana', 'uid': '-- Grafana --'},
                    'enable': True,
                    'hide': True,
                    'iconColor': 'rgba(0, 211, 255, 1)',
                    'name': 'Annotations & Alerts',
                    'type': 'dashboard',
                },
                brush_annotation(source),
            ]
        },
        # Absolute, so the fixture never drifts out of its own range.
        'time': {'from': iso(t[0] - pad), 'to': iso(t[-1] + pad)},
        'timezone': 'America/New_York',
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--fetch', action='store_true', help='download the route from OSRM again')
    args = parser.parse_args()
    if args.fetch or not ROUTE.exists():
        fetch_route()
    data = track()
    outputs = {
        ROOT / 'provisioning' / 'dashboards' / 'gpsTruckTrack.json': 'testdata',
        ROOT / 'provisioning-sources' / 'dashboards' / 'gps-truck-track.json': 'infinity',
    }
    for path, source in outputs.items():
        path.write_text(json.dumps(dashboard(data, source), indent=2) + '\n')
        print(f'{path.relative_to(ROOT)}: {len(data["time"])} samples, {source}')


if __name__ == '__main__':
    main()
