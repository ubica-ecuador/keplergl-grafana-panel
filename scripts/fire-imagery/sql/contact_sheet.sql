-- La hoja de contactos: cada miniatura es el recuadro recortado de esa escena
-- por el servidor de teselas, unos kilobytes, no una descarga.
-- La miniatura sigue al desplegable: la hoja existe para ELEGIR escena, y un
-- índice en 128 px no ayuda a elegir.
-- La marca: qué escena está pintando el mapa en cada mitad de la cortina,
-- elegida a mano o no. Sale de fi_drawn_before/fi_drawn_after (search.sql), los
-- mismos valores con los que el mapa decide qué pintar -nada se recalcula aquí-,
-- así que la marca no puede decir otra cosa que el mapa. Un lado sin escena
-- ("none in range") no marca nada: es la verdad, no un hueco.
SELECT CASE WHEN side = 'Before' AND visual_href = getvariable('fi_drawn_before') THEN '◀'
            WHEN side = 'After'  AND visual_href = getvariable('fi_drawn_after')  THEN '▶'
       END                                                             AS "Map",
       CASE WHEN $bands IN ('forestBurn', 'infrared') THEN
              'https://titiler.ubica.ec/stac/bbox/'
                || ST_XMin(ST_Intersection(geom, footprint)) || ','
                || ST_YMin(ST_Intersection(geom, footprint)) || ','
                || ST_XMax(ST_Intersection(geom, footprint)) || ','
                || ST_YMax(ST_Intersection(geom, footprint))
                || '.png?url=' || url_encode('https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/' || scene_id)
                || CASE WHEN $bands = 'forestBurn'
                        THEN '&assets=swir22&assets=nir&assets=blue&rescale=0,4000&rescale=0,4000&rescale=0,4000'
                        ELSE '&assets=nir&assets=red&assets=green&rescale=0,3000&rescale=0,3000&rescale=0,3000' END
                || '&max_size=128'
            ELSE
              'https://titiler.ubica.ec/cog/bbox/'
                -- Recortado a donde la escena y el recuadro se tocan: a 30 px de alto, un
                -- recorte medio transparente es una mota gris.
                || ST_XMin(ST_Intersection(geom, footprint)) || ','
                || ST_YMin(ST_Intersection(geom, footprint)) || ','
                || ST_XMax(ST_Intersection(geom, footprint)) || ','
                || ST_YMax(ST_Intersection(geom, footprint))
                || '.png?url=' || url_encode(visual_href)
                || '&max_size=128'
            END                                                        AS "View",
       side                                                            AS "Side",
       -- Texto: Grafana pasaría un TIMESTAMP al huso del navegador.
       strftime(acquired, '%d %b %Y  %H:%M')                          AS "Date",
       ROUND(cloud_cover, 1)                                          AS "Cloud %",
       ROUND(fi_m2(ST_Intersection(geom, footprint)) / fi_m2(geom) * 100, 1) AS "Covers %",
       -- Ocultas: alimentan el enlace de la fila. El centro de lo que enseña la
       -- miniatura, no el del recuadro.
       ST_Y(ST_Centroid(ST_Intersection(geom, footprint)))             AS centre_lat,
       ST_X(ST_Centroid(ST_Intersection(geom, footprint)))             AS centre_lng,
       visual_href                                                     AS scene_url,
       -- Ocultas también: eligiendo una fila (que es de un solo lado) se
       -- conserva el enlace del otro lado, elegido a mano o no. Los valores
       -- vienen de fi_picked_before/fi_picked_after, derivados en el preludio de
       -- $sceneBefore y $sceneAfter.
       CASE WHEN side = 'Before' THEN visual_href ELSE coalesce(getvariable('fi_picked_before'), '') END AS set_before,
       CASE WHEN side = 'After'  THEN visual_href ELSE coalesce(getvariable('fi_picked_after'),  '') END AS set_after
FROM fi_hit
-- Cupo por lado, no global: del lado de antes solo se PINTA una escena (la
-- referencia), y la automática sale de estas mismas fi_before_shown() más
-- recientes (search.sql), así que la hoja enseña exactamente entre cuáles se
-- eligió; el de después es el catálogo que de verdad se recorre y necesita más
-- sitio. Con un LIMIT global, 90 días de "antes" se comían las filas de
-- "después" antes de llegar a ellas. El orden por antigüedad es recency_rank
-- (fi_hit), el mismo que usa la regla: con dos escenas empatadas en la sexta
-- plaza, la hoja y la regla cortan por la misma.
--
-- La escena pintada entra siempre, aunque el cupo la dejara fuera (la más
-- despejada de después puede ser más vieja que las 24 recientes, y una de antes
-- pinchada a mano, más vieja que las seis): una hoja que no enseña lo que el mapa
-- está pintando no puede marcarlo.
QUALIFY row_number() OVER (
          PARTITION BY side
          ORDER BY coalesce(visual_href = CASE WHEN side = 'Before' THEN getvariable('fi_drawn_before')
                                               ELSE getvariable('fi_drawn_after') END, false) DESC,
                   recency_rank)
        <= CASE WHEN side = 'Before' THEN fi_before_shown() ELSE 24 END
-- En orden de fecha: lo que interesa de un incendio es cómo cambia, el antes
-- primero. Cobertura e id detrás, para que dos teselas de una misma pasada no
-- cambien de sitio entre una carga y otra.
ORDER BY acquired, box_cover DESC, scene_id
