-- Todo lo que esta pestaña deja puesto en la sesión lleva el prefijo fi_
-- (fire imagery): tablas temporales, variables de sesión y macros. El estado
-- de la conexión SOBREVIVE a la petición y el pool del datasource le presta
-- esa misma conexión a otros tableros contra el mismo DuckDB -leído en el
-- banco: el polígono de una sonda se recuperaba con getvariable quince
-- peticiones ajenas después-. Nuestras consultas siempre ESCRIBEN antes de
-- leer, así que a nosotros no nos rompe; lo que hace es filtrarse a los
-- demás, y `drawn`, `win_from` o `m2` son justo los nombres que pondría otro
-- tablero de mapas. El prefijo es lo único que lo evita.
CREATE OR REPLACE TEMP MACRO fi_m2(g) AS
  ST_Area(ST_Transform(g, 'EPSG:4326', 'EPSG:6933', always_xy := true));
-- El techo de tamaño del recuadro, en un solo sitio: search.sql lo usa para
-- cortar la búsqueda y figures.sql para explicar por qué no hay nada, y
-- ninguno de los dos debe repetir el número. Medido el 2026-09-16: un
-- recuadro de ~30 km responde en medio segundo; uno de ~1100 km tarda 25 s
-- en las cifras y tumba la hoja a los 74 s.
CREATE OR REPLACE TEMP MACRO fi_box_limit_m2() AS 20000 * 1e6;
-- Cuántas escenas de antes, las más recientes, enseña la hoja de contactos y
-- entre cuántas elige la automática la más despejada. Un solo número para las
-- dos cosas: la escena automática es siempre una de las que se ven.
CREATE OR REPLACE TEMP MACRO fi_before_shown() AS 6;

-- El recuadro dibujado en el mapa, compartido por todo el tablero (variable
-- `area`). Sin recuadro no hay búsqueda.
SET VARIABLE fi_drawn = nullif($area, '');
-- La ventana: desde el día en que empieza la ventana pausada del reloj hasta
-- n días después de su final, sin pasar de ahora. Sin reloj pausado, el rango
-- de tiempo del tablero.
SET VARIABLE fi_win_from = date_trunc('day',
  coalesce(TRY_CAST(nullif($scanFrom, '') AS TIMESTAMP), CAST($__timeFrom() AS TIMESTAMP)));
SET VARIABLE fi_win_to = least(
  coalesce(TRY_CAST(nullif($scanTo, '') AS TIMESTAMP), CAST($__timeTo() AS TIMESTAMP))
    + to_days(CAST($days AS INTEGER)),
  CAST(now() AS TIMESTAMP));
-- Hasta dónde mirar hacia atrás buscando escenas de antes. Los días justo
-- anteriores a un incendio suelen estar nublados o con humo, así que la ventana
-- es ancha a propósito. Lo que se ELIGE sale solo de las fi_before_shown() más
-- recientes (search.sql), para no saltar a otra estación; la fecha de lo que se
-- encuentre se enseña siempre.
SET VARIABLE fi_back_from = getvariable('fi_win_from') - to_days(CAST($lookback AS INTEGER));
-- Las dos escenas elegidas a mano en la hoja, una por lado.
SET VARIABLE fi_picked_before = nullif($sceneBefore, '');
SET VARIABLE fi_picked_after = nullif($sceneAfter, '');
