SELECT count(h.scene_id)                                   AS "Scenes",
       ROUND(min(h.cloud_cover), 1)                        AS "Min cloud",
       -- Lo que se ve mosaicando todas las escenas que pasan los filtros.
       ROUND(COALESCE(fi_m2(ST_Intersection(any_value(b.geom), ST_Union_Agg(h.footprint)))
                      / fi_m2(any_value(b.geom)) * 100, 0), 1) AS "Box covered",
       -- El recuadro se mide aunque la guarda haya cortado la búsqueda: las
       -- cifras son el único sitio donde se puede decir por qué no hay nada.
       -- El techo es fi_box_limit_m2() (prelude.sql), el mismo que usa la guarda.
       CASE WHEN fi_m2(any_value(b.geom)) > fi_box_limit_m2()
            THEN 'Box too large — draw a smaller one'
            ELSE strftime(getvariable('fi_win_from'), '%d %b') || ' → '
              || strftime(getvariable('fi_win_to'), '%d %b %Y')
              || CASE WHEN getvariable('fi_win_to') >= CAST(now() AS TIMESTAMP) - INTERVAL 1 MINUTE
                      THEN ' (until today)' ELSE '' END
       END                                                  AS "Searched",
       -- Si no hay «antes», decirlo: un lado en blanco sin explicación es el
       -- peor resultado posible de una comparación.
       coalesce((SELECT strftime(acquired, '%d %b %Y') FROM fi_hit_before), 'none in range') AS "Before",
       -- El estado y el recuento del catálogo, para que un fallo o un recorte no
       -- se lean como "no hay escenas".
       any_value(s.r->>'status')                           AS "HTTP",
       -- Un cuerpo que no es JSON no debe romper el panel: TRY lo vuelve NULL
       -- (TRY no admite un agregado dentro, así que any_value va por fuera).
       CAST(any_value(TRY(json_extract(s.r->>'body', '$.numberMatched'))) AS INTEGER)  AS "Matched",
       CAST(any_value(TRY(json_extract(s.r->>'body', '$.numberReturned'))) AS INTEGER) AS "Returned"
FROM fi_box_any b
LEFT JOIN fi_aoi a ON a.name = b.name
LEFT JOIN fi_search s ON s.name = a.name
LEFT JOIN fi_hit_after h ON h.name = a.name
-- Sin recuadro no hay grupos y el panel dice "No data". Sin GROUP BY, el
-- agregado devolvería una fila de ceros que se leería como una medición.
GROUP BY b.name
