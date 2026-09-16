SELECT scene_id,
       -- Texto y no TIMESTAMP: un campo de tipo time daría a kepler un segundo
       -- selector de escena, su reloj, y cuando discrepa oculta la capa.
       strftime(acquired, '%d %b %Y  %H:%M') AS acquired_at,
       ROUND(cloud_cover, 1) AS cloud_cover,
       -- Solo la escena que se pinta lleva enlace: la decide fi_drawn_after
       -- (search.sql), la misma variable con la que la hoja de contactos la
       -- marca. Así el panel ya no elige por su cuenta tomando la primera fila,
       -- y la marca y el mapa no pueden discrepar.
       CASE WHEN visual_href = getvariable('fi_drawn_after') THEN visual_href END AS raster_url,
       -- El item del catálogo, para el falso color: las bandas viven en COGs
       -- separados a los que este item apunta. La imagen compuesta de arriba
       -- sigue siendo el camino rápido del color real.
       CASE WHEN visual_href = getvariable('fi_drawn_after')
            THEN 'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/' || scene_id
            END AS raster_item_url,
       ROUND(fi_m2(ST_Intersection(geom, footprint)) / fi_m2(geom) * 100, 1) AS covers_pct,
       -- La huella viaja con la escena: una consulta alimenta a la vez la capa
       -- ráster y la de geometría, y así la pestaña no gasta una búsqueda más.
       CAST(ST_AsGeoJSON(footprint) AS VARCHAR) AS geojson
FROM fi_hit_after
-- Solo orden de lectura para las huellas: qué escena se pinta ya no depende
-- de él (lo decide fi_drawn_after).
ORDER BY cloud_cover, acquired DESC, box_cover DESC, scene_id
