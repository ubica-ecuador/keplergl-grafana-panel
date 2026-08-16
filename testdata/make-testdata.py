#!/usr/bin/env python3
"""Regenerate the fixtures in this directory.

Only needed when the sample data itself must change — the outputs are committed,
so the sources bench works without running this. Requires geopandas:

    pip install geopandas pyarrow

Everything here is deliberately hardcoded rather than random: the fixtures are
committed, so a regeneration that shuffled coordinates would produce a diff on
every run and make review meaningless.
"""

import json
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point, Polygon

HERE = Path(__file__).parent

# Landmarks around Cuenca, Ecuador. lat/lng are carried as plain columns too, so
# a query can render points without loading DuckDB's spatial extension.
POINTS = [
    ("Parque Calderón", -2.8973, -79.0045, "plaza", 1240),
    ("Catedral Nueva", -2.8977, -79.0051, "landmark", 980),
    ("Museo Pumapungo", -2.9053, -78.9967, "museum", 620),
    ("Mercado 10 de Agosto", -2.8998, -79.0028, "market", 1510),
    ("Puente Roto", -2.9016, -79.0006, "landmark", 430),
    ("Universidad de Cuenca", -2.9034, -79.0122, "campus", 2100),
    ("Terminal Terrestre", -2.8887, -78.9895, "transport", 1870),
    ("Aeropuerto Mariscal Lamar", -2.8894, -78.9843, "transport", 760),
    ("Turi Mirador", -2.9268, -79.0087, "viewpoint", 540),
    ("Parque de la Madre", -2.9021, -79.0069, "park", 1130),
    ("Mall del Río", -2.9142, -79.0011, "retail", 2450),
    ("Iglesia de San Sebastián", -2.8969, -79.0104, "landmark", 310),
]

# Four coarse zones covering the city, as axis-aligned boxes. Real parish shapes
# would be better data but worse fixtures: these stay readable in a diff.
ZONES = [
    ("Centro Histórico", -2.9040, -2.8930, -79.0100, -78.9980, 4820),
    ("El Ejido", -2.9130, -2.9040, -79.0100, -78.9980, 3610),
    ("Yanuncay", -2.9130, -2.9040, -79.0230, -79.0100, 2740),
    ("Machángara", -2.8930, -2.8820, -79.0000, -78.9860, 1950),
]


def build_points() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        {
            "name": [p[0] for p in POINTS],
            "category": [p[3] for p in POINTS],
            "visitors": [p[4] for p in POINTS],
            "point_latitude": [p[1] for p in POINTS],
            "point_longitude": [p[2] for p in POINTS],
        },
        geometry=[Point(p[2], p[1]) for p in POINTS],
        crs="EPSG:4326",
    )


def build_zones() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        {
            "name": [z[0] for z in ZONES],
            "population": [z[5] for z in ZONES],
        },
        geometry=[
            Polygon([(w, s), (e, s), (e, n), (w, n), (w, s)])
            for _, s, n, w, e, _ in ZONES
        ],
        crs="EPSG:4326",
    )


def main() -> None:
    points, zones = build_points(), build_zones()

    # GeoParquet — the geometry column lands as WKB with GeoParquet metadata,
    # which is what DuckDB's read_parquet + ST_GeomFromWKB consume.
    points.to_parquet(HERE / "cuenca-points.parquet", index=False)
    zones.to_parquet(HERE / "cuenca-zones.parquet", index=False)

    # GeoJSON for the Infinity URL path. Written by hand rather than via
    # to_file() to keep the output stable and readable in review.
    (HERE / "cuenca-zones.geojson").write_text(
        json.dumps(json.loads(zones.to_json()), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    # CSV, two flavours: kepler's <prefix>_latitude/<prefix>_longitude pairing,
    # and geometry embedded as WKT.
    points.drop(columns="geometry").to_csv(
        HERE / "cuenca-points.csv", index=False
    )
    zones.assign(geometry=zones.geometry.to_wkt()).to_csv(
        HERE / "cuenca-zones.csv", index=False
    )

    for f in sorted(HERE.glob("cuenca-*")):
        print(f"{f.name:28} {f.stat().st_size:>8,} bytes")


if __name__ == "__main__":
    main()
