CREATE OR REPLACE TEMP MACRO m2(g) AS
  ST_Area(ST_Transform(g, 'EPSG:4326', 'EPSG:6933', always_xy := true));

-- El recuadro dibujado en el mapa, compartido por todo el tablero (variable
-- `area`). Sin recuadro no hay búsqueda.
SET VARIABLE drawn = nullif($area, '');
-- La ventana: desde el día en que empieza la ventana pausada del reloj hasta
-- n días después de su final, sin pasar de ahora. Sin reloj pausado, el rango
-- de tiempo del tablero.
SET VARIABLE win_from = date_trunc('day',
  coalesce(TRY_CAST(nullif($scanFrom, '') AS TIMESTAMP), CAST($__timeFrom() AS TIMESTAMP)));
SET VARIABLE win_to = least(
  coalesce(TRY_CAST(nullif($scanTo, '') AS TIMESTAMP), CAST($__timeTo() AS TIMESTAMP))
    + to_days(CAST($days AS INTEGER)),
  CAST(now() AS TIMESTAMP));
-- Hasta dónde mirar hacia atrás buscando la última imagen despejada. Los días
-- justo anteriores a un incendio suelen estar nublados o con humo, así que la
-- ventana es ancha a propósito; la fecha de lo que se encuentre se enseña
-- siempre, porque a 90 días la vegetación cambia por estación y no por fuego.
SET VARIABLE back_from = getvariable('win_from') - to_days(CAST($lookback AS INTEGER));
-- Las dos escenas elegidas a mano en la hoja, una por lado.
SET VARIABLE picked_before = nullif($sceneBefore, '');
SET VARIABLE picked_after = nullif($sceneAfter, '');
