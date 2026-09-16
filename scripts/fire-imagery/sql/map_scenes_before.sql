SELECT scene_id,
       -- Texto y no TIMESTAMP: un campo de tipo time daría a kepler un segundo
       -- selector de escena, su reloj, y cuando discrepa oculta la capa.
       strftime(acquired, '%d %b %Y  %H:%M') AS acquired_at,
       ROUND(cloud_cover, 1) AS cloud_cover,
       -- Elegida una escena en la hoja de contactos, las demás pierden el enlace
       -- y el catálogo se queda en esa sola.
       CASE WHEN getvariable('picked_before') IS NULL OR visual_href = getvariable('picked_before')
            THEN visual_href END AS raster_url,
       -- El item del catálogo, para el falso color: las bandas viven en COGs
       -- separados a los que este item apunta. La imagen compuesta de arriba
       -- sigue siendo el camino rápido del color real.
       CASE WHEN getvariable('picked_before') IS NULL OR visual_href = getvariable('picked_before')
            THEN 'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/' || scene_id
            END AS raster_item_url,
       ROUND(m2(ST_Intersection(geom, footprint)) / m2(geom) * 100, 1) AS covers_pct,
       -- La huella viaja con la escena: una consulta alimenta a la vez la capa
       -- ráster y la de geometría, y así la pestaña no gasta una búsqueda más.
       CAST(ST_AsGeoJSON(footprint) AS VARCHAR) AS geojson
FROM hit_before
-- hit_before ya trae una sola fila (ORDER BY acquired DESC LIMIT 1 en
-- search.sql): la más reciente que pasa los cortes.
