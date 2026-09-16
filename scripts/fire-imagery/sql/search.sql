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
  WITH bodies AS (
    -- Un cuerpo que no es JSON (página de error, o el vacío del tope de 10 s)
    -- no debe romper el panel: TRY lo vuelve NULL y unnest(NULL) da cero filas.
    SELECT name, geom, TRY(json_extract(r->>'body', '$.features[*]')) AS fs
    FROM fi_search
  ),
  features AS (
    SELECT name, geom, unnest(fs) AS f
    FROM bodies
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
  ),
  -- El bbox acota; ST_Intersects afina.
  touching AS (
    SELECT *, fi_m2(ST_Intersection(geom, footprint)) / fi_m2(geom) * 100 AS box_cover
    FROM scenes
    WHERE ST_Intersects(geom, footprint)
  )
  -- El corte de cobertura quita las escenas que solo rozan una esquina.
  --
  -- recency_rank: la posición de la escena por antigüedad dentro de su lado,
  -- 1 la más reciente. De aquí salen a la vez las candidatas automáticas de
  -- antes (fi_before_shown(), en prelude.sql) y las filas que la hoja enseña,
  -- así que "las seis que la hoja ya enseña" es literalmente el mismo conjunto.
  --
  -- Todos los órdenes de esta pestaña terminan en box_cover DESC, scene_id, y
  -- nunca en el orden de la respuesta. Los empates son lo normal, no la
  -- excepción: dos teselas MGRS de una misma pasada tienen la misma hora y a
  -- menudo la misma nube en cuanto el recuadro cae en el borde (California).
  -- Y el mapa y la hoja se ejecutan por separado, cada uno con su propia
  -- petición al catálogo: un empate resuelto por el orden de la respuesta
  -- podría pintar una escena y marcar otra. La cobertura primero porque es de
  -- verdad mejor -cada tesela cubre otro trozo del recuadro-; el scene_id al
  -- final porque es único y no depende de nada.
  SELECT *,
         row_number() OVER (PARTITION BY side ORDER BY acquired DESC, box_cover DESC, scene_id) AS recency_rank
  FROM touching
  WHERE box_cover >= CAST($s2cover AS DOUBLE)
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

-- Del lado de antes solo se dibuja una. La que se pinchó en la hoja de
-- contactos, si sigue siendo candidata. Si no (nada pinchado, o un pinchado
-- rancio de un recuadro anterior, que a estas alturas ya es NULL): la más
-- despejada de las fi_before_shown() más recientes -las mismas que enseña la
-- hoja-, la más reciente entre las igual de despejadas, y luego cobertura e id.
--
-- Por qué no la más reciente sin más: los días justo antes de un incendio
-- suelen venir con nube o humo, y la más reciente puede ser un 37 % de nube
-- con un 3 % tres días antes (medido en California). Por qué no la más
-- despejada de toda la ventana: a 90 días puede ser de otra estación, y una
-- vegetación distinta se leería como daño del fuego. Las seis recientes son
-- el término medio acotado.
--
-- Elegir primero y filtrar después -como hacía esto con un LIMIT 1 ciego al
-- pinchado- deja en blanco las candidatas que la hoja ofrece a mano:
-- map_scenes_before.sql dibuja sin condición la fila que YA es fi_hit_before
-- (no vuelve a comparar contra el pinchado), así que fi_hit_before tiene que
-- ser la fila correcta desde aquí.
CREATE OR REPLACE TEMP TABLE fi_hit_before AS (
  SELECT * FROM fi_hit
  WHERE side = 'Before'
  QUALIFY row_number() OVER (
    ORDER BY CASE WHEN visual_href = coalesce(getvariable('fi_picked_before'), '') THEN 0
                  WHEN recency_rank <= fi_before_shown() THEN 1
                  ELSE 2 END,
             cloud_cover, acquired DESC, box_cover DESC, scene_id
  ) = 1
);

-- Lo que el mapa PINTA de cada lado, decidido aquí y en ningún otro sitio. Lo
-- leen map_scenes.sql (para pintarlo) y contact_sheet.sql (para marcarlo en la
-- hoja), así que la marca no puede separarse de lo dibujado: es el mismo valor.
--
-- Antes: la que queda en fi_hit_before (la regla está allí), sin más.
SET VARIABLE fi_drawn_before = (SELECT visual_href FROM fi_hit_before);
-- Después: la pinchada si sigue siendo candidata; si no, la más despejada de
-- todas, la más reciente entre las igual de despejadas, y luego cobertura e id
-- (ver recency_rank en fi_hit). A diferencia del antes no se acota a las
-- recientes: todo el lado de después cae en la ventana pausada y los días que
-- siguen, y no hay otra estación en la que caer.
--
-- Esta regla vivía antes a medias en el ORDER BY de map_scenes.sql y a medias
-- en la costumbre del panel de pintar la primera fila con raster_url
-- (src/data/rasterDataset.ts: las escenas sin fecha -acquired_at es texto- se
-- quedan en el orden de la consulta y gana la primera). Las filas sin
-- visual_href el panel las salta, así que aquí tampoco cuentan.
SET VARIABLE fi_drawn_after = coalesce(
  getvariable('fi_picked_after'),
  (SELECT visual_href FROM fi_hit_after
   WHERE visual_href IS NOT NULL
   ORDER BY cloud_cover, acquired DESC, box_cover DESC, scene_id
   LIMIT 1)
);
