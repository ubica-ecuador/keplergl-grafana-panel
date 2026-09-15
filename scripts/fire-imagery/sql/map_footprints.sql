-- Las huellas de las escenas que pasan los filtros, para ver qué parte del
-- recuadro cubre cada una.
SELECT scene_id,
       strftime(acquired, '%d %b %Y') AS acquired_on,
       CAST(ST_AsGeoJSON(footprint) AS VARCHAR) AS geojson
FROM hit
