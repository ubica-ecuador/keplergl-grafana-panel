-- El recuadro, como contorno sobre la imagen.
SELECT 'Your box' AS part,
       CAST(ST_AsGeoJSON(ST_GeomFromText(getvariable('drawn'))) AS VARCHAR) AS geojson
WHERE getvariable('drawn') IS NOT NULL
