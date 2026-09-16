-- Una sola búsqueda, con el bbox del recuadro y la ventana ya ensanchada
-- hacia atrás en la URL: el catálogo filtra y devuelve decenas de escenas,
-- no miles. Corta en 200 sin avisar; las cifras comparan numberMatched con
-- numberReturned para que se vea.
--
-- Materializada (CREATE TABLE, no CTE): la resolución de picked_after de
-- más abajo necesita leer hit_after ya calculada, y una CTE no sobrevive a
-- su propia sentencia. Sigue siendo un único http_get por consulta de
-- panel -vive aquí, no se repite en cada fragmento.
CREATE OR REPLACE TEMP TABLE hit AS (
  WITH box_any AS (
    -- El recuadro sin filtrar por tamaño: las cifras lo necesitan aunque la
    -- guarda haya cortado la búsqueda, porque es el único sitio donde se puede
    -- decir por qué no hay nada. Su fragmento (figures.sql) empieza con SELECT
    -- y no puede añadir su propio CTE, así que vive aquí.
    SELECT 'box' AS name, ST_GeomFromText(getvariable('drawn')) AS geom
    WHERE getvariable('drawn') IS NOT NULL
  ),
  aoi AS (
    -- La guarda de tamaño (el techo vive en box_limit_m2(), en prelude.sql).
    -- Como el polígono se comparte con el resto del tablero, aquí puede llegar
    -- un encuadre de medio país que nadie dibujó para esto.
    SELECT * FROM box_any WHERE m2(geom) <= box_limit_m2()
  ),
  search AS (
    SELECT name, geom,
           http_get('https://earth-search.aws.element84.com/v1/search'
             || '?collections=sentinel-2-l2a'
             || '&bbox=' || ST_XMin(geom) || ',' || ST_YMin(geom) || ','
                         || ST_XMax(geom) || ',' || ST_YMax(geom)
             || '&datetime=' || strftime(getvariable('back_from'), '%Y-%m-%dT%H:%M:%SZ')
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
           ST_GeomFromGeoJSON(f->>'geometry')           AS footprint,
           -- El lado se decide contra el día en que se pausó el reloj, no
           -- contra el final de la ventana ensanchada.
           CASE WHEN (f->'properties'->>'datetime')::TIMESTAMP < getvariable('win_from')
                THEN 'Before' ELSE 'After' END              AS side
    FROM features
    WHERE (f->'properties'->>'eo:cloud_cover')::DOUBLE <= CAST($s2cloud AS DOUBLE)
  )
  -- El bbox acota; ST_Intersects afina. El corte de cobertura quita las escenas
  -- que solo rozan una esquina del recuadro.
  SELECT * FROM scenes
  WHERE ST_Intersects(geom, footprint)
    AND m2(ST_Intersection(geom, footprint)) / m2(geom) * 100 >= CAST($s2cover AS DOUBLE)
);

CREATE OR REPLACE TEMP TABLE hit_after AS (SELECT * FROM hit WHERE side = 'After');

-- Una escena elegida a mano que ya no está entre las candidatas de después
-- -de un recuadro anterior, por ejemplo- se trata como si no se hubiera
-- elegido nada. Sin esto, map_scenes.sql compara cada fila contra un valor
-- que no coincide con ninguna, ninguna fila gana raster_url, y el lado de
-- después se queda en blanco sin avisar -el mismo defecto que tenía antes
-- el lado de antes, pero aquí no hay una sola fila que sustituir: hay que
-- deshacer el pinchado para que el catálogo entero vuelva a dibujarse,
-- como si nada se hubiera elegido. El CASE de map_scenes.sql no cambia:
-- lee picked_after ya resuelto.
SET VARIABLE picked_after = (
  SELECT visual_href FROM hit_after WHERE visual_href = getvariable('picked_after') LIMIT 1
);

-- Del lado de antes solo se dibuja una: la que se pinchó en la hoja de
-- contactos, si sigue siendo candidata; si no (nada pinchado, o un
-- pinchado rancio de un recuadro anterior que ya no aparece aquí), la más
-- reciente que pase los cortes. Elegir primero y filtrar después -como
-- hacía esto con un LIMIT 1 ciego al pinchado- deja en blanco cinco de las
-- seis candidatas que la hoja ofrece a mano: map_scenes_before.sql dibuja
-- sin condición la fila que YA es hit_before (no vuelve a comparar contra
-- el pinchado), así que hit_before tiene que ser la fila correcta desde
-- aquí.
CREATE OR REPLACE TEMP TABLE hit_before AS (
  SELECT * FROM hit
  WHERE side = 'Before'
  QUALIFY row_number() OVER (
    ORDER BY CASE WHEN visual_href = coalesce(getvariable('picked_before'), '') THEN 0 ELSE 1 END,
             acquired DESC
  ) = 1
);
