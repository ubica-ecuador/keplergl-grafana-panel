SELECT count(h.scene_id)                                   AS "Scenes",
       ROUND(min(h.cloud_cover), 1)                        AS "Min cloud",
       -- Lo que se ve mosaicando todas las escenas que pasan los filtros.
       ROUND(COALESCE(m2(ST_Intersection(any_value(a.geom), ST_Union_Agg(h.footprint)))
                      / m2(any_value(a.geom)) * 100, 0), 1) AS "Box covered",
       strftime(getvariable('win_from'), '%d %b') || ' → '
         || strftime(getvariable('win_to'), '%d %b %Y')
         || CASE WHEN getvariable('win_to') >= CAST(now() AS TIMESTAMP) - INTERVAL 1 MINUTE
                 THEN ' (until today)' ELSE '' END          AS "Searched",
       -- El estado y el recuento del catálogo, para que un fallo o un recorte no
       -- se lean como "no hay escenas".
       any_value(s.r->>'status')                           AS "HTTP",
       -- Un cuerpo que no es JSON no debe romper el panel: TRY lo vuelve NULL
       -- (TRY no admite un agregado dentro, así que any_value va por fuera).
       CAST(any_value(TRY(json_extract(s.r->>'body', '$.numberMatched'))) AS INTEGER)  AS "Matched",
       CAST(any_value(TRY(json_extract(s.r->>'body', '$.numberReturned'))) AS INTEGER) AS "Returned"
FROM aoi a
JOIN search s ON s.name = a.name
LEFT JOIN hit h ON h.name = a.name
-- Sin recuadro no hay grupos y el panel dice "No data". Sin GROUP BY, el
-- agregado devolvería una fila de ceros que se leería como una medición.
GROUP BY a.name
