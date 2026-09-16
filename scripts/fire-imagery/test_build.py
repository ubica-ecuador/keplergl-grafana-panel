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

NEW_VARIABLES = ['scanFrom', 'scanTo', 'scene', 'sLat', 'sLng',
                 'days', 's2cloud', 's2cover', 'bands', 'aLat', 'aLng']

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

    def test_adds_the_eleven_variables_in_order(self):
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


SQL_NAMES = ['prelude', 'search', 'map_box', 'map_scenes', 'map_scenes_before', 'map_footprints',
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
        # `lookback`, `sceneBefore` and `sceneAfter` are new in this task;
        # build.py wires them into variables() in the next task, so they are
        # added here by hand rather than dropped from `known`.
        known = ({variable['spec']['name'] for variable in build.variables()}
                | {'area', 'lookback', 'sceneBefore', 'sceneAfter'})
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
        self.assertEqual(sorted(sql), ['A', 'B', 'C'])
        self.assertNotIn('http_get', sql['A'])
        self.assertIn('raster_url', sql['B'])
        self.assertIn('ST_AsGeoJSON(footprint)', sql['C'])

    def test_sentinel_map_config(self):
        vis = self.options('panel-22')['mapConfig']['config']['visState']
        self.assertEqual(vis['layerOrder'], ['boxoutline', 'footprints', 's2scene'])
        layers = {layer['id']: layer for layer in vis['layers']}
        self.assertEqual(layers['s2scene']['config']['dataId'], 'grafana-B-raster')
        self.assertEqual(layers['s2scene']['config']['visConfig']['preset'], 'trueColor')
        self.assertEqual(layers['boxoutline']['config']['dataId'], 'grafana-A')
        self.assertEqual(layers['footprints']['config']['dataId'], 'grafana-C')
        for layer_id in ('boxoutline', 'footprints'):
            self.assertFalse(layers[layer_id]['config']['visConfig']['filled'])
        self.assertEqual(vis['editor']['features'], [])

    def test_contact_sheet_link_keeps_the_tab_and_sets_the_scene_first(self):
        defaults = self.elements['panel-23']['spec']['vizConfig']['spec']['fieldConfig']['defaults']
        link = defaults['links'][0]['url']
        self.assertIn('dtab=Imagery', link)
        for fixed in ('var-scene=', 'var-sLat=', 'var-sLng='):
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
