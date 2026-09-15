CREATE OR REPLACE TEMP MACRO m2(g) AS
  ST_Area(ST_Transform(g, 'EPSG:4326', 'EPSG:6933', always_xy := true));

-- El recuadro dibujado en el mapa de incendios. Sin recuadro no hay búsqueda.
SET VARIABLE drawn = nullif($burnArea, '');
-- La escena elegida en la hoja de contactos, si hay alguna.
SET VARIABLE picked = nullif($scene, '');
-- La ventana: desde el día en que empieza la ventana pausada del reloj hasta
-- n días después de su final, sin pasar de ahora. Sin reloj pausado, el rango
-- de tiempo del tablero.
SET VARIABLE win_from = date_trunc('day',
  coalesce(TRY_CAST(nullif($scanFrom, '') AS TIMESTAMP), CAST($__timeFrom() AS TIMESTAMP)));
SET VARIABLE win_to = least(
  coalesce(TRY_CAST(nullif($scanTo, '') AS TIMESTAMP), CAST($__timeTo() AS TIMESTAMP))
    + to_days(CAST($days AS INTEGER)),
  CAST(now() AS TIMESTAMP));
