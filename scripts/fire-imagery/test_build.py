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

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import build  # noqa: E402

NEW_VARIABLES = ['scanFrom', 'scanTo', 'burnArea', 'scene', 'sLat', 'sLng',
                 'days', 's2cloud', 's2cover', 'aLat', 'aLng']


def fixture():
    return json.loads((HERE / 'fixtures' / 'fire-tabs-min.json').read_text())


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


if __name__ == '__main__':
    unittest.main()
