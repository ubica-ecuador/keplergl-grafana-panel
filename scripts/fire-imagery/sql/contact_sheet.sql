-- La hoja de contactos: cada miniatura es el recuadro recortado de esa escena
-- por el servidor de teselas, unos kilobytes, no una descarga.
-- La miniatura sigue al desplegable: la hoja existe para ELEGIR escena, y un
-- índice en 128 px no ayuda a elegir.
SELECT CASE WHEN $bands IN ('forestBurn', 'infrared') THEN
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
-- referencia), así que un puñado de candidatas recientes basta para poder
-- cambiarla a mano; el de después es el catálogo que de verdad se recorre y
-- necesita más sitio. Con un LIMIT global, 90 días de "antes" se comían las
-- filas de "después" antes de llegar a ellas.
QUALIFY row_number() OVER (PARTITION BY side ORDER BY acquired DESC)
        <= CASE WHEN side = 'Before' THEN 6 ELSE 24 END
-- En orden de fecha: lo que interesa de un incendio es cómo cambia, el antes
-- primero.
ORDER BY acquired
