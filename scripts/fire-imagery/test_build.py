"""Tests del injerto de la pestaña Imagery.

Lo que protegen es lo que costó el tablero una vez: que nada de lo que ya
había cambie, y que un segundo injerto no duplique la pestaña.
"""
import copy
import json
import pathlib
import re
import sys
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import build  # noqa: E402

NEW_VARIABLES = ['scanFrom', 'scanTo', 'burnArea', 'scene', 'sLat', 'sLng',
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

    def test_adds_the_twelve_variables_in_order(self):
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
        self.assertEqual(options['areaVariable'], 'burnArea')
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


SQL_NAMES = ['prelude', 'search', 'map_box', 'map_scenes', 'map_footprints', 'contact_sheet', 'figures']


class SqlTest(unittest.TestCase):
    def test_no_comment_names_a_grafana_macro(self):
        # La expansión de macros es textual: uno dentro de un comentario la rompe.
        for name in SQL_NAMES:
            for number, line in enumerate(build.read_sql(name).splitlines(), 1):
                comment = line.split('--', 1)[1] if '--' in line else ''
                self.assertNotIn('$__', comment, f'{name}.sql:{number}')

    def test_only_known_variables_are_referenced(self):
        known = {variable['spec']['name'] for variable in build.variables()}
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
    def test_burnarea_is_interpolated_with_sqlstring_and_not_manually_quoted(self):
        # Measured on the bench: ${burnArea:sqlstring} lets Grafana quote and
        # escape the value; hand-written quotes around ${burnArea} do not
        # escape it and let a crafted var-burnArea break out of the literal.
        for name in ('aLat', 'aLng'):
            variable = next(v for v in build.variables() if v['spec']['name'] == name)
            sql = variable['spec']['query']['spec']['__legacyStringValue']
            self.assertIn('${burnArea:sqlstring}', sql)
            self.assertNotIn("'${burnArea}'", sql)


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
