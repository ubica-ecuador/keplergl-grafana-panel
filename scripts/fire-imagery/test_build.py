"""Tests del injerto de la pestaña Imagery.

Lo que protegen es lo que costó el tablero una vez: que nada de lo que ya
había cambie, y que un segundo injerto no duplique la pestaña.
"""
import base64
import copy
import json
import pathlib
import re
import sys
import unittest
import urllib.error
import urllib.request

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import build  # noqa: E402

NEW_VARIABLES = ['scanFrom', 'scanTo', 'sceneBefore', 'sceneAfter', 'sLat', 'sLng',
                 'days', 's2cloud', 's2cover', 'bands', 'lookback', 'aLat', 'aLng']

# Lo que el datasource pone en lugar de los macros de Grafana antes de mandar la
# consulta a DuckDB: una marca de tiempo entrecomillada. Medido en el banco.
TIME_FROM = "'2026-09-08T21:03:41Z'"
TIME_TO = "'2026-09-15T21:03:41Z'"


def expand_macro(match):
    name, argument = match.group(1), match.group(2).strip()
    if name == '__timeFrom':
        return TIME_FROM
    if name == '__timeTo':
        return TIME_TO
    # Un predicado, no un valor: el datasource lo cambia por una comparación
    # sobre la columna que le pasan.
    if name == '__timeFilter':
        return f'{argument} BETWEEN {TIME_FROM} AND {TIME_TO}'
    # Deliberadamente ruidoso: un macro nuevo que nadie sustituya volvería a
    # dejar pasar SQL que no parsea, que es justo lo que este módulo evita.
    raise AssertionError(f'macro de Grafana sin expandir: ${name}()')


def as_the_datasource_sends_it(sql):
    """La SQL tal como sale hacia DuckDB: macros y variables ya sustituidas.

    El navegador entrecomilla el valor de cada variable y el datasource expande
    los macros; ninguno de los dos mira si el resultado es SQL válida. Aquí solo
    importa la forma, así que el valor es lo de menos: un literal vacío sirve
    para cualquiera y no puede introducir un error de sintaxis propio.
    """
    sql = re.sub(r'\$(__\w+)\(([^()]*)\)', expand_macro, sql)
    return re.sub(r'\$\{?[A-Za-z]\w*\}?', "''", sql)


def panel_queries():
    """Cada `(elemento, refId, SQL)` que la pestaña manda al datasource."""
    dash = fixture()
    for key, element in sorted(build.imagery_elements(dash).items()):
        for query in element['spec']['data']['spec']['queries']:
            spec = query['spec']
            if spec['query']['group'] != build.DUCKDB_GROUP:
                continue
            yield key, spec['refId'], spec['query']['spec']['rawSql']


def band_values():
    """Los juegos de bandas que ofrece la pestaña, leídos del constructor.

    De su propia variable `bands` y no de una lista repetida aquí: una copia
    se queda atrás el día que se añade un juego, y entonces el test dice que
    cubre todas las ramas cuando ya no.
    """
    bands = next(v for v in build.variables() if v['spec']['name'] == 'bands')
    return bands['spec']['query'].split(',')


def fixture():
    return json.loads((HERE / 'fixtures' / 'fire-tabs-min.json').read_text())


def stac_join_fixture():
    return json.loads((build.REPO / 'provisioning-sources' / 'dashboards' / 'stac-join.json').read_text())


class GraftTest(unittest.TestCase):
    def setUp(self):
        self.dash = fixture()

    def grafted(self):
        return build.graft(self.dash, build.imagery_elements(self.dash))

    def test_imagery_tab_is_appended_last(self):
        tabs = self.grafted()['spec']['layout']['spec']['tabs']
        self.assertEqual([t['spec']['title'] for t in tabs], ['Global', 'Timeline - playback', 'Imagery'])

    def test_existing_content_is_untouched(self):
        before = copy.deepcopy(self.dash)
        out = self.grafted()
        self.assertEqual(self.dash, before, 'graft must not mutate its input')
        for key, element in before['spec']['elements'].items():
            self.assertEqual(out['spec']['elements'][key], element)
        n = len(before['spec']['variables'])
        self.assertEqual(out['spec']['variables'][:n], before['spec']['variables'])
        self.assertEqual(out['spec']['layout']['spec']['tabs'][:2], before['spec']['layout']['spec']['tabs'])
        self.assertEqual(out['metadata'], before['metadata'])

    def test_adds_the_thirteen_variables_in_order(self):
        names = [v['spec']['name'] for v in self.grafted()['spec']['variables']]
        self.assertEqual(names[2:], NEW_VARIABLES)

    def test_refuses_a_second_graft(self):
        once = self.grafted()
        with self.assertRaisesRegex(build.GraftError, 'Imagery'):
            build.graft(once, build.imagery_elements(once))

    def test_refuses_an_element_key_collision(self):
        self.dash['spec']['elements']['panel-21'] = copy.deepcopy(self.dash['spec']['elements']['panel-1'])
        with self.assertRaisesRegex(build.GraftError, 'panel-21'):
            self.grafted()

    def test_refuses_a_panel_id_collision(self):
        self.dash['spec']['elements']['panel-1']['spec']['id'] = 21
        with self.assertRaisesRegex(build.GraftError, '21'):
            self.grafted()

    def test_refuses_a_variable_collision(self):
        self.dash['spec']['variables'].append({'kind': 'TextVariable', 'spec': {'name': 'days'}})
        with self.assertRaisesRegex(build.GraftError, 'days'):
            self.grafted()

    def test_fire_map_publishes_its_window_and_box_and_drops_the_smoke(self):
        spec = self.grafted()['spec']['elements']['panel-21']['spec']
        options = spec['vizConfig']['spec']['options']
        self.assertEqual(options['timeSync'], 'variables')
        self.assertEqual(options['timeVariables'], {'from': 'scanFrom', 'to': 'scanTo'})
        self.assertFalse(options['publishWhilePlaying'])
        self.assertFalse(options['peerTimeSync'])
        self.assertEqual(options['areaVariable'], 'area')
        for gone in ('rasterColormap', 'zarrRescale', 'windDensity'):
            self.assertNotIn(gone, options)
        vis = options['mapConfig']['config']['visState']
        self.assertEqual([layer['id'] for layer in vis['layers']], ['puntos'])
        self.assertEqual(vis['layerOrder'], ['puntos'])
        queries = spec['data']['spec']['queries']
        self.assertEqual([q['spec']['refId'] for q in queries], ['A'])
        # Its own query must not read what it publishes, or the clock resets.
        sql = queries[0]['spec']['query']['spec']['rawSql']
        for name in NEW_VARIABLES:
            self.assertNotIn(name, sql)

    def test_fire_map_does_not_publish_the_global_tabs_variables(self):
        # panel-8's variableMappings drive minval/maxval, which the Global tab's
        # panels read; the Imagery tab must not write to them.
        elements = self.grafted()['spec']['elements']
        options = elements['panel-21']['spec']['vizConfig']['spec']['options']
        self.assertEqual(options['variableMappings'], [])
        for key in ('panel-21', 'panel-22', 'panel-23', 'panel-24'):
            blob = json.dumps(elements[key]['spec']['vizConfig']['spec']['options'])
            self.assertNotIn('minval', blob)
            self.assertNotIn('maxval', blob)

    def test_local_copy_has_its_own_uid_and_no_server_metadata(self):
        out = build.local_copy(self.grafted())
        self.assertEqual(out['metadata'], {'name': 'fire-emissions-tabs-local'})
        self.assertTrue(out['spec']['title'].endswith(' (local copy)'))
        self.assertEqual(out['apiVersion'], 'dashboard.grafana.app/v2beta1')


SQL_NAMES = ['prelude', 'search', 'map_box', 'map_scenes', 'map_scenes_before',
            'contact_sheet', 'figures']


class SqlTest(unittest.TestCase):
    def test_no_comment_names_a_grafana_macro(self):
        # La expansión de macros es textual: uno dentro de un comentario la rompe.
        for name in SQL_NAMES:
            for number, line in enumerate(build.read_sql(name).splitlines(), 1):
                comment = line.split('--', 1)[1] if '--' in line else ''
                self.assertNotIn('$__', comment, f'{name}.sql:{number}')

    def test_only_known_variables_are_referenced(self):
        # `area` is not one of this tab's own variables: it is the
        # dashboard-wide drawn-shape variable, already present before this
        # tab is grafted in (Global, Country and Region all publish to it).
        known = {variable['spec']['name'] for variable in build.variables()} | {'area'}
        for name in SQL_NAMES:
            referenced = set(re.findall(r'\$\{?([A-Za-z]\w*)', build.read_sql(name)))
            self.assertLessEqual(referenced, known, name)

    def test_panel_sql_joins_prelude_search_and_select(self):
        full = build.panel_sql('map_scenes')
        self.assertTrue(full.startswith(build.read_sql('prelude')))
        self.assertIn(build.read_sql('search'), full)
        self.assertTrue(full.endswith(build.read_sql('map_scenes')))
        self.assertNotIn('http_get', build.panel_sql('map_box', with_search=False))

    def test_every_panel_query_parses(self):
        # Lo que ningún otro test miraba: que la SQL sea SQL. A una pieza se le
        # cayó el SELECT al editarla y la consulta quedó en un `WITH` seguido de
        # un `CASE`: el panel salía al servidor con un error del parser en lugar
        # de con una tabla, y ni el injerto ni los tests se enteraban. Se parsea
        # lo que de verdad se manda —lo que lleva cada panel de la pestaña— y no
        # una lista de nombres escrita a mano, que se queda corta el día que se
        # añade un panel.
        checked = 0
        for key, ref_id, sql in panel_queries():
            with self.subTest(panel=key, refId=ref_id):
                try:
                    statements = duckdb.extract_statements(as_the_datasource_sends_it(sql))
                except duckdb.Error as error:
                    self.fail(f'{key}/{ref_id}: {error}')
                # Y que lo último sea lo que llena el panel: una SELECT. Un
                # panel alimentado por un SET o un CREATE parsea y devuelve
                # cero filas, que es la otra forma de llegar rota al servidor.
                self.assertEqual(statements[-1].type, duckdb.StatementType.SELECT, f'{key}/{ref_id}')
            checked += 1
        self.assertGreaterEqual(checked, 5)

    def test_catalogue_body_is_parsed_defensively(self):
        # Un cuerpo que no es JSON (una página de error, o el vacío del tope de
        # tiempo) no debe romper el panel: TRY lo convierte en NULL.
        for name in ('search', 'figures'):
            sql = build.read_sql(name)
            count = sql.count('json_extract(')
            self.assertGreaterEqual(count, 1, name)
            self.assertEqual(sql.count('TRY(json_extract('), count, name)


class BeforeAfterSqlTest(unittest.TestCase):
    def test_one_search_per_panel_query(self):
        # La ventana ensanchada existe para esto: dos http_get en una consulta
        # significa que alguien volvió a buscar por separado cada lado.
        for name in ('map_scenes', 'map_scenes_before', 'contact_sheet', 'figures'):
            sql = build.panel_sql(name)
            self.assertEqual(sql.count('http_get('), 1, name)

    def test_the_search_window_reaches_back(self):
        prelude = build.read_sql('prelude')
        self.assertIn('back_from', prelude)
        self.assertIn('lookback', prelude)
        self.assertIn('back_from', build.read_sql('search'))

    def test_sides_are_split_by_the_paused_day(self):
        search = build.read_sql('search')
        self.assertIn("'Before'", search)
        self.assertIn("'After'", search)
        self.assertIn('win_from', search)

    def test_the_size_guard_lives_in_one_place_and_is_commented(self):
        # El número vive en el macro box_limit_m2() (prelude.sql); search.sql
        # (la guarda) y figures.sql (el aviso al usuario) deben leerlo de ahí,
        # no repetirlo, o un cambio a uno deja al otro mintiendo.
        prelude = build.read_sql('prelude')
        self.assertEqual(prelude.count('20000'), 1, 'el umbral va en un solo sitio')
        line = next(l for l in prelude.splitlines() if '20000' in l)
        self.assertTrue(any('--' in l for l in prelude.splitlines()[:prelude.splitlines().index(line)]))
        for name in ('search', 'figures'):
            sql = build.read_sql(name)
            self.assertNotIn('20000', sql, f'{name}.sql must not repeat the threshold')
            self.assertIn('box_limit_m2()', sql, f'{name}.sql must read the shared macro')

    def test_picking_one_side_keeps_the_other(self):
        sheet = build.read_sql('contact_sheet')
        self.assertIn('set_before', sheet)
        self.assertIn('set_after', sheet)
        self.assertIn('sceneBefore', sheet)
        self.assertIn('sceneAfter', sheet)

    def test_the_sheet_reserves_room_per_side(self):
        # Un LIMIT global deja que 90 días de "antes" se coman las filas de
        # "después" antes de llegar a ellas (reproducido en vivo con los
        # valores por defecto, no un caso raro). El cupo tiene que ir por
        # lado. Un grep de 'QUALIFY' a secas pasaría con una cláusula que no
        # reparte nada, así que también se comprueba la partición y que no
        # quede un LIMIT global a la vez.
        sheet = build.read_sql('contact_sheet')
        self.assertIn('QUALIFY', sheet, 'the per-row cap must use QUALIFY, not a global LIMIT')
        self.assertIn('PARTITION BY side', sheet, 'the cap must be windowed per side')
        self.assertNotIn('LIMIT 30', sheet, 'a global LIMIT would starve one side again')


class ContactSheetSidesHermeticTest(unittest.TestCase):
    """La guarantía de verdad: sin banco, sin red. Sustituye el único
    http_get( ... ) AS r de search.sql por un cuerpo JSON escrito a mano -ocho
    escenas "antes" del día pausado, tres "después"- y ejecuta la consulta
    real de contact_sheet.sql contra ella con el duckdb del sistema. Si esto
    se salta o pasa con una cláusula degenerada, nada más en la suite lo nota:
    ContactSheetSidesLiveTest (más abajo) es un bonus útil, no la garantía -
    se salta sin red, y no corre en CI.
    """

    # Un recuadro pequeño y las mismas geometrías que el recuadro: así
    # ST_Intersects y el corte de cobertura (puesto a 0 de todos modos) no
    # dependen de acertar un solape exacto.
    BOX = 'POLYGON ((-122.0 39.0, -121.9 39.0, -121.9 39.1, -122.0 39.1, -122.0 39.0))'
    GEOMETRY = {'type': 'Polygon', 'coordinates': [[[-122.0, 39.0], [-121.9, 39.0], [-121.9, 39.1],
                                                    [-122.0, 39.1], [-122.0, 39.0]]]}
    # El día pausado es 2026-06-15. Ocho fechas "antes" (todas antes de
    # win_from) para que el cupo de 6 tenga algo que recortar de verdad, y
    # tres "después" (entre win_from y win_to) para comprobar que ese lado
    # no se toca.
    BEFORE_DATES = ['2026-03-20T19:00:00Z', '2026-03-25T19:00:00Z', '2026-04-01T19:00:00Z',
                    '2026-04-10T19:00:00Z', '2026-04-20T19:00:00Z', '2026-05-01T19:00:00Z',
                    '2026-05-15T19:00:00Z', '2026-06-10T19:00:00Z']
    AFTER_DATES = ['2026-06-15T12:00:00Z', '2026-06-16T19:00:00Z', '2026-06-17T19:00:00Z']
    CASE = dict(area=BOX, sceneBefore='', sceneAfter='', scanFrom='2026-06-15T00:00:00.000Z',
               scanTo='2026-06-15T23:59:59.000Z', days='3', lookback='90',
               # Sin filtro de nube ni de cobertura: lo único bajo prueba es
               # el reparto por lado, no los otros cortes.
               s2cloud='100', s2cover='0', bands='trueColor')

    @staticmethod
    def _sql_quote(value):
        return "'" + str(value).replace("'", "''") + "'"

    def _canned_body(self):
        def feature(index, when):
            return {'id': f'SYN_{index}', 'properties': {'datetime': when, 'eo:cloud_cover': 5.0},
                   'assets': {'visual': {'href': f'https://example.test/{index}.tif'}},
                   'geometry': self.GEOMETRY}
        dates = self.BEFORE_DATES + self.AFTER_DATES
        features = [feature(i, when) for i, when in enumerate(dates)]
        return json.dumps({'type': 'FeatureCollection', 'features': features,
                           'numberMatched': len(features), 'numberReturned': len(features)})

    def _canned_sql(self):
        # Cambia el único http_get(...) AS r de search.sql por un valor fijo
        # con la misma forma (un STRUCT con 'status' y 'body'): todo lo demás
        # -aoi, features, scenes, hit, hit_after/before, y el QUALIFY de
        # contact_sheet.sql- corre sin tocar.
        sql = build.panel_sql('contact_sheet')
        canned = "{'status': 200, 'body': " + self._sql_quote(self._canned_body()) + "} AS r"
        sql, count = re.subn(r'http_get\(.*?\) AS r', canned, sql, count=1, flags=re.DOTALL)
        self.assertEqual(count, 1, 'expected exactly one http_get(...) AS r to replace')
        sql = re.sub(r'\$(__\w+)\(([^()]*)\)', expand_macro, sql)
        return re.sub(r'\$\{?([A-Za-z]\w*)\}?', lambda m: self._sql_quote(self.CASE[m.group(1)]), sql)

    def _run(self, sql):
        try:
            con = duckdb.connect()
            con.execute('INSTALL spatial; LOAD spatial;')
        except duckdb.Error as error:
            self.skipTest(f'the spatial extension is not loadable in this duckdb: {error}')
        result = con.execute(sql)
        columns = [d[0] for d in result.description]
        return [dict(zip(columns, row)) for row in result.fetchall()]

    def test_before_side_is_capped_and_after_side_is_not(self):
        rows = self._run(self._canned_sql())
        sides = [row['Side'] for row in rows]
        # 8 candidatas "antes" recortadas a 6 (el cupo corta de verdad, no
        # deja pasar todo); 3 candidatas "después" intactas (24 de cupo no
        # llega a rozarlas). Un LIMIT global de 30 dejaría pasar las 11 sin
        # recortar nada -el número de abajo es lo que lo distingue de eso-,
        # y un QUALIFY sin PARTITION BY (o con el CASE al revés) tampoco daría
        # este 6/3 exacto.
        self.assertEqual(sides.count('Before'), 6, f'before must be capped to 6, got {sides!r}')
        self.assertEqual(sides.count('After'), 3, f'after must stay at all 3, got {sides!r}')
        self.assertEqual(len(rows), 9)
        # Las 6 que sobreviven son las más recientes de las 8: el cupo
        # descarta por antigüedad, no al azar.
        dates = sorted(row['Date'] for row in rows if row['Side'] == 'Before')
        self.assertNotIn('20 Mar 2026  19:00', dates)
        self.assertNotIn('25 Mar 2026  19:00', dates)


class BeforePickHermeticTest(unittest.TestCase):
    """Sin banco, sin red: pins the round-2 review fix directly against
    map_scenes_before.sql (not just the contact sheet's column list).

    Before this fix, `hit_before` (search.sql) always picked the most
    recent Before candidate regardless of `$sceneBefore`, and
    map_scenes_before.sql's own CASE then hid raster_url/raster_item_url
    whenever the picked scene did not match that one row — which is every
    row in the contact sheet's six Before candidates except the top one,
    and is guaranteed whenever the pick is stale (a scene from an earlier
    box). Both cases must now draw something, never a blank side.
    """

    BOX = 'POLYGON ((-122.0 39.0, -121.9 39.0, -121.9 39.1, -122.0 39.1, -122.0 39.0))'
    GEOMETRY = {'type': 'Polygon', 'coordinates': [[[-122.0, 39.0], [-121.9, 39.0], [-121.9, 39.1],
                                                    [-122.0, 39.1], [-122.0, 39.0]]]}
    # Todas antes del día pausado (2026-06-15): la más reciente es la última
    # (índice 2, 10 Jun) y NO es la que se pincha en los dos primeros tests.
    BEFORE_DATES = ['2026-05-01T19:00:00Z', '2026-05-15T19:00:00Z', '2026-06-10T19:00:00Z']
    BASE_CASE = dict(area=BOX, sceneAfter='', scanFrom='2026-06-15T00:00:00.000Z',
                     scanTo='2026-06-15T23:59:59.000Z', days='3', lookback='90',
                     s2cloud='100', s2cover='0', bands='trueColor')

    @staticmethod
    def _sql_quote(value):
        return "'" + str(value).replace("'", "''") + "'"

    def _canned_body(self):
        def feature(index, when):
            return {'id': f'SYN_{index}', 'properties': {'datetime': when, 'eo:cloud_cover': 5.0},
                   'assets': {'visual': {'href': f'https://example.test/{index}.tif'}},
                   'geometry': self.GEOMETRY}
        features = [feature(i, when) for i, when in enumerate(self.BEFORE_DATES)]
        return json.dumps({'type': 'FeatureCollection', 'features': features,
                           'numberMatched': len(features), 'numberReturned': len(features)})

    def _canned_sql(self, scene_before):
        sql = build.panel_sql('map_scenes_before')
        canned = "{'status': 200, 'body': " + self._sql_quote(self._canned_body()) + "} AS r"
        sql, count = re.subn(r'http_get\(.*?\) AS r', canned, sql, count=1, flags=re.DOTALL)
        self.assertEqual(count, 1, 'expected exactly one http_get(...) AS r to replace')
        sql = re.sub(r'\$(__\w+)\(([^()]*)\)', expand_macro, sql)
        case = dict(self.BASE_CASE, sceneBefore=scene_before)
        return re.sub(r'\$\{?([A-Za-z]\w*)\}?', lambda m: self._sql_quote(case[m.group(1)]), sql)

    def _run(self, scene_before):
        try:
            con = duckdb.connect()
            con.execute('INSTALL spatial; LOAD spatial;')
        except duckdb.Error as error:
            self.skipTest(f'the spatial extension is not loadable in this duckdb: {error}')
        result = con.execute(self._canned_sql(scene_before))
        columns = [d[0] for d in result.description]
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
        self.assertEqual(len(rows), 1, 'map_scenes_before.sql must always draw exactly one row')
        return rows[0]

    def test_picking_a_non_latest_before_candidate_draws_it(self):
        # Index 0 (01 May) is a real candidate but not the most recent one
        # (index 2, 10 Jun) — picking it must win, not the deterministic
        # "most recent" default.
        row = self._run('https://example.test/0.tif')
        self.assertEqual(row['scene_id'], 'SYN_0')
        self.assertEqual(row['raster_url'], 'https://example.test/0.tif')
        self.assertIsNotNone(row['raster_item_url'])

    def test_a_stale_pick_falls_back_to_the_most_recent_instead_of_going_blank(self):
        # A scene from a box drawn earlier: not among today's candidates at
        # all. Blank is the one outcome the design forbids.
        row = self._run('https://example.test/from-a-previous-box.tif')
        self.assertEqual(row['scene_id'], 'SYN_2', 'must fall back to the most recent candidate')
        self.assertEqual(row['raster_url'], 'https://example.test/2.tif')
        self.assertIsNotNone(row['raster_url'], 'the before side must never go blank')
        self.assertIsNotNone(row['raster_item_url'], 'the before side must never go blank')

    def test_no_pick_still_shows_the_most_recent(self):
        # The untouched default path: no one has clicked a row yet.
        row = self._run('')
        self.assertEqual(row['scene_id'], 'SYN_2')
        self.assertEqual(row['raster_url'], 'https://example.test/2.tif')


class AfterPickHermeticTest(unittest.TestCase):
    """Sin banco, sin red: pins the round-3 review fix directly against
    map_scenes.sql. Mirrors BeforePickHermeticTest, but the after side
    keeps every candidate row (unlike hit_before, which is one row), so
    the failure mode is different: a stale picked_after used to leave
    EVERY row's raster_url NULL, because map_scenes.sql's own CASE only
    shows a row when it matches the pick -no match anywhere means no row
    matches, ever. contact_sheet.sql carries the other side's pick
    forward on every row link, and drawing a new box does not clear it,
    so this is reachable in ordinary use: pick a scene, draw a box
    somewhere else, and the after side went blank with no message.

    The fix resolves picked_after against hit_after before map_scenes.sql
    runs (search.sql), so a stale pick behaves as no pick at all rather
    than map_scenes.sql's CASE changing.
    """

    BOX = 'POLYGON ((-122.0 39.0, -121.9 39.0, -121.9 39.1, -122.0 39.1, -122.0 39.0))'
    GEOMETRY = {'type': 'Polygon', 'coordinates': [[[-122.0, 39.0], [-121.9, 39.0], [-121.9, 39.1],
                                                    [-122.0, 39.1], [-122.0, 39.0]]]}
    # Todas después del día pausado (2026-06-15): el lado de antes queda
    # vacío a propósito, no es lo que se prueba aquí.
    AFTER_DATES = ['2026-06-16T19:00:00Z', '2026-06-17T19:00:00Z', '2026-06-18T19:00:00Z']
    BASE_CASE = dict(area=BOX, sceneBefore='', scanFrom='2026-06-15T00:00:00.000Z',
                     scanTo='2026-06-15T23:59:59.000Z', days='3', lookback='90',
                     s2cloud='100', s2cover='0', bands='trueColor')

    @staticmethod
    def _sql_quote(value):
        return "'" + str(value).replace("'", "''") + "'"

    def _canned_body(self):
        def feature(index, when):
            return {'id': f'SYN_{index}', 'properties': {'datetime': when, 'eo:cloud_cover': 5.0},
                   'assets': {'visual': {'href': f'https://example.test/{index}.tif'}},
                   'geometry': self.GEOMETRY}
        features = [feature(i, when) for i, when in enumerate(self.AFTER_DATES)]
        return json.dumps({'type': 'FeatureCollection', 'features': features,
                           'numberMatched': len(features), 'numberReturned': len(features)})

    def _canned_sql(self, scene_after):
        sql = build.panel_sql('map_scenes')
        canned = "{'status': 200, 'body': " + self._sql_quote(self._canned_body()) + "} AS r"
        sql, count = re.subn(r'http_get\(.*?\) AS r', canned, sql, count=1, flags=re.DOTALL)
        self.assertEqual(count, 1, 'expected exactly one http_get(...) AS r to replace')
        sql = re.sub(r'\$(__\w+)\(([^()]*)\)', expand_macro, sql)
        case = dict(self.BASE_CASE, sceneAfter=scene_after)
        return re.sub(r'\$\{?([A-Za-z]\w*)\}?', lambda m: self._sql_quote(case[m.group(1)]), sql)

    def _run(self, scene_after):
        try:
            con = duckdb.connect()
            con.execute('INSTALL spatial; LOAD spatial;')
        except duckdb.Error as error:
            self.skipTest(f'the spatial extension is not loadable in this duckdb: {error}')
        result = con.execute(self._canned_sql(scene_after))
        columns = [d[0] for d in result.description]
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
        self.assertEqual(len(rows), 3, 'all three after candidates must always come back')
        return rows

    # Before the drawn-scene rule moved into search.sql (fi_drawn_after), these
    # two tests asserted that EVERY row kept raster_url with no pick. That was
    # the frame shape, not the guarantee: the panel only ever drew the first
    # linked row. The guarantee -the after side never goes blank, and with no
    # pick it draws the automatic choice- is what they pin now. All three
    # candidates share cloud 5, so the automatic choice is the most recent.

    def test_a_stale_after_pick_draws_the_catalogue_instead_of_going_blank(self):
        # A scene from a box drawn earlier: not among today's candidates.
        rows = self._run('https://example.test/from-a-previous-box.tif')
        self.assertEqual(the_plugin_draws(rows), 'https://example.test/2.tif',
                         'a stale pick must fall back to the automatic choice, not blank the side')
        drawn = [r for r in rows if r['raster_url'] is not None]
        self.assertEqual(len(drawn), 1)
        self.assertIsNotNone(drawn[0]['raster_item_url'])

    def test_picking_a_specific_after_candidate_selects_only_it(self):
        rows = self._run('https://example.test/1.tif')
        drawn = [r for r in rows if r['raster_url'] is not None]
        self.assertEqual(len(drawn), 1, 'picking one candidate must not draw the others')
        self.assertEqual(drawn[0]['scene_id'], 'SYN_1')
        self.assertEqual(drawn[0]['raster_url'], 'https://example.test/1.tif')

    def test_no_pick_still_draws_the_automatic_choice(self):
        # The untouched default path: no one has clicked a row yet.
        rows = self._run('')
        self.assertEqual(the_plugin_draws(rows), 'https://example.test/2.tif')


class EveryPanelQueryRunsTest(unittest.TestCase):
    """Sin banco, sin red: EJECUTA todas las consultas de la pestaña.

    El agujero que esto tapa: test_every_panel_query_parses usa
    duckdb.extract_statements, que analiza la sintaxis pero NO resuelve
    nombres, así que una consulta que lee una tabla inexistente pasa.
    Justo eso llegó al banco: al pasar search.sql de CTEs de primer nivel
    a CREATE TEMP TABLE, box_any/aoi/search quedaron enterradas dentro de
    otra sentencia y figures.sql -el único sitio donde se enseñan «Box too
    large — draw a smaller one» y «none in range»- murió con un Catalog
    Error en los cuatro estados, sin que nada en la suite se enterara.

    Aquí se ejecuta de verdad cada consulta que el constructor emite (las
    de los cuatro paneles, no una lista escrita a mano), contra un cuerpo
    del catálogo enlatado que sustituye al único http_get, en el duckdb
    del sistema. Cualquier nombre que no exista sale como error, no como
    un test verde. Y se ejecuta en los estados que de verdad se dan en el
    tablero -recuadro dibujado, sin recuadro, recuadro enorme-, porque el
    de arriba fallaba en los tres por igual.
    """

    BOX = 'POLYGON ((-122.0 39.0, -121.9 39.0, -121.9 39.1, -122.0 39.1, -122.0 39.0))'
    # Un recuadro de tamaño estatal: pasa de box_limit_m2() y la guarda corta
    # la búsqueda. El camino por el que figures.sql tiene que seguir dando una
    # fila (la del aviso) aunque no haya ni aoi ni escenas.
    HUGE_BOX = 'POLYGON ((-124.4 32.5, -114.1 32.5, -114.1 42.0, -124.4 42.0, -124.4 32.5))'
    GEOMETRY = {'type': 'Polygon', 'coordinates': [[[-122.0, 39.0], [-121.9, 39.0], [-121.9, 39.1],
                                                    [-122.0, 39.1], [-122.0, 39.0]]]}
    # El día pausado es 2026-06-15: dos escenas antes y dos después.
    DATES = ['2026-04-20T19:00:00Z', '2026-06-10T19:00:00Z',
             '2026-06-16T19:00:00Z', '2026-06-17T19:00:00Z']
    BASE_CASE = dict(area=BOX, sceneBefore='', sceneAfter='',
                     scanFrom='2026-06-15T00:00:00.000Z', scanTo='2026-06-15T23:59:59.000Z',
                     days='3', lookback='90', s2cloud='100', s2cover='0', bands='forestBurn')
    # panel-21 no compone su SQL: la copia del mapa de incendios de la
    # pestaña Timeline, que lee la tabla del tablero anfitrión. Para poder
    # ejecutarla igual que las demás se le pone delante una tabla con esa
    # forma; lo que se comprueba de ella es que la consulta corre, no los
    # datos del incendio.
    HOST_SEED = ("CREATE OR REPLACE TEMP TABLE px AS "
                 "SELECT CAST(now() AS TIMESTAMP) AS dt, 39.0 AS lat, -122.0 AS lon, 1.0 AS value;")

    @staticmethod
    def _sql_quote(value):
        return "'" + str(value).replace("'", "''") + "'"

    def _canned_body(self, clouds=None):
        clouds = clouds or [5.0] * len(self.DATES)

        def feature(index, when, cloud):
            return {'id': f'SYN_{index}', 'properties': {'datetime': when, 'eo:cloud_cover': cloud},
                    'assets': {'visual': {'href': f'https://example.test/{index}.tif'}},
                    'geometry': self.GEOMETRY}
        features = [feature(i, when, cloud)
                    for i, (when, cloud) in enumerate(zip(self.DATES, clouds))]
        return json.dumps({'type': 'FeatureCollection', 'features': features,
                           'numberMatched': len(features), 'numberReturned': len(features)})

    def _runnable(self, sql, case, clouds=None):
        canned = "{'status': 200, 'body': " + self._sql_quote(self._canned_body(clouds)) + "} AS r"
        sql, count = re.subn(r'http_get\(.*?\) AS r', canned, sql, count=1, flags=re.DOTALL)
        # map_box.sql no busca nada: cero http_get es correcto ahí, dos no lo
        # sería en ninguna (test_one_search_per_panel_query lo fija).
        self.assertLessEqual(count, 1)
        sql = re.sub(r'\$(__\w+)\(([^()]*)\)', expand_macro, sql)
        return re.sub(r'\$\{?([A-Za-z]\w*)\}?', lambda m: self._sql_quote(case[m.group(1)]), sql)

    def _connect(self):
        try:
            con = duckdb.connect()
            con.execute('INSTALL spatial; LOAD spatial;')
        except duckdb.Error as error:
            self.skipTest(f'the spatial extension is not loadable in this duckdb: {error}')
        con.execute(self.HOST_SEED)
        return con

    def _rows(self, sql, case, clouds=None):
        con = self._connect()
        result = con.execute(self._runnable(sql, case, clouds))
        columns = [d[0] for d in result.description]
        return [dict(zip(columns, row)) for row in result.fetchall()]

    def _cases(self):
        return {
            'box drawn': dict(self.BASE_CASE),
            'no box drawn': dict(self.BASE_CASE, area=''),
            'box too large': dict(self.BASE_CASE, area=self.HUGE_BOX),
        }

    def test_every_panel_query_executes_in_every_state(self):
        checked = 0
        for state, case in self._cases().items():
            for key, ref_id, sql in panel_queries():
                with self.subTest(state=state, panel=key, refId=ref_id):
                    try:
                        self._rows(sql, case)
                    except duckdb.Error as error:
                        self.fail(f'{key}/{ref_id} ({state}): {error}')
                checked += 1
        self.assertGreaterEqual(checked, 18, 'los cuatro paneles, en los tres estados')

    def test_every_panel_query_executes_for_every_band_value(self):
        # `$bands` parte en dos contact_sheet.sql (el /stac/bbox del falso
        # color contra el /cog/bbox de la imagen compuesta): con un solo valor,
        # la otra rama se analiza pero no se ejecuta nunca, y lo que construye
        # son las URLs de las miniaturas -si se rompen, se rompen en silencio y
        # a la vista. Los valores salen del propio constructor (la variable
        # `bands`), no de una segunda lista escrita a mano que se desincronice.
        # En el estado con recuadro, que es el único con filas donde la rama
        # llega a evaluarse.
        values = band_values()
        self.assertEqual(len(values), 5, f'la variable bands ofrece {values!r}')
        checked = 0
        for band in values:
            case = dict(self.BASE_CASE, bands=band)
            for key, ref_id, sql in panel_queries():
                with self.subTest(band=band, panel=key, refId=ref_id):
                    try:
                        self._rows(sql, case)
                    except duckdb.Error as error:
                        self.fail(f'{key}/{ref_id} (bands={band}): {error}')
                checked += 1
        self.assertGreaterEqual(checked, 30, 'los cuatro paneles, en los cinco juegos de bandas')

    def test_each_band_value_builds_the_thumbnail_it_promises(self):
        # Ejecutar no basta: la rama equivocada devolvería una URL perfectamente
        # formada que pinta otra cosa. El falso color necesita las bandas
        # sueltas del item STAC (/stac/bbox con &assets=), el resto la imagen
        # compuesta ya empaquetada (/cog/bbox sobre visual_href).
        sheet = next(s for k, _, s in panel_queries() if k == 'panel-23')
        for band in band_values():
            with self.subTest(band=band):
                rows = self._rows(sheet, dict(self.BASE_CASE, bands=band))
                self.assertTrue(rows)
                for row in rows:
                    if band in ('forestBurn', 'infrared'):
                        self.assertIn('/stac/bbox/', row['View'])
                        self.assertIn('&assets=', row['View'])
                    else:
                        self.assertIn('/cog/bbox/', row['View'])
                        self.assertNotIn('&assets=', row['View'])

    def test_nothing_left_in_the_session_squats_on_plain_names(self):
        # El estado de la conexión sobrevive a la petición y el pool del
        # datasource le presta esa misma conexión a otros tableros contra el
        # mismo DuckDB. Una temporal nuestra llamada `search`, `hit` o `aoi`
        # tapa en silencio una tabla real de otro con ese nombre (DuckDB
        # resuelve el esquema temporal antes que el principal), y una variable
        # de sesión llamada `drawn` se le aparece a quien lea getvariable sin
        # haber escrito -medido en el banco, quince peticiones ajenas
        # después-. Los macros dejan el mismo rastro.
        #
        # El guardián mira LOS TRES tipos en TODOS los fragmentos, y no solo
        # en search.sql: acotarlo a un fichero es justo lo que deja pasar
        # media renombrada.
        kinds = {
            'tabla temporal': r'CREATE OR REPLACE TEMP TABLE (\w+)',
            'variable de sesión': r'SET VARIABLE (\w+)',
            'macro': r'CREATE OR REPLACE TEMP MACRO (\w+)',
        }
        found = 0
        for name in SQL_NAMES:
            sql = build.read_sql(name)
            for kind, pattern in kinds.items():
                for created in re.findall(pattern, sql):
                    found += 1
                    self.assertTrue(created.startswith('fi_'),
                                    f'{name}.sql: {kind} `{created}` necesita el prefijo fi_')
        # Seis tablas, seis variables (dos reescritas otra vez en search.sql) y
        # dos macros. Si este número baja, alguien dejó de crear algo y el
        # bucle de arriba se quedaría sin nada que comprobar, en verde.
        self.assertGreaterEqual(found, 16, f'solo se encontraron {found} objetos de sesión')

    def test_a_drawn_box_gives_every_panel_its_rows(self):
        # Ejecutar sin error no basta: una consulta que devuelve cero filas
        # deja el panel en "No data", que es la otra forma de llegar roto.
        case = dict(self.BASE_CASE)
        for key, ref_id, sql in panel_queries():
            if key == 'panel-21':
                continue  # la copia del mapa de incendios lee datos del anfitrión
            with self.subTest(panel=key, refId=ref_id):
                self.assertTrue(self._rows(sql, case), f'{key}/{ref_id} devolvió cero filas')

    def test_the_figures_panel_says_why_a_large_box_found_nothing(self):
        # El aviso de tamaño solo sale aquí: si esta fila desaparece, el
        # usuario dibuja medio país y no ve nada ni sabe por qué.
        figures = next(s for k, _, s in panel_queries() if k == 'panel-24')
        rows = self._rows(figures, dict(self.BASE_CASE, area=self.HUGE_BOX))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['Searched'], 'Box too large — draw a smaller one')
        self.assertEqual(rows[0]['Scenes'], 0)

    def test_the_figures_panel_says_none_in_range_without_a_before_scene(self):
        # El otro mensaje que solo vive aquí, y al que apunta la descripción
        # del mapa ("widen Look back (days) if it says none in range").
        figures = next(s for k, _, s in panel_queries() if k == 'panel-24')
        # El caso de verdad: hay escenas antes del incendio, pero todas
        # nubladas por encima del corte, así que ninguna llega a hit_before.
        rows = self._rows(figures, dict(self.BASE_CASE, s2cloud='40'),
                          clouds=[95.0, 95.0, 5.0, 5.0])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['Before'], 'none in range')
        # Y el lado de después sigue contando: "none in range" habla solo
        # del antes, no de que la búsqueda entera se haya quedado vacía.
        self.assertEqual(rows[0]['Scenes'], 2)

    def test_the_figures_panel_reports_the_catalogue_for_a_drawn_box(self):
        figures = next(s for k, _, s in panel_queries() if k == 'panel-24')
        rows = self._rows(figures, dict(self.BASE_CASE))
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row['HTTP'], '200')
        self.assertEqual(row['Matched'], len(self.DATES))
        self.assertEqual(row['Returned'], len(self.DATES))
        # Solo cuenta el lado de después (hit_after): dos de las cuatro.
        self.assertEqual(row['Scenes'], 2)
        self.assertEqual(row['Before'], '10 Jun 2026')
        self.assertNotEqual(row['Searched'], 'Box too large — draw a smaller one')

    def test_a_stale_before_pick_stops_riding_the_row_links(self):
        # Simétrico con set_after: picked_before se resuelve contra las
        # candidatas (search.sql), así que un pinchado de un recuadro
        # anterior se vacía en vez de perpetuarse en cada enlace de fila.
        sheet = next(s for k, _, s in panel_queries() if k == 'panel-23')
        stale = dict(self.BASE_CASE, sceneBefore='https://example.test/from-a-previous-box.tif')
        rows = self._rows(sheet, stale)
        carried = {row['set_before'] for row in rows if row['Side'] == 'After'}
        self.assertEqual(carried, {''}, 'un pinchado rancio no debe viajar en los enlaces')

    def test_a_live_before_pick_still_rides_the_row_links(self):
        sheet = next(s for k, _, s in panel_queries() if k == 'panel-23')
        live = dict(self.BASE_CASE, sceneBefore='https://example.test/0.tif')
        rows = self._rows(sheet, live)
        carried = {row['set_before'] for row in rows if row['Side'] == 'After'}
        self.assertEqual(carried, {'https://example.test/0.tif'})

    def test_a_stale_before_pick_still_draws_exactly_one_before_row(self):
        # Resolver el pinchado no debe dejar el lado de antes en blanco:
        # hit_before sigue cayendo en la más reciente.
        before = next(s for k, r, s in panel_queries() if k == 'panel-22' and r == 'D')
        stale = dict(self.BASE_CASE, sceneBefore='https://example.test/from-a-previous-box.tif')
        rows = self._rows(before, stale)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['scene_id'], 'SYN_1')
        self.assertIsNotNone(rows[0]['raster_url'])


def the_plugin_draws(rows):
    """La escena que el panel de kepler pinta a partir de las filas de una consulta.

    Copia deliberada, y pequeña, de la regla de src/data/rasterDataset.ts:
    `readScenes` salta las filas sin `raster_url`, y como `acquired_at` es
    texto (no un campo de tipo time) las escenas quedan sin fecha y `pickScene`
    devuelve la primera en el orden de la consulta. Comprobado en el banco
    leyendo el scene id de las teselas que el mapa pide de verdad.
    """
    return next((row['raster_url'] for row in rows if row['raster_url']), None)


class DrawnMarkHermeticTest(unittest.TestCase):
    """Sin banco, sin red: la marca de la hoja dice la escena que el mapa PINTA.

    Lo que se protege es que la marca no pueda separarse de lo dibujado. Por
    eso cada test compara la fila marcada en contact_sheet.sql contra lo que
    el panel pintaría con las filas de map_scenes.sql / map_scenes_before.sql
    (the_plugin_draws), y no contra una regla escrita aquí aparte, que podría
    equivocarse igual que la hoja.

    El catálogo trae a propósito un empate en el lado de después -dos escenas
    con la misma nube y la misma hora, la de id mayor primero en el JSON-,
    que es el caso real del recuadro de California: ahí el ORDER BY de antes
    no decidía y el mapa pintaba la que DuckDB dejara primero.
    """

    BOX = 'POLYGON ((-122.0 39.0, -121.9 39.0, -121.9 39.1, -122.0 39.1, -122.0 39.0))'
    GEOMETRY = {'type': 'Polygon', 'coordinates': [[[-122.0, 39.0], [-121.9, 39.0], [-121.9, 39.1],
                                                    [-122.0, 39.1], [-122.0, 39.0]]]}
    # (id, fecha, nube). El día pausado es 2026-06-15.
    BEFORE = [('SYN_B0', '2026-05-01T19:00:00Z', 5.0), ('SYN_B1', '2026-06-10T19:00:00Z', 5.0)]
    # SYN_A5 es la más reciente y la más nublada: así "la más despejada" y "la
    # más reciente" son escenas distintas, y una marca que siguiera la fecha
    # (la regla de la hoja, no la del mapa) se delata sin pinchar nada.
    AFTER = [('SYN_A0', '2026-06-16T19:00:00Z', 20.0),
             ('SYN_A9', '2026-06-17T19:00:00Z', 3.0),
             ('SYN_A1', '2026-06-17T19:00:00Z', 3.0),
             ('SYN_A5', '2026-06-18T19:00:00Z', 30.0)]
    CASE = dict(area=BOX, sceneBefore='', sceneAfter='', scanFrom='2026-06-15T00:00:00.000Z',
                scanTo='2026-06-15T23:59:59.000Z', days='3', lookback='90',
                s2cloud='100', s2cover='0', bands='trueColor')

    @staticmethod
    def href(scene_id):
        return f'https://example.test/{scene_id}.tif'

    @staticmethod
    def _sql_quote(value):
        return "'" + str(value).replace("'", "''") + "'"

    def _body(self, scenes):
        features = [{'id': sid, 'properties': {'datetime': when, 'eo:cloud_cover': cloud},
                     'assets': {'visual': {'href': self.href(sid)}}, 'geometry': self.GEOMETRY}
                    for sid, when, cloud in scenes]
        return json.dumps({'type': 'FeatureCollection', 'features': features,
                           'numberMatched': len(features), 'numberReturned': len(features)})

    def _rows(self, fragment, scenes, **case):
        sql = build.panel_sql(fragment)
        canned = "{'status': 200, 'body': " + self._sql_quote(self._body(scenes)) + "} AS r"
        sql, count = re.subn(r'http_get\(.*?\) AS r', canned, sql, count=1, flags=re.DOTALL)
        self.assertEqual(count, 1)
        sql = re.sub(r'\$(__\w+)\(([^()]*)\)', expand_macro, sql)
        values = dict(self.CASE, **case)
        sql = re.sub(r'\$\{?([A-Za-z]\w*)\}?', lambda m: self._sql_quote(values[m.group(1)]), sql)
        try:
            con = duckdb.connect()
            con.execute('INSTALL spatial; LOAD spatial;')
        except duckdb.Error as error:
            self.skipTest(f'the spatial extension is not loadable in this duckdb: {error}')
        result = con.execute(sql)
        columns = [d[0] for d in result.description]
        return [dict(zip(columns, row)) for row in result.fetchall()]

    def _state(self, scenes=None, **case):
        """Las marcas de la hoja y lo que el mapa pinta, en el mismo estado."""
        scenes = self.BEFORE + self.AFTER if scenes is None else scenes
        sheet = self._rows('contact_sheet', scenes, **case)
        marks = {'Before': [], 'After': []}
        for row in sheet:
            if row['Map'] is not None:
                marks[row['Side']].append(row['scene_url'])
        drawn = {'After': the_plugin_draws(self._rows('map_scenes', scenes, **case)),
                 'Before': the_plugin_draws(self._rows('map_scenes_before', scenes, **case))}
        return marks, drawn

    def assertMarksAreWhatIsDrawn(self, marks, drawn):
        for side in ('Before', 'After'):
            expected = [drawn[side]] if drawn[side] else []
            self.assertEqual(marks[side], expected, f'{side}: la marca no es lo que el mapa pinta')

    def test_exactly_one_mark_per_side_when_both_sides_have_scenes(self):
        marks, drawn = self._state()
        self.assertEqual(len(marks['Before']), 1)
        self.assertEqual(len(marks['After']), 1)
        self.assertMarksAreWhatIsDrawn(marks, drawn)

    def test_the_marks_say_which_half_of_the_curtain(self):
        sheet = self._rows('contact_sheet', self.BEFORE + self.AFTER)
        glyphs = {row['Side']: row['Map'] for row in sheet if row['Map'] is not None}
        self.assertEqual(glyphs, {'Before': '◀', 'After': '▶'})
        # La columna va la primera: es una marca al margen, no un dato más.
        self.assertEqual(next(iter(sheet[0])), 'Map')

    def test_no_pick_marks_the_after_scene_the_map_draws(self):
        marks, drawn = self._state()
        self.assertMarksAreWhatIsDrawn(marks, drawn)
        # La más despejada; entre SYN_A9 y SYN_A1, empatadas en nube y hora,
        # la que el catálogo lista primero. Es lo que el mapa ya hacía de
        # hecho, así que hacer la regla explícita no cambia lo que se pinta.
        self.assertEqual(drawn['After'], self.href('SYN_A9'))
        self.assertEqual(drawn['Before'], self.href('SYN_B1'))

    def test_a_hand_picked_after_scene_is_the_one_marked(self):
        picked = self.href('SYN_A0')  # la más nublada: nunca sería la automática
        marks, drawn = self._state(sceneAfter=picked)
        self.assertEqual(drawn['After'], picked)
        self.assertMarksAreWhatIsDrawn(marks, drawn)

    def test_a_hand_picked_before_scene_is_the_one_marked(self):
        picked = self.href('SYN_B0')  # la más antigua: nunca sería la automática
        marks, drawn = self._state(sceneBefore=picked)
        self.assertEqual(drawn['Before'], picked)
        self.assertMarksAreWhatIsDrawn(marks, drawn)

    def test_stale_picks_mark_the_fallback_not_nothing(self):
        marks, drawn = self._state(sceneBefore=self.href('from-a-previous-box-before'),
                                   sceneAfter=self.href('from-a-previous-box-after'))
        self.assertEqual(drawn['Before'], self.href('SYN_B1'))
        self.assertEqual(drawn['After'], self.href('SYN_A9'))
        self.assertMarksAreWhatIsDrawn(marks, drawn)

    def test_no_before_scene_means_no_before_mark(self):
        marks, drawn = self._state(scenes=self.AFTER)
        self.assertIsNone(drawn['Before'])
        self.assertEqual(marks['Before'], [])
        self.assertEqual(len(marks['After']), 1)
        self.assertMarksAreWhatIsDrawn(marks, drawn)

    def test_the_after_side_links_one_scene_and_the_tie_follows_the_catalogue(self):
        # La regla vive en search.sql: map_scenes.sql deja el enlace solo en la
        # escena elegida, así que el panel ya no depende de su costumbre de
        # tomar la primera fila. Y el empate lo rompe el orden del catálogo,
        # no cómo ordene DuckDB: con el JSON al revés gana la otra, y la hoja
        # la marca igual.
        for scenes, expected in ((self.BEFORE + self.AFTER, 'SYN_A9'),
                                 (self.BEFORE + list(reversed(self.AFTER)), 'SYN_A1')):
            with self.subTest(expected=expected):
                rows = self._rows('map_scenes', scenes)
                self.assertEqual([row['scene_id'] for row in rows if row['raster_url']], [expected])
                marks, drawn = self._state(scenes=scenes)
                self.assertMarksAreWhatIsDrawn(marks, drawn)

    def test_the_drawn_scene_is_on_the_sheet_even_past_the_cap(self):
        # Del lado de antes la hoja enseña 6. Pinchar la más vieja de ocho la
        # deja fuera del cupo por fecha; una marca que no aparece no dice nada.
        before = [(f'SYN_B{i}', f'2026-0{3 + i // 3}-{10 + i:02d}T19:00:00Z', 5.0) for i in range(8)]
        oldest = self.href(before[0][0])
        marks, drawn = self._state(scenes=before + self.AFTER, sceneBefore=oldest)
        self.assertEqual(drawn['Before'], oldest)
        self.assertMarksAreWhatIsDrawn(marks, drawn)
        sheet = self._rows('contact_sheet', before + self.AFTER, sceneBefore=oldest)
        self.assertEqual(sum(1 for row in sheet if row['Side'] == 'Before'), 6, 'el cupo sigue siendo 6')


class ContactSheetSidesLiveTest(unittest.TestCase):
    """Contra el banco de :3002: la única forma de probar que el cupo por
    lado de verdad reparte filas, no solo que la cláusula está presente. Se
    salta (no falla) si el banco no está arriba, para no acoplar el resto de
    la suite -offline y determinista- a que algo esté escuchando en :3002.
    """

    GRAFANA_URL = 'http://localhost:3002/api/ds/query'
    # El caso real que se rompía: recuadro de incendio en California, ventana
    # ensanchada 90 días hacia atrás, los mismos s2cloud/s2cover por defecto
    # de build.py (no un caso permisivo a propósito).
    CASE = dict(area='POLYGON ((-123.1 39.1, -122.8 39.1, -122.8 39.4, -123.1 39.4, -123.1 39.1))',
               sceneBefore='', sceneAfter='',
               scanFrom='2026-09-12T00:00:00.000Z', scanTo='2026-09-12T23:59:59.000Z',
               days='3', lookback='90', s2cloud='40', s2cover='50', bands='forestBurn')

    def _interpolate(self, sql):
        return re.sub(r'\$\{?([A-Za-z]\w*)\}?',
                      lambda m: "'" + str(self.CASE[m.group(1)]).replace("'", "''") + "'", sql)

    def _sheet_rows(self):
        sql = self._interpolate(build.panel_sql('contact_sheet'))
        body = json.dumps({'queries': [{'refId': 'A', 'datasource': {'uid': 'duckdb'}, 'format': 1, 'rawSql': sql}],
                           'from': 'now-7d', 'to': 'now-1d'}).encode()
        auth = base64.b64encode(b'admin:admin').decode()
        request = urllib.request.Request(
            self.GRAFANA_URL, data=body,
            headers={'Content-Type': 'application/json', 'Authorization': 'Basic ' + auth})
        try:
            result = json.load(urllib.request.urlopen(request, timeout=10))
        except (urllib.error.URLError, OSError, TimeoutError) as error:
            raise unittest.SkipTest(f'grafana bench not reachable at {self.GRAFANA_URL}: {error}')
        answer = result['results']['A']
        if 'error' in answer:
            self.fail(f'contact_sheet query failed against the live bench: {answer["error"]}')
        frame = answer['frames'][0]
        names = [field['name'] for field in frame['schema']['fields']]
        values = frame['data']['values']
        return [dict(zip(names, row)) for row in zip(*values)]

    def test_both_sides_appear_for_the_california_box(self):
        rows = self._sheet_rows()
        sides = [row['Side'] for row in rows]
        self.assertIn('Before', sides, 'the before side must not be crowded out by a 90-day lookback')
        self.assertIn('After', sides, 'the after side -the one people actually browse- must not disappear')
        self.assertLessEqual(sides.count('Before'), 6, 'before is capped at 6 candidates')
        self.assertLessEqual(sides.count('After'), 24, 'after is capped at 24 candidates')


class ImageryPanelsTest(unittest.TestCase):
    def setUp(self):
        dash = fixture()
        self.out = build.graft(dash, build.imagery_elements(dash))
        self.elements = self.out['spec']['elements']

    def options(self, key):
        return self.elements[key]['spec']['vizConfig']['spec']['options']

    def raw_sql(self, key):
        return {q['spec']['refId']: q['spec']['query']['spec']['rawSql']
                for q in self.elements[key]['spec']['data']['spec']['queries']}

    def test_tab_lays_out_the_four_panels(self):
        items = self.out['spec']['layout']['spec']['tabs'][-1]['spec']['layout']['spec']['items']
        got = [(i['spec']['element']['name'], i['spec']['x'], i['spec']['y'], i['spec']['width'], i['spec']['height'])
               for i in items]
        self.assertEqual(got, build.LAYOUT)

    def test_sentinel_map_flies_to_the_box_then_to_the_picked_scene(self):
        options = self.options('panel-22')
        self.assertNotIn('areaVariable', options)
        centres = [(m['variable'], m['variableTo'], m['zoom'])
                   for m in options['variableMappings'] if m['source'] == 'center']
        self.assertEqual(centres, [('aLat', 'aLng', 10), ('sLat', 'sLng', 11)])
        self.assertEqual(options['timeSync'], 'off')
        self.assertEqual(options['rasterServerUrl'], 'https://titiler.ubica.ec')

    def test_sentinel_map_queries(self):
        sql = self.raw_sql('panel-22')
        self.assertEqual(sorted(sql), ['A', 'B', 'D'])
        self.assertNotIn('http_get', sql['A'])
        self.assertIn('raster_url', sql['B'])
        self.assertIn('ST_AsGeoJSON(footprint)', sql['B'])
        self.assertIn('raster_url', sql['D'])

    def test_sentinel_map_config(self):
        vis = self.options('panel-22')['mapConfig']['config']['visState']
        self.assertEqual(vis['layerOrder'], ['boxoutline', 'footprints', 's2scene-before', 's2scene'])
        layers = {layer['id']: layer for layer in vis['layers']}
        self.assertEqual(layers['s2scene']['config']['dataId'], 'grafana-B-raster')
        self.assertEqual(layers['s2scene']['config']['visConfig']['preset'], 'trueColor')
        self.assertEqual(layers['s2scene-before']['config']['dataId'], 'grafana-D-raster')
        self.assertEqual(layers['s2scene-before']['config']['visConfig']['preset'], 'trueColor')
        self.assertEqual(layers['boxoutline']['config']['dataId'], 'grafana-A')
        self.assertEqual(layers['footprints']['config']['dataId'], 'grafana-B')
        for layer_id in ('boxoutline', 'footprints'):
            self.assertFalse(layers[layer_id]['config']['visConfig']['filled'])
        self.assertEqual(vis['editor']['features'], [])

    def test_the_sheet_colours_only_the_marked_cells(self):
        # La columna Map: fondo de color solo donde hay marca (◀/▶ desde las
        # value mappings), transparente en las demás, estrecha. Los dos glifos
        # de las mappings tienen que ser los que la SQL emite, o la marca sale
        # como texto sin color.
        overrides = self.elements['panel-23']['spec']['vizConfig']['spec']['fieldConfig']['overrides']
        mark = next(o for o in overrides if o['matcher']['options'] == 'Map')
        props = {p['id']: p['value'] for p in mark['properties']}
        self.assertEqual(props['custom.cellOptions']['type'], 'color-background')
        self.assertLessEqual(props['custom.width'], 60)
        self.assertEqual(props['thresholds']['steps'], [{'color': 'transparent', 'value': None}])
        options = props['mappings'][0]['options']
        self.assertEqual(set(options), {'◀', '▶'})
        sheet = build.read_sql('contact_sheet')
        for glyph, mapping in options.items():
            self.assertIn(f"THEN '{glyph}'", sheet)
            self.assertNotEqual(mapping['color'], 'transparent')
        self.assertIn('Map column marks the two scenes the map is drawing',
                      self.elements['panel-23']['spec']['description'])

    def test_contact_sheet_link_keeps_the_tab_and_sets_the_scene_first(self):
        defaults = self.elements['panel-23']['spec']['vizConfig']['spec']['fieldConfig']['defaults']
        link = defaults['links'][0]['url']
        self.assertIn('dtab=Imagery', link)
        for fixed in ('var-sceneBefore=', 'var-sceneAfter=', 'var-sLat=', 'var-sLng='):
            self.assertLess(link.index(fixed), link.index('${__all_variables}'))

    def test_sheet_and_figures_run_their_own_sql(self):
        self.assertEqual(self.raw_sql('panel-23')['A'], build.panel_sql('contact_sheet'))
        self.assertEqual(self.raw_sql('panel-24')['A'], build.panel_sql('figures'))

    def test_figures_panel_is_wide_enough_to_read(self):
        items = self.out['spec']['layout']['spec']['tabs'][-1]['spec']['layout']['spec']['items']
        widths = {i['spec']['element']['name']: i['spec']['width'] for i in items}
        self.assertGreaterEqual(widths['panel-24'], 8)
        self.assertEqual(widths['panel-23'] + widths['panel-24'], 24)
        options = self.options('panel-24')
        self.assertEqual(options['orientation'], 'horizontal')
        self.assertIs(options['wideLayout'], False)

    def test_fire_map_description_explains_how_to_draw(self):
        description = self.elements['panel-21']['spec']['description']
        self.assertIn('drag', description.lower())
        self.assertIn('hides the cells outside it', description)

    def test_every_imagery_element_uses_the_shared_area_variable(self):
        # The polygon is now shared with the rest of the dashboard: every
        # Imagery element must read/publish `area`, and `burnArea` (its old,
        # tab-private variable) must not appear anywhere in the tab.
        self.assertEqual(self.options('panel-21')['areaVariable'], 'area')
        for key in ('panel-22', 'panel-23', 'panel-24'):
            sql = json.dumps(self.raw_sql(key))
            self.assertIn('$area', sql, key)
        for key, element in self.elements.items():
            self.assertNotIn('burnArea', json.dumps(element), key)


class CurtainTest(unittest.TestCase):
    def setUp(self):
        dash = fixture()
        self.out = build.graft(dash, build.imagery_elements(dash))
        self.map = self.out['spec']['elements']['panel-22']['spec']

    def test_the_map_opens_split_with_a_curtain(self):
        state = self.map['vizConfig']['spec']['options']['mapConfig']['config']['mapState']
        self.assertTrue(state['isSplit'])
        self.assertEqual(state['mapSplitMode'], 'SWIPE_COMPARE')

    def test_each_side_carries_its_own_scene_and_both_share_the_box(self):
        vis = self.map['vizConfig']['spec']['options']['mapConfig']['config']['visState']
        left, right = vis['splitMaps']
        self.assertTrue(left['layers']['s2scene-before'])
        self.assertFalse(left['layers']['s2scene'])
        self.assertTrue(right['layers']['s2scene'])
        self.assertFalse(right['layers']['s2scene-before'])
        for side in (left, right):
            self.assertTrue(side['layers']['boxoutline'])
            self.assertTrue(side['layers']['footprints'])

    def test_the_map_asks_for_both_sides_and_no_separate_footprints(self):
        refs = [q['spec']['refId'] for q in self.map['data']['spec']['queries']]
        self.assertEqual(sorted(refs), ['A', 'B', 'D'])

    def test_the_row_link_sets_one_side_and_keeps_the_other(self):
        # Overridden by the coordinator (round 1 review): the plan's verbatim
        # test dropped :percentencode, which is a regression, not a decision
        # — set_before/set_after carry raw https URLs, same as scene_url did
        # before this task, and must be encoded before they ride a query
        # string.
        link = self.out['spec']['elements']['panel-23']['spec']['vizConfig']['spec'] \
            ['fieldConfig']['defaults']['links'][0]['url']
        self.assertIn('var-sceneBefore=${__data.fields.set_before:percentencode}', link)
        self.assertIn('var-sceneAfter=${__data.fields.set_after:percentencode}', link)
        for fixed in ('var-sceneBefore=', 'var-sceneAfter='):
            self.assertLess(link.index(fixed), link.index('${__all_variables}'))

    def test_the_old_scene_variable_is_treated_as_legacy(self):
        self.assertIn('scene', build.LEGACY_VARIABLES)
        names = {v['spec']['name'] for v in build.variables()}
        self.assertNotIn('scene', names)
        self.assertIn('sceneBefore', names)
        self.assertIn('sceneAfter', names)
        self.assertIn('lookback', names)


class FootprintsTooltipTest(unittest.TestCase):
    """Ties the footprints layer's tooltip to the SQL that actually feeds it.

    The trap this guards against: renaming a fieldsToShow entry (e.g. back
    to the old `acquired_on`, or any other name that isn't a real output
    column of the query the layer's dataId points at) breaks nothing else
    in the suite — kepler just renders an empty tooltip, silently.

    Two things a first version of this test got wrong (round-3 review):
    matching field names as a substring of the raw SQL text would let
    `acquired` pass even though it is only the identifier inside
    `strftime(acquired, …)`, never an output column on its own; and
    hard-coding the fragment name (`map_scenes`) assumed the mapping from
    dataId to query instead of reading it from the generated dashboard.
    Fixed both: this runs the actual query the layer's dataId points at
    (canned catalogue body, no network) and checks the real output column
    names from the cursor's own description — and it finds *which* query
    to run by resolving the layer's own dataId (`grafana-<refId>`) against
    panel-22's own query list, not by assuming a filename.
    """

    BOX = 'POLYGON ((-122.0 39.0, -121.9 39.0, -121.9 39.1, -122.0 39.1, -122.0 39.0))'
    GEOMETRY = {'type': 'Polygon', 'coordinates': [[[-122.0, 39.0], [-121.9, 39.0], [-121.9, 39.1],
                                                    [-122.0, 39.1], [-122.0, 39.0]]]}
    CASE = dict(area=BOX, sceneBefore='', sceneAfter='', scanFrom='2026-06-15T00:00:00.000Z',
               scanTo='2026-06-15T23:59:59.000Z', days='3', lookback='90',
               s2cloud='100', s2cover='0', bands='trueColor')

    @staticmethod
    def _sql_quote(value):
        return "'" + str(value).replace("'", "''") + "'"

    def _canned_body(self):
        feature = {'id': 'SYN_0', 'properties': {'datetime': '2026-06-16T12:00:00Z', 'eo:cloud_cover': 5.0},
                   'assets': {'visual': {'href': 'https://example.test/0.tif'}}, 'geometry': self.GEOMETRY}
        return json.dumps({'type': 'FeatureCollection', 'features': [feature],
                           'numberMatched': 1, 'numberReturned': 1})

    def test_footprints_tooltip_fields_are_real_output_columns(self):
        dash = fixture()
        out = build.graft(dash, build.imagery_elements(dash))
        map_spec = out['spec']['elements']['panel-22']['spec']
        vis = map_spec['vizConfig']['spec']['options']['mapConfig']['config']['visState']
        layers = {layer['id']: layer for layer in vis['layers']}
        data_id = layers['footprints']['config']['dataId']
        fields = vis['interactionConfig']['tooltip']['fieldsToShow'][data_id]
        self.assertTrue(fields, 'the footprints layer must show at least one tooltip field')

        # Which query feeds this layer, read from the layer's own dataId
        # (grafana-<refId>) against panel-22's actual queries — not assumed.
        ref_id = data_id.removeprefix('grafana-')
        queries = {q['spec']['refId']: q['spec']['query']['spec']['rawSql']
                  for q in map_spec['data']['spec']['queries']}
        self.assertIn(ref_id, queries, f'no query with refId {ref_id!r} feeds dataId {data_id!r}')
        sql = queries[ref_id]

        canned = "{'status': 200, 'body': " + self._sql_quote(self._canned_body()) + "} AS r"
        sql, count = re.subn(r'http_get\(.*?\) AS r', canned, sql, count=1, flags=re.DOTALL)
        self.assertEqual(count, 1, 'expected exactly one http_get(...) AS r to replace')
        sql = re.sub(r'\$(__\w+)\(([^()]*)\)', expand_macro, sql)
        sql = re.sub(r'\$\{?([A-Za-z]\w*)\}?', lambda m: self._sql_quote(self.CASE[m.group(1)]), sql)

        try:
            con = duckdb.connect()
            con.execute('INSTALL spatial; LOAD spatial;')
        except duckdb.Error as error:
            self.skipTest(f'the spatial extension is not loadable in this duckdb: {error}')
        result = con.execute(sql)
        columns = {d[0] for d in result.description}
        for entry in fields:
            name = entry['name']
            with self.subTest(field=name):
                self.assertIn(name, columns,
                              f'{name!r} is not an output column of the query feeding {data_id!r} '
                              f'(stale tooltip field?)')


class SentinelMapConfigValidationTest(unittest.TestCase):
    def kepler_panel(self, stac):
        return next(p for p in stac['panels'] if p['type'] == build.KEPLER_GROUP)

    def test_sentinel_map_config_refuses_a_duplicated_layer_type(self):
        stac = stac_join_fixture()
        layers = self.kepler_panel(stac)['options']['mapConfig']['config']['visState']['layers']
        geojson_layer = next(layer for layer in layers if layer['type'] == 'geojson')
        layers.append(copy.deepcopy(geojson_layer))
        with self.assertRaisesRegex(build.GraftError, 'geojson'):
            build.sentinel_map_config(stac)

    def test_sentinel_map_config_refuses_a_missing_layer_type(self):
        stac = stac_join_fixture()
        vis_state = self.kepler_panel(stac)['options']['mapConfig']['config']['visState']
        vis_state['layers'] = [layer for layer in vis_state['layers'] if layer['type'] != 'rasterTile']
        with self.assertRaisesRegex(build.GraftError, 'rasterTile'):
            build.sentinel_map_config(stac)

    def test_sentinel_map_config_refuses_a_dashboard_without_a_kepler_panel(self):
        stac = stac_join_fixture()
        stac['panels'] = [p for p in stac['panels'] if p['type'] != build.KEPLER_GROUP]
        with self.assertRaisesRegex(build.GraftError, 'stac-join'):
            build.sentinel_map_config(stac)


class CentroidVariableTest(unittest.TestCase):
    def test_area_is_interpolated_with_sqlstring_and_not_manually_quoted(self):
        # Measured on the bench: ${area:sqlstring} lets Grafana quote and
        # escape the value; hand-written quotes around ${area} do not
        # escape it and let a crafted var-area break out of the literal.
        for name in ('aLat', 'aLng'):
            variable = next(v for v in build.variables() if v['spec']['name'] == name)
            sql = variable['spec']['query']['spec']['__legacyStringValue']
            self.assertIn('${area:sqlstring}', sql)
            self.assertNotIn("'${area}'", sql)


class RegraftTest(unittest.TestCase):
    def setUp(self):
        self.dash = fixture()

    def test_regraft_on_a_clean_dashboard_equals_graft(self):
        once = build.graft(self.dash, build.imagery_elements(self.dash))
        again = build.regraft(self.dash, build.imagery_elements(self.dash))
        self.assertEqual(again, once)

    def test_regraft_replaces_the_tab_instead_of_refusing(self):
        once = build.graft(self.dash, build.imagery_elements(self.dash))
        twice = build.regraft(once, build.imagery_elements(once))
        self.assertEqual(twice['spec']['elements'].keys(), once['spec']['elements'].keys())
        titles = [t['spec']['title'] for t in twice['spec']['layout']['spec']['tabs']]
        self.assertEqual(titles.count('Imagery'), 1)
        self.assertEqual(twice['spec'], once['spec'], 'regrafting the same build must be a no-op')

    def test_regraft_leaves_the_other_tabs_and_variables_alone(self):
        once = build.graft(self.dash, build.imagery_elements(self.dash))
        twice = build.regraft(once, build.imagery_elements(once))
        for key, element in self.dash['spec']['elements'].items():
            self.assertEqual(twice['spec']['elements'][key], element)
        self.assertEqual(twice['spec']['variables'][:len(self.dash['spec']['variables'])], self.dash['spec']['variables'])

    def test_regraft_does_not_delete_a_panel_the_tab_never_added(self):
        # El caso que puede costar el trabajo de otro: alguien añade un panel
        # por la interfaz y Grafana le da una de las claves que esta pestaña
        # usa. Quitar por nombre lo borraría sin decir nada, y un PUT a
        # producción lo haría de verdad. Se quita solo lo que la pestaña que
        # hay puesta referencia; si lo demás choca, `graft` se niega y no se
        # escribe nada.
        once = build.graft(self.dash, build.imagery_elements(self.dash))
        foreign = copy.deepcopy(once['spec']['elements']['panel-23'])
        foreign['spec']['title'] = 'Someone else’s panel'
        foreign['spec']['id'] = 230
        del once['spec']['elements']['panel-23']
        once['spec']['layout']['spec']['tabs'][-1]['spec']['layout']['spec']['items'] = [
            item for item in once['spec']['layout']['spec']['tabs'][-1]['spec']['layout']['spec']['items']
            if item['spec']['element']['name'] != 'panel-23']
        once['spec']['elements']['panel-23'] = foreign

        with self.assertRaisesRegex(build.GraftError, 'panel-23'):
            build.regraft(once, build.imagery_elements(once))
        self.assertEqual(once['spec']['elements']['panel-23'], foreign, 'regraft must not mutate its input')

    def test_regraft_strips_only_what_the_tab_laid_out(self):
        once = build.graft(self.dash, build.imagery_elements(self.dash))
        # Una pestaña puesta con menos paneles de los que el injerto trae hoy:
        # al reinjertar, el que no estaba no puede haberse quitado por nombre.
        items = once['spec']['layout']['spec']['tabs'][-1]['spec']['layout']['spec']['items']
        once['spec']['layout']['spec']['tabs'][-1]['spec']['layout']['spec']['items'] = [
            item for item in items if item['spec']['element']['name'] != 'panel-24']
        with self.assertRaisesRegex(build.GraftError, 'panel-24'):
            build.regraft(once, build.imagery_elements(once))

    def test_bands_variable_defaults_to_forest_burn(self):
        variables = {v['spec']['name']: v['spec'] for v in build.variables()}
        self.assertEqual(variables['bands']['current']['value'], 'forestBurn')
        self.assertIn('forestBurn', variables['bands']['query'])
        self.assertIn('ndmi', variables['bands']['query'])

    def test_sentinel_map_reads_the_bands_variable(self):
        out = build.graft(self.dash, build.imagery_elements(self.dash))
        options = out['spec']['elements']['panel-22']['spec']['vizConfig']['spec']['options']
        self.assertEqual(options['rasterBands'], '$bands')

    def test_scene_query_offers_the_item_beside_the_composed_image(self):
        sql = build.panel_sql('map_scenes')
        self.assertIn('raster_item_url', sql)
        self.assertIn('raster_url', sql)
        # The footprint travels with the scene, so the map layer and the
        # geometry layer come from the same search.
        self.assertIn('ST_AsGeoJSON', sql, 'the footprint must travel with the scene (map_scenes.geojson)')

    def test_regraft_removes_a_legacy_burnarea_variable(self):
        # A dashboard whose Imagery tab was grafted before the shared-area
        # change still carries the old, tab-private `burnArea` variable.
        # regraft must clear it too, or a redeploy leaves it orphaned.
        once = build.graft(self.dash, build.imagery_elements(self.dash))
        once['spec']['variables'].append(build.text_variable('burnArea', 'Imagery box (map)'))
        twice = build.regraft(once, build.imagery_elements(once))
        names = [v['spec']['name'] for v in twice['spec']['variables']]
        self.assertNotIn('burnArea', names)


class EncodingTest(unittest.TestCase):
    def test_read_text_and_write_text_always_pass_utf8(self):
        # A mangled encoding in a read/write of build.py's own I/O would be
        # locale-dependent and silent; every call must pin encoding='utf-8'.
        source = (HERE / 'build.py').read_text(encoding='utf-8')
        checked = 0
        for number, line in enumerate(source.splitlines(), 1):
            for call in ('read_text(', 'write_text('):
                if call in line:
                    checked += 1
                    self.assertIn("encoding='utf-8'", line, f'build.py:{number}: {line.strip()}')
        self.assertGreaterEqual(checked, 4)


if __name__ == '__main__':
    unittest.main()
