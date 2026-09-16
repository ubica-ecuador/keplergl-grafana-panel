#!/usr/bin/env python3
"""Pestaña "Imagery" de fire-emissions-tabs: la construye y la injerta.

El tablero vive solo en la base de datos de producción (dashboard v2 con
TabsLayout) y no puede viajar como fichero clásico. Este script no lo guarda:
recibe el objeto v2beta1 tal como lo devuelve el apiserver y devuelve el mismo
objeto con la pestaña añadida, sin tocar nada de lo que ya había.

    python3 scripts/fire-imagery/build.py local prod.json provisioning-sources/dashboards/fire-emissions-tabs-local.json
    python3 scripts/fire-imagery/build.py prod  prod.json grafted.json
"""
import copy
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent

TAB_TITLE = 'Imagery'
LOCAL_UID = 'fire-emissions-tabs-local'
KEPLER_GROUP = 'ubica-keplergl-panel'
DUCKDB_GROUP = 'motherduck-duckdb-datasource'
TILER = 'https://titiler.ubica.ec'

# (elemento, x, y, ancho, alto) en la rejilla de 24 columnas de la pestaña.
LAYOUT = [
    ('panel-21', 0, 0, 12, 16),
    ('panel-22', 12, 0, 12, 16),
    ('panel-23', 0, 16, 16, 12),
    ('panel-24', 16, 16, 8, 12),
]


class GraftError(Exception):
    """El tablero no admite el injerto tal cual; nada se ha escrito."""


def text_variable(name, label):
    return {'kind': 'TextVariable', 'spec': {
        'name': name, 'current': {'text': '', 'value': ''}, 'query': '',
        'label': label, 'hide': 'hideVariable', 'skipUrlSync': False}}


def custom_variable(name, label, values, default, description):
    return {'kind': 'CustomVariable', 'spec': {
        'name': name, 'query': values, 'current': {'text': default, 'value': default},
        'options': [], 'multi': False, 'includeAll': False, 'label': label,
        'description': description, 'hide': 'dontHide', 'skipUrlSync': False,
        'allowCustomValue': False}}


def centroid_variable(name, label, axis_fn):
    # En una query de variable el datasource NO entrecomilla ni escapa solo:
    # comillas a mano dejaban que un var-burnArea manipulado se saliera del
    # literal e inyectara SQL. ${burnArea:sqlstring} deja que Grafana
    # entrecomille y escape (medido en el banco); por eso sin comillas aquí.
    # Sin recuadro no hay filas y el mapa Sentinel se queda donde está.
    sql = (
        "SELECT CAST(round(" + axis_fn + "(ST_Centroid(ST_GeomFromText(w))), 5) AS VARCHAR) AS __text,\n"
        "       CAST(round(" + axis_fn + "(ST_Centroid(ST_GeomFromText(w))), 5) AS VARCHAR) AS __value\n"
        "FROM (SELECT nullif(${burnArea:sqlstring}, '') AS w)\n"
        "WHERE w IS NOT NULL"
    )
    return {'kind': 'QueryVariable', 'spec': {
        'name': name, 'current': {'text': '', 'value': ''}, 'label': label,
        'hide': 'hideVariable', 'refresh': 'onDashboardLoad', 'skipUrlSync': False,
        'query': {'kind': 'DataQuery', 'group': DUCKDB_GROUP, 'version': 'v0',
                  'datasource': {'name': 'duckdb'}, 'spec': {'__legacyStringValue': sql}},
        'regex': '', 'regexApplyTo': 'value', 'sort': 'disabled', 'options': [],
        'multi': False, 'includeAll': False, 'allowCustomValue': False}}


def variables():
    return [
        text_variable('scanFrom', 'Imagery window from (map)'),
        text_variable('scanTo', 'Imagery window to (map)'),
        text_variable('burnArea', 'Imagery box (map)'),
        text_variable('scene', 'Imagery scene picked'),
        text_variable('sLat', 'Imagery scene lat'),
        text_variable('sLng', 'Imagery scene lng'),
        custom_variable('days', 'Days after', '3,5,10,15,30', '10',
                        'How many days after the paused window to search for Sentinel-2 scenes.'),
        custom_variable('s2cloud', 'Cloud ≤ %', '5,10,20,40,60,100', '40',
                        "The most cloud a scene may carry: the catalogue's eo:cloud_cover, over the whole granule."),
        custom_variable('s2cover', 'Box covered ≥ %', '0,10,25,50,75,100', '50',
                        'How much of the drawn box a scene must cover to be listed.'),
        centroid_variable('aLat', 'Imagery box centre lat', 'ST_Y'),
        centroid_variable('aLng', 'Imagery box centre lng', 'ST_X'),
    ]


def duck_query(ref_id, raw_sql):
    return {'kind': 'PanelQuery', 'spec': {
        'query': {'kind': 'DataQuery', 'group': DUCKDB_GROUP, 'version': 'v0',
                  'datasource': {'name': 'duckdb'},
                  'spec': {'editorMode': 'code', 'format': 1, 'rawQuery': True, 'rawSql': raw_sql}},
        'refId': ref_id, 'hidden': False}}


def panel(pid, title, description, queries, group, version, options, field_config=None):
    return {'kind': 'Panel', 'spec': {
        'id': pid, 'title': title, 'description': description, 'links': [],
        'data': {'kind': 'QueryGroup', 'spec': {'queries': queries, 'transformations': [], 'queryOptions': {}}},
        'vizConfig': {'kind': 'VizConfig', 'group': group, 'version': version, 'spec': {
            'options': options, 'fieldConfig': field_config or {'defaults': {}, 'overrides': []}}}}}


def grid_item(name, x, y, w, h):
    return {'kind': 'GridLayoutItem', 'spec': {
        'x': x, 'y': y, 'width': w, 'height': h,
        'element': {'kind': 'ElementReference', 'name': name}}}


def read_sql(name):
    return (HERE / 'sql' / f'{name}.sql').read_text(encoding='utf-8')


def panel_sql(select_name, with_search=True):
    """Preludio, búsqueda y la SELECT del panel: una sola consulta por panel."""
    parts = [read_sql('prelude')]
    if with_search:
        parts.append(read_sql('search'))
    parts.append(read_sql(select_name))
    return '\n'.join(parts)


def by_name(name, *properties):
    return {'matcher': {'id': 'byName', 'options': name},
            'properties': [{'id': key, 'value': value} for key, value in properties]}


def sentinel_map_config(stac=None):
    """La config guardada del mapa de stac-join, reapuntada a las tres consultas.

    Se parte de ella y no de un literal porque ese mapa ya pinta escenas de
    earth-search por el mismo TiTiler: el visConfig del ráster está probado.
    """
    if stac is None:
        stac = json.loads((REPO / 'provisioning-sources' / 'dashboards' / 'stac-join.json').read_text(encoding='utf-8'))
    kepler_panels = [p for p in stac['panels'] if p['type'] == KEPLER_GROUP]
    if len(kepler_panels) != 1:
        raise GraftError(f'stac-join.json: expected exactly one {KEPLER_GROUP} panel, '
                          f'found {len(kepler_panels)}')
    source = kepler_panels[0]
    config = copy.deepcopy(source['options']['mapConfig'])
    root = config['config']
    root['mapState'].update({'latitude': 6, 'longitude': -25, 'zoom': 1.9})
    vis = root['visState']
    vis['editor'] = {'features': [], 'visible': True}
    for layer_type in ('rasterTile', 'geojson'):
        count = sum(1 for layer in vis['layers'] if layer['type'] == layer_type)
        if count != 1:
            raise GraftError(f'stac-join.json: expected exactly one {layer_type} layer, found {count}')
    by_type = {layer['type']: layer for layer in vis['layers']}

    scene = by_type['rasterTile']
    scene['id'] = 's2scene'
    scene['config']['label'] = 'Sentinel-2 scene'
    scene['config']['dataId'] = 'grafana-B-raster'
    # kepler guarda "TrueColor" y no sabe releerlo: siempre en minúscula.
    scene['config']['visConfig']['preset'] = 'trueColor'

    box = copy.deepcopy(by_type['geojson'])
    box['id'] = 'boxoutline'
    box['config'].update({'dataId': 'grafana-A', 'label': 'Your box', 'color': [255, 120, 0]})
    box['config']['visConfig'].update({'strokeColor': [255, 120, 0], 'thickness': 2.5, 'strokeOpacity': 1,
                                       'filled': False, 'stroked': True})

    footprints = copy.deepcopy(by_type['geojson'])
    footprints['id'] = 'footprints'
    footprints['config'].update({'dataId': 'grafana-C', 'label': 'Scene footprints', 'color': [255, 255, 255]})
    footprints['config']['visConfig'].update({'strokeColor': [255, 255, 255], 'thickness': 1, 'strokeOpacity': 0.6,
                                              'filled': False, 'stroked': True})

    vis['layers'] = [box, footprints, scene]
    vis['layerOrder'] = ['boxoutline', 'footprints', 's2scene']
    vis['interactionConfig']['tooltip']['fieldsToShow'] = {
        'grafana-A': [],
        'grafana-B': [{'name': n} for n in ('scene_id', 'acquired_at', 'cloud_cover', 'covers_pct')],
        'grafana-B-raster': [],
        'grafana-C': [{'name': n} for n in ('scene_id', 'acquired_on')],
    }
    return config


def sentinel_map_element(version):
    options = {
        'basemap': 'auto', 'followGrafanaTheme': True, 'showSidePanel': False, 'peerTimeSync': False,
        'publishWhilePlaying': False, 'timeSync': 'off', 'rasterServerUrl': TILER, 'rasterPainted': False,
        'rasterColormap': '', 'tripLayerMode': 'table', 'flowRenderMode': 'straight',
        'variableMappings': [
            # Al dibujar un recuadro, el mapa vuela a él...
            {'field': '', 'source': 'center', 'variable': 'aLat', 'variableTo': 'aLng', 'zoom': 10},
            # ...y al elegir una miniatura, a lo que enseña esa miniatura.
            {'field': '', 'source': 'center', 'variable': 'sLat', 'variableTo': 'sLng', 'zoom': 11},
        ],
        'mapConfig': sentinel_map_config(),
    }
    queries = [
        duck_query('A', panel_sql('map_box', with_search=False)),
        duck_query('B', panel_sql('map_scenes')),
        duck_query('C', panel_sql('map_footprints')),
    ]
    return panel(
        22, 'Sentinel-2 — the scene over your box',
        'The clearest Sentinel-2 scene of the box you drew, from the paused window to the days after it. '
        'Pick another in the table below. Orange is your box; white lines are the scene footprints.',
        queries, KEPLER_GROUP, version, options)


SCENE_LINK = ('/d/${__dashboard.uid}?dtab=' + TAB_TITLE
              # Lo que se fija va ANTES de ${__all_variables}: con un var-x
              # repetido, Grafana se queda con el primero.
              + '&var-scene=${__data.fields.scene_url:percentencode}'
              + '&var-sLat=${__data.fields.centre_lat}&var-sLng=${__data.fields.centre_lng}'
              + '&${__url_time_range}&${__all_variables}')


def contact_sheet_element():
    field_config = {
        'defaults': {'custom': {'align': 'auto', 'cellOptions': {'type': 'auto'}, 'inspect': False},
                     'links': [{'title': 'Show this scene on the map', 'url': SCENE_LINK}], 'mappings': []},
        'overrides': [
            by_name('View', ('custom.cellOptions', {'type': 'image'}), ('custom.width', 67)),
            by_name('Date', ('custom.width', 164)),
            by_name('Cloud %', ('unit', 'percent'), ('custom.width', 83)),
            by_name('Covers %', ('unit', 'percent')),
            by_name('centre_lat', ('custom.hidden', True)),
            by_name('centre_lng', ('custom.hidden', True)),
            by_name('scene_url', ('custom.hidden', True)),
        ]}
    options = {'cellHeight': 'lg', 'showHeader': True,
               'footer': {'show': False, 'countRows': False, 'fields': '', 'reducer': ['sum']}}
    return panel(
        23, 'Scenes of your box, as pictures',
        'Every Sentinel-2 scene that passes the cloud and coverage cuts, oldest first. Each thumbnail is your box '
        'cut out of that scene by the tile server. Click a row to show that scene on the map.',
        [duck_query('A', panel_sql('contact_sheet'))], 'table', '13.2.0', options, field_config)


def figures_element():
    field_config = {
        'defaults': {'color': {'mode': 'thresholds'}, 'decimals': 1, 'mappings': [],
                     'thresholds': {'mode': 'absolute', 'steps': [{'color': 'text', 'value': None}]}},
        'overrides': [
            by_name('Min cloud', ('unit', 'percent')),
            by_name('Box covered', ('unit', 'percent')),
            by_name('Scenes', ('decimals', 0)),
            by_name('Matched', ('decimals', 0)),
            by_name('Returned', ('decimals', 0)),
        ]}
    # En esta versión de Grafana 'horizontal' es lo que apila los tiles a lo
    # alto del panel (uno debajo de otro); 'vertical' los pone en fila. No
    # "corregir" esto sin volver a medir en el contenedor real.
    options = {'colorMode': 'none', 'graphMode': 'none', 'justifyMode': 'auto', 'orientation': 'horizontal',
               'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '/.*/', 'values': False},
               'showPercentChange': False, 'textMode': 'value_and_name', 'wideLayout': False}
    return panel(
        24, 'Your box in the catalogue',
        'Box covered is what all the listed scenes see together. Matched is what the catalogue found; if Returned '
        'is lower, the list was cut. HTTP other than 200 means the search failed, not that there are no scenes.',
        [duck_query('A', panel_sql('figures'))], 'stat', '13.2.0', options, field_config)


def fire_map_element(panel8):
    """El mapa de la pestaña Timeline, sin humo y publicando su propia ventana."""
    source = panel8['spec']
    query_a = [copy.deepcopy(q) for q in source['data']['spec']['queries'] if q['spec']['refId'] == 'A']
    options = copy.deepcopy(source['vizConfig']['spec']['options'])
    for key in ('rasterColormap', 'zarrRescale', 'windDensity'):
        options.pop(key, None)
    vis = options['mapConfig']['config']['visState']
    vis['layers'] = [layer for layer in vis['layers'] if layer['config']['dataId'] == 'grafana-A']
    kept = {layer['id'] for layer in vis['layers']}
    vis['layerOrder'] = [layer_id for layer_id in vis.get('layerOrder', []) if layer_id in kept]
    options.update({
        'timeSync': 'variables',
        'timeVariables': {'from': 'scanFrom', 'to': 'scanTo'},
        'publishWhilePlaying': False,
        'peerTimeSync': False,
        'areaVariable': 'burnArea',
        'showSidePanel': False,
        # panel-8 publica minval/maxval; la pestaña Imagery tiene su propio
        # burnArea y no debe pisar las variables que lee la pestaña Global.
        'variableMappings': [],
    })
    return panel(
        21, 'Fires — pause on a day, then draw a box',
        'Play the days, pause on the one you care about, and draw a rectangle with the map draw tool. '
        'Draw it by pressing, dragging and releasing; a click, move, click does not close it on this map. '
        'The map on the right searches Sentinel-2 for that box, from the paused window to the days after it. '
        'The rectangle hides the cells outside it; delete it to see them again.',
        query_a, KEPLER_GROUP, source['vizConfig']['version'], options)


def imagery_elements(dashboard):
    elements = dashboard['spec']['elements']
    if 'panel-8' not in elements:
        raise GraftError('panel-8 (Daily playback) not found: nothing to copy the fire map from')
    panel8 = elements['panel-8']
    return {
        'panel-21': fire_map_element(panel8),
        'panel-22': sentinel_map_element(panel8['spec']['vizConfig']['version']),
        'panel-23': contact_sheet_element(),
        'panel-24': figures_element(),
    }


def graft(dashboard, elements):
    out = copy.deepcopy(dashboard)
    spec = out['spec']
    if spec['layout']['kind'] != 'TabsLayout':
        raise GraftError(f"layout is {spec['layout']['kind']}, expected TabsLayout")
    tabs = spec['layout']['spec']['tabs']
    if any(tab['spec']['title'] == TAB_TITLE for tab in tabs):
        raise GraftError(f'tab {TAB_TITLE} already present')

    key_clash = sorted(set(elements) & set(spec['elements']))
    if key_clash:
        raise GraftError(f'element keys already used: {key_clash}')
    used_ids = {element['spec']['id'] for element in spec['elements'].values()}
    id_clash = sorted(used_ids & {element['spec']['id'] for element in elements.values()})
    if id_clash:
        raise GraftError(f'panel ids already used: {id_clash}')
    new_variables = variables()
    used_names = {variable['spec']['name'] for variable in spec['variables']}
    name_clash = sorted(used_names & {variable['spec']['name'] for variable in new_variables})
    if name_clash:
        raise GraftError(f'variable names already used: {name_clash}')

    spec['variables'].extend(new_variables)
    spec['elements'].update(copy.deepcopy(elements))
    tabs.append({'kind': 'TabsLayoutTab', 'spec': {'title': TAB_TITLE, 'layout': {
        'kind': 'GridLayout',
        'spec': {'items': [grid_item(*cell) for cell in LAYOUT if cell[0] in elements]}}}})
    return out


def local_copy(dashboard):
    """La copia para el banco: otro uid, y sin los metadatos del servidor."""
    spec = copy.deepcopy(dashboard['spec'])
    spec['title'] = spec['title'] + ' (local copy)'
    return {'apiVersion': dashboard['apiVersion'], 'kind': 'Dashboard',
            'metadata': {'name': LOCAL_UID}, 'spec': spec}


def main(argv):
    if len(argv) != 4 or argv[1] not in ('local', 'prod'):
        raise SystemExit('usage: build.py local|prod IN.json OUT.json')
    dashboard = json.loads(pathlib.Path(argv[2]).read_text(encoding='utf-8'))
    out = graft(dashboard, imagery_elements(dashboard))
    if argv[1] == 'local':
        out = local_copy(out)
    pathlib.Path(argv[3]).write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main(sys.argv)
