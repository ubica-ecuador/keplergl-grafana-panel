SELECT scene_id,
       -- Texto y no TIMESTAMP: un campo de tipo time daría a kepler un segundo
       -- selector de escena, su reloj, y cuando discrepa oculta la capa.
       strftime(acquired, '%d %b %Y  %H:%M') AS acquired_at,
       ROUND(cloud_cover, 1) AS cloud_cover,
       -- Elegida una escena en la hoja de contactos, las demás pierden el enlace
       -- y el catálogo se queda en esa sola.
       CASE WHEN getvariable('picked') IS NULL OR visual_href = getvariable('picked')
            THEN visual_href END AS raster_url,
       -- El item del catálogo, para el falso color: las bandas viven en COGs
       -- separados a los que este item apunta. La imagen compuesta de arriba
       -- sigue siendo el camino rápido del color real.
       CASE WHEN getvariable('picked') IS NULL OR visual_href = getvariable('picked')
            THEN 'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/' || scene_id
            END AS raster_item_url,
       ROUND(m2(ST_Intersection(geom, footprint)) / m2(geom) * 100, 1) AS covers_pct
FROM hit
-- Sin escena elegida se pinta la primera fila: la más despejada.
ORDER BY cloud_cover, acquired DESC
