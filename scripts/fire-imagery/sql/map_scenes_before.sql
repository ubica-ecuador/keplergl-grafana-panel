SELECT scene_id,
       -- Texto y no TIMESTAMP: un campo de tipo time daría a kepler un segundo
       -- selector de escena, su reloj, y cuando discrepa oculta la capa.
       strftime(acquired, '%d %b %Y  %H:%M') AS acquired_at,
       ROUND(cloud_cover, 1) AS cloud_cover,
       -- Sin CASE aquí: fi_hit_before (search.sql) ya eligió la única fila que
       -- hay que dibujar -la pinchada si sigue siendo candidata, si no la
       -- más reciente-, así que esta fila SIEMPRE se dibuja. Volver a
       -- comparar visual_href contra el pinchado aquí (como hacía antes)
       -- re-ocultaría justo la fila de repuesto cuando el pinchado es
       -- rancio: exactamente el lado en blanco que esto corrige.
       visual_href AS raster_url,
       -- El item del catálogo, para el falso color: las bandas viven en COGs
       -- separados a los que este item apunta. La imagen compuesta de arriba
       -- sigue siendo el camino rápido del color real.
       'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/' || scene_id
            AS raster_item_url,
       ROUND(fi_m2(ST_Intersection(geom, footprint)) / fi_m2(geom) * 100, 1) AS covers_pct,
       -- La huella viaja con la escena: una consulta alimenta a la vez la capa
       -- ráster y la de geometría, y así la pestaña no gasta una búsqueda más.
       CAST(ST_AsGeoJSON(footprint) AS VARCHAR) AS geojson
FROM fi_hit_before
-- fi_hit_before ya trae una sola fila (search.sql): la pinchada en la hoja si
-- sigue siendo candidata, si no la más reciente que pasa los cortes.
