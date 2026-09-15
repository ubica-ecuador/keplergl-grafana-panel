-- La hoja de contactos: cada miniatura es el recuadro recortado de esa escena
-- por el servidor de teselas, unos kilobytes, no una descarga.
SELECT 'https://titiler.ubica.ec/cog/bbox/'
         -- Recortado a donde la escena y el recuadro se tocan: a 30 px de alto, un
         -- recorte medio transparente es una mota gris.
         || ST_XMin(ST_Intersection(geom, footprint)) || ','
         || ST_YMin(ST_Intersection(geom, footprint)) || ','
         || ST_XMax(ST_Intersection(geom, footprint)) || ','
         || ST_YMax(ST_Intersection(geom, footprint))
         || '.png?url=' || url_encode(visual_href)
         || '&max_size=128'                                           AS "View",
       -- Texto: Grafana pasaría un TIMESTAMP al huso del navegador.
       strftime(acquired, '%d %b %Y  %H:%M')                          AS "Date",
       ROUND(cloud_cover, 1)                                          AS "Cloud %",
       ROUND(m2(ST_Intersection(geom, footprint)) / m2(geom) * 100, 1) AS "Covers %",
       -- Ocultas: alimentan el enlace de la fila. El centro de lo que enseña la
       -- miniatura, no el del recuadro.
       ST_Y(ST_Centroid(ST_Intersection(geom, footprint)))             AS centre_lat,
       ST_X(ST_Centroid(ST_Intersection(geom, footprint)))             AS centre_lng,
       visual_href                                                     AS scene_url
FROM hit
-- En orden de fecha: lo que interesa de un incendio es cómo cambia.
ORDER BY acquired, "Cloud %"
LIMIT 24
