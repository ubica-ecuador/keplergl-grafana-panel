WITH aoi AS (
  SELECT 'box' AS name, ST_GeomFromText(getvariable('drawn')) AS geom
  WHERE getvariable('drawn') IS NOT NULL
),
-- Una sola búsqueda, con el bbox del recuadro en la URL: el catálogo filtra y
-- devuelve decenas de escenas, no miles. Corta en 200 sin avisar; las cifras
-- comparan numberMatched con numberReturned para que se vea.
search AS (
  SELECT name, geom,
         http_get('https://earth-search.aws.element84.com/v1/search'
           || '?collections=sentinel-2-l2a'
           || '&bbox=' || ST_XMin(geom) || ',' || ST_YMin(geom) || ','
                       || ST_XMax(geom) || ',' || ST_YMax(geom)
           || '&datetime=' || strftime(getvariable('win_from'), '%Y-%m-%dT%H:%M:%SZ')
           || '/' || strftime(getvariable('win_to'), '%Y-%m-%dT%H:%M:%SZ')
           || '&limit=200') AS r
  FROM aoi
),
features AS (
  -- Un cuerpo que no es JSON (página de error, o el vacío del tope de 10 s)
  -- no debe romper el panel: TRY lo vuelve NULL y unnest(NULL) da cero filas.
  SELECT name, geom, unnest(TRY(json_extract(r->>'body', '$.features[*]'))) AS f
  FROM search
),
scenes AS (
  SELECT name, geom,
         f->>'id'                                     AS scene_id,
         (f->'properties'->>'datetime')::TIMESTAMP    AS acquired,
         (f->'properties'->>'eo:cloud_cover')::DOUBLE AS cloud_cover,
         f->'assets'->'visual'->>'href'               AS visual_href,
         ST_GeomFromGeoJSON(f->>'geometry')           AS footprint
  FROM features
  WHERE (f->'properties'->>'eo:cloud_cover')::DOUBLE <= CAST($s2cloud AS DOUBLE)
),
-- El bbox acota; ST_Intersects afina. El corte de cobertura quita las escenas
-- que solo rozan una esquina del recuadro.
hit AS (
  SELECT * FROM scenes
  WHERE ST_Intersects(geom, footprint)
    AND m2(ST_Intersection(geom, footprint)) / m2(geom) * 100 >= CAST($s2cover AS DOUBLE)
)
