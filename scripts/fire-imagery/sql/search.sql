-- Una sola búsqueda, con el bbox del recuadro y la ventana ya ensanchada
-- hacia atrás en la URL: el catálogo filtra y devuelve decenas de escenas,
-- no miles. Corta en 200 sin avisar; las cifras comparan numberMatched con
-- numberReturned para que se vea.
--
-- Cada etapa es su propia tabla temporal, no una CTE, y por dos razones a la
-- vez: la resolución de fi_picked_after/fi_picked_before de más abajo necesita leer
-- lo ya calculado (una CTE no sobrevive a su propia sentencia), y figures.sql
-- -que empieza por SELECT y no puede traer su propio WITH- lee fi_box_any,
-- fi_aoi y fi_search por su nombre. Enterrarlas dentro de otra sentencia las
-- deja fuera de alcance y el panel de cifras muere con un Catalog Error. Sigue
-- siendo un único http_get por consulta de panel: vive en `fi_search`, se
-- materializa una vez, y los demás fragmentos leen la tabla.
--
-- Todas llevan el prefijo fi_ (fire imagery) y no es cosmético. El datasource
-- mantiene un pool de conexiones y el estado de la conexión SOBREVIVE a la
-- petición: nuestras temporales siguen ahí cuando el pool le presta esa misma
-- conexión a OTRO tablero contra el mismo DuckDB. Y DuckDB resuelve el esquema
-- temporal antes que el principal, así que una temporal nuestra llamada
-- `search`, `hit` o `aoi` taparía en silencio una tabla real con ese nombre en
-- la consulta de otro. No es una carrera entre paneles -eso se midió y no
-- existe: cada consulta tiene su conexión en exclusiva-, es un nombre que se
-- queda puesto. Un prefijo propio es lo único que lo evita.

-- El recuadro sin filtrar por tamaño: las cifras lo necesitan aunque la
-- guarda haya cortado la búsqueda, porque es el único sitio donde se puede
-- decir por qué no hay nada.
CREATE OR REPLACE TEMP TABLE fi_box_any AS (
  SELECT 'box' AS name, ST_GeomFromText(getvariable('fi_drawn')) AS geom
  WHERE getvariable('fi_drawn') IS NOT NULL
);

-- La guarda de tamaño (el techo vive en fi_box_limit_m2(), en prelude.sql).
-- Como el polígono se comparte con el resto del tablero, aquí puede llegar
-- un encuadre de medio país que nadie dibujó para esto.
CREATE OR REPLACE TEMP TABLE fi_aoi AS (
  SELECT * FROM fi_box_any WHERE fi_m2(geom) <= fi_box_limit_m2()
);

-- El único http_get de la consulta. Materializado: figures.sql lee de aquí el
-- estado y los recuentos del catálogo sin volver a preguntar.
CREATE OR REPLACE TEMP TABLE fi_search AS (
  SELECT name, geom,
         http_get('https://earth-search.aws.element84.com/v1/search'
           || '?collections=sentinel-2-l2a'
           || '&bbox=' || ST_XMin(geom) || ',' || ST_YMin(geom) || ','
                       || ST_XMax(geom) || ',' || ST_YMax(geom)
           || '&datetime=' || strftime(getvariable('fi_back_from'), '%Y-%m-%dT%H:%M:%SZ')
           || '/' || strftime(getvariable('fi_win_to'), '%Y-%m-%dT%H:%M:%SZ')
           || '&limit=200') AS r
  FROM fi_aoi
);

CREATE OR REPLACE TEMP TABLE fi_hit AS (
  WITH features AS (
    -- Un cuerpo que no es JSON (página de error, o el vacío del tope de 10 s)
    -- no debe romper el panel: TRY lo vuelve NULL y unnest(NULL) da cero filas.
    SELECT name, geom, unnest(TRY(json_extract(r->>'body', '$.features[*]'))) AS f
    FROM fi_search
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
           CASE WHEN (f->'properties'->>'datetime')::TIMESTAMP < getvariable('fi_win_from')
                THEN 'Before' ELSE 'After' END              AS side
    FROM features
    WHERE (f->'properties'->>'eo:cloud_cover')::DOUBLE <= CAST($s2cloud AS DOUBLE)
  )
  -- El bbox acota; ST_Intersects afina. El corte de cobertura quita las escenas
  -- que solo rozan una esquina del recuadro.
  SELECT * FROM scenes
  WHERE ST_Intersects(geom, footprint)
    AND fi_m2(ST_Intersection(geom, footprint)) / fi_m2(geom) * 100 >= CAST($s2cover AS DOUBLE)
);

CREATE OR REPLACE TEMP TABLE fi_hit_after AS (SELECT * FROM fi_hit WHERE side = 'After');

-- Una escena elegida a mano que ya no está entre las candidatas de después
-- -de un recuadro anterior, por ejemplo- se trata como si no se hubiera
-- elegido nada. Sin esto, map_scenes.sql compara cada fila contra un valor
-- que no coincide con ninguna, ninguna fila gana raster_url, y el lado de
-- después se queda en blanco sin avisar -el mismo defecto que tenía antes
-- el lado de antes, pero aquí no hay una sola fila que sustituir: hay que
-- deshacer el pinchado para que el catálogo entero vuelva a dibujarse,
-- como si nada se hubiera elegido. El CASE de map_scenes.sql no cambia:
-- lee fi_picked_after ya resuelto.
SET VARIABLE fi_picked_after = (
  SELECT visual_href FROM fi_hit_after WHERE visual_href = getvariable('fi_picked_after') LIMIT 1
);

-- Lo mismo del lado de antes, y por el mismo motivo: un pinchado rancio tiene
-- que dejar de existir como valor, no solo perder el desempate de hit_before.
-- Quien lo lee además de fi_hit_before es contact_sheet.sql (columna set_before),
-- que lo arrastra a cada enlace de fila: sin resolverlo aquí, un pinchado de
-- un recuadro anterior se perpetúa para siempre en los enlaces mientras el
-- mapa ya dibuja otra escena. Resuelto, se vacía igual que set_after.
SET VARIABLE fi_picked_before = (
  SELECT visual_href FROM fi_hit
  WHERE side = 'Before' AND visual_href = getvariable('fi_picked_before') LIMIT 1
);

-- Del lado de antes solo se dibuja una: la que se pinchó en la hoja de
-- contactos, si sigue siendo candidata; si no (nada pinchado, o un pinchado
-- rancio de un recuadro anterior, que a estas alturas ya es NULL), la más
-- reciente que pase los cortes. Elegir primero y filtrar después -como hacía
-- esto con un LIMIT 1 ciego al pinchado- deja en blanco cinco de las seis
-- candidatas que la hoja ofrece a mano: map_scenes_before.sql dibuja sin
-- condición la fila que YA es fi_hit_before (no vuelve a comparar contra el
-- pinchado), así que fi_hit_before tiene que ser la fila correcta desde aquí.
CREATE OR REPLACE TEMP TABLE fi_hit_before AS (
  SELECT * FROM fi_hit
  WHERE side = 'Before'
  QUALIFY row_number() OVER (
    ORDER BY CASE WHEN visual_href = coalesce(getvariable('fi_picked_before'), '') THEN 0 ELSE 1 END,
             acquired DESC
  ) = 1
);
