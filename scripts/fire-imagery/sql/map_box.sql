-- El recuadro, como contorno sobre la imagen.
SELECT 'Your box' AS part,
       CAST(ST_AsGeoJSON(ST_GeomFromText(getvariable('fi_drawn'))) AS VARCHAR) AS geojson
WHERE getvariable('fi_drawn') IS NOT NULL
