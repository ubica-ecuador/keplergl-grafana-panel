#!/usr/bin/env python3
"""Pestaña "Imagery" de fire-emissions-tabs: la construye y la injerta.

El tablero vive solo en la base de datos de producción (dashboard v2 con
TabsLayout) y no puede viajar como fichero clásico. Este script no lo guarda:
recibe el objeto v2beta1 tal como lo devuelve el apiserver y devuelve el mismo
objeto con la pestaña añadida, sin tocar nada de lo que ya había.

    python3 scripts/fire-imagery/build.py local prod.json provisioning-sources/dashboards/fire-emissions-tabs-local.json
    python3 scripts/fire-imagery/build.py prod  prod.json grafted.json

`local`/`prod` graft onto a dashboard that does not have the tab yet, and
refuse (GraftError) if it already does — the safe default, so a second run
never duplicates anything by accident. `relocal`/`reprod` instead regraft:
they strip a previous Imagery tab (and only what it added) before grafting
again, which is how an already-deployed tab gets updated. On a dashboard
without the tab, `relocal`/`reprod` behave exactly like `local`/`prod`.

    python3 scripts/fire-imagery/build.py relocal prod.json provisioning-sources/dashboards/fire-emissions-tabs-local.json
    python3 scripts/fire-imagery/build.py reprod  prod.json grafted.json
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
# El color de la marca de la hoja de contactos. Un tono apagado de la paleta de
# Grafana, que se lee en tema claro y oscuro sin competir con las miniaturas.
MARK_COLOUR = 'semi-dark-blue'

# (elemento, x, y, ancho, alto) en la rejilla de 24 columnas de la pestaña.
LAYOUT = [
    ('panel-21', 0, 0, 12, 16),
    ('panel-22', 12, 0, 12, 16),
    ('panel-23', 0, 16, 16, 12),
    ('panel-24', 16, 16, 8, 12),
]

# Variable names a previously deployed Imagery tab may still carry that this
# version no longer adds (e.g. `burnArea`, replaced by the dashboard-wide
# `area`; `scene`, split into `sceneBefore`/`sceneAfter`). regraft must strip
# these too, or a redeploy leaves them orphaned in the production dashboard
# forever. Drop an entry once no deployed dashboard carries it any more.
LEGACY_VARIABLES = {'burnArea', 'scene'}


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
    # In a variable query the datasource does NOT quote or escape on its own:
    # hand-written quotes let a crafted var-area value break out of the
    # literal. ${area:sqlstring} lets Grafana quote and escape it (measured
    # on the bench); that's why there are no quotes here. No box, no rows,
    # and the Sentinel map stays put.
    sql = (
        "SELECT CAST(round(" + axis_fn + "(ST_Centroid(ST_GeomFromText(w))), 5) AS VARCHAR) AS __text,\n"
        "       CAST(round(" + axis_fn + "(ST_Centroid(ST_GeomFromText(w))), 5) AS VARCHAR) AS __value\n"
        "FROM (SELECT nullif(${area:sqlstring}, '') AS w)\n"
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
        text_variable('sceneBefore', 'Imagery scene picked (before)'),
        text_variable('sceneAfter', 'Imagery scene picked (after)'),
        text_variable('sLat', 'Imagery scene lat'),
        text_variable('sLng', 'Imagery scene lng'),
        custom_variable('days', 'Days after', '3,5,10,15,30', '10',
                        'How many days after the paused window to search for Sentinel-2 scenes.'),
        custom_variable('s2cloud', 'Cloud ≤ %', '5,10,20,40,60,100', '40',
                        "The most cloud a scene may carry: the catalogue's eo:cloud_cover, over the whole granule."),
        custom_variable('s2cover', 'Box covered ≥ %', '0,10,25,50,75,100', '50',
                        'How much of the box a scene must cover to be listed.'),
        custom_variable('bands', 'Bands', 'trueColor,forestBurn,infrared,nbr,ndmi', 'forestBurn',
                        'Which bands of each scene to draw. Forest burn shows the scar and the active '
                        'front through smoke; the indices measure rather than illustrate.'),
        custom_variable('lookback', 'Look back (days)', '30,60,90,180', '90',
                        'How far back to look for scenes before the fire. The days right before a fire '
                        'are often smoky or cloudy, so this is deliberately wide. The before side then '
                        'draws the clearest of the six most recent scenes that pass the cloud and coverage '
                        'cuts, however far back those are; the date drawn is always shown, so a change of '
                        'season can be seen.'),
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
    root['mapState'].update({
        'latitude': 6, 'longitude': -25, 'zoom': 1.9,
        'isSplit': True, 'mapSplitMode': 'SWIPE_COMPARE', 'swipeComparePercentage': 50,
    })
    vis = root['visState']
    vis['editor'] = {'features': [], 'visible': True}
    for layer_type in ('rasterTile', 'geojson'):
        count = sum(1 for layer in vis['layers'] if layer['type'] == layer_type)
        if count != 1:
            raise GraftError(f'stac-join.json: expected exactly one {layer_type} layer, found {count}')
    by_type = {layer['type']: layer for layer in vis['layers']}

    scene = by_type['rasterTile']
    scene['id'] = 's2scene'
    scene['config']['label'] = 'Sentinel-2 — after'
    scene['config']['dataId'] = 'grafana-B-raster'
    # kepler guarda "TrueColor" y no sabe releerlo: siempre en minúscula.
    scene['config']['visConfig']['preset'] = 'trueColor'

    # Misma capa, duplicada para el otro lado de la cortina: el único cambio
    # de verdad es de qué consulta lee (D en vez de B) y su etiqueta.
    scene_before = copy.deepcopy(scene)
    scene_before['id'] = 's2scene-before'
    scene_before['config']['label'] = 'Sentinel-2 — before'
    scene_before['config']['dataId'] = 'grafana-D-raster'

    box = copy.deepcopy(by_type['geojson'])
    box['id'] = 'boxoutline'
    box['config'].update({'dataId': 'grafana-A', 'label': 'Your box', 'color': [255, 120, 0]})
    box['config']['visConfig'].update({'strokeColor': [255, 120, 0], 'thickness': 2.5, 'strokeOpacity': 1,
                                       'filled': False, 'stroked': True})

    # Las huellas ahora salen del mismo frame que la escena "after" (consulta
    # B, que ya trae acquired_at/covers_pct y el geojson del footprint): no
    # hace falta una consulta aparte solo para dibujar el contorno.
    footprints = copy.deepcopy(by_type['geojson'])
    footprints['id'] = 'footprints'
    footprints['config'].update({'dataId': 'grafana-B', 'label': 'Scene footprints', 'color': [255, 255, 255]})
    footprints['config']['visConfig'].update({'strokeColor': [255, 255, 255], 'thickness': 1, 'strokeOpacity': 0.6,
                                              'filled': False, 'stroked': True})

    vis['layers'] = [box, footprints, scene_before, scene]
    vis['layerOrder'] = ['boxoutline', 'footprints', 's2scene-before', 's2scene']
    vis['interactionConfig']['tooltip']['fieldsToShow'] = {
        'grafana-A': [],
        # Ya no hay un dataId grafana-C: las huellas (capa footprints) leen
        # de aquí también, y estos son justo los campos que trae B.
        'grafana-B': [{'name': n} for n in ('scene_id', 'acquired_at', 'cloud_cover', 'covers_pct')],
        'grafana-B-raster': [],
        'grafana-D-raster': [],
    }
    # Cada lado nombra las cuatro capas (la forma que usa lulc.json), no solo
    # las suyas: kepler necesita el booleano explícito de ambas para no
    # heredar visibilidad del otro lado.
    vis['splitMaps'] = [
        {'layers': {'boxoutline': True, 'footprints': True, 's2scene-before': True, 's2scene': False}},
        {'layers': {'boxoutline': True, 'footprints': True, 's2scene-before': False, 's2scene': True}},
    ]
    return config


def sentinel_map_element(version):
    options = {
        'basemap': 'auto', 'followGrafanaTheme': True, 'showSidePanel': False, 'peerTimeSync': False,
        'publishWhilePlaying': False, 'timeSync': 'off', 'rasterServerUrl': TILER, 'rasterPainted': False,
        'rasterColormap': '', 'rasterBands': '$bands', 'tripLayerMode': 'table', 'flowRenderMode': 'straight',
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
        duck_query('D', panel_sql('map_scenes_before')),
    ]
    return panel(
        22, 'Sentinel-2 — the scene over your box',
        'The map opens split by a swipe curtain — drag it to compare. The left side is the clearest of '
        'the six most recent scenes before the fire; the right side is '
        'the clearest scene from the paused window to the days after it. Pick another scene for either '
        'side in the table below — '
        'the days right before a fire are often smoky, so widen "Look back (days)" if the Before '
        'figure in "Your box in the catalogue" says none in range. Orange is your box; white lines '
        'are the after-side scene footprints.',
        queries, KEPLER_GROUP, version, options)


SCENE_LINK = ('/d/${__dashboard.uid}?dtab=' + TAB_TITLE
              # Lo que se fija va ANTES de ${__all_variables}: con un var-x
              # repetido, Grafana se queda con el primero. set_before/
              # set_after ya traen -por fila, en contact_sheet.sql- el lado
              # que se pincha y lo que ya hubiera elegido el otro lado.
              + '&var-sceneBefore=${__data.fields.set_before:percentencode}'
              + '&var-sceneAfter=${__data.fields.set_after:percentencode}'
              + '&var-sLat=${__data.fields.centre_lat}&var-sLng=${__data.fields.centre_lng}'
              + '&${__url_time_range}&${__all_variables}')


def contact_sheet_element():
    field_config = {
        'defaults': {'custom': {'align': 'auto', 'cellOptions': {'type': 'auto'}, 'inspect': False},
                     'links': [{'title': 'Show this scene on the map', 'url': SCENE_LINK}], 'mappings': []},
        'overrides': [
            # La marca de lo que el mapa pinta en cada mitad (contact_sheet.sql,
            # columna "Map"). La celda, no la fila: fondo de color solo donde
            # hay marca; las demás llegan como NULL y caen en el umbral base,
            # transparente. Una marca al margen, no una franja.
            by_name('Map',
                    ('custom.cellOptions', {'type': 'color-background', 'mode': 'basic'}),
                    ('custom.width', 44),
                    ('custom.align', 'center'),
                    ('color', {'mode': 'thresholds'}),
                    ('thresholds', {'mode': 'absolute', 'steps': [{'color': 'transparent', 'value': None}]}),
                    ('mappings', [{'type': 'value', 'options': {
                        '◀': {'text': '◀', 'color': MARK_COLOUR, 'index': 0},
                        '▶': {'text': '▶', 'color': MARK_COLOUR, 'index': 1},
                    }}])),
            by_name('View', ('custom.cellOptions', {'type': 'image'}), ('custom.width', 67)),
            by_name('Date', ('custom.width', 164)),
            by_name('Cloud %', ('unit', 'percent'), ('custom.width', 83)),
            by_name('Covers %', ('unit', 'percent')),
            by_name('centre_lat', ('custom.hidden', True)),
            by_name('centre_lng', ('custom.hidden', True)),
            by_name('scene_url', ('custom.hidden', True)),
            by_name('set_before', ('custom.hidden', True)),
            by_name('set_after', ('custom.hidden', True)),
        ]}
    options = {'cellHeight': 'lg', 'showHeader': True,
               'footer': {'show': False, 'countRows': False, 'fields': '', 'reducer': ['sum']}}
    return panel(
        23, 'Scenes of your box, as pictures',
        'Sentinel-2 scenes that pass the cloud and coverage cuts, oldest first. Before rows are the six most '
        'recent scenes before the fire, the ones the left side picks its clearest from — or, if you picked an '
        'older one by hand, that one and the five most recent; After rows are the '
        'catalogue you actually browse, up to 24. Each thumbnail is your box cut out of that scene by the tile '
        'server. The Map column marks the two scenes the map is drawing '
        'right now, whether you picked them or not: ◀ on the left of the curtain, ▶ on the right. Click a row '
        'to show that scene on its side of the split map, keeping the other side as it was.',
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
        'Scenes, Min cloud and Box covered are about the After scenes only; Box covered is what they see '
        'together. Before is the date of the scene the map draws on the left: the clearest of the six most '
        'recent before the fire, or the one you picked — widen "Look back (days)" if it '
        'says none in range. Matched is what the catalogue '
        'found; if Returned is lower, the list was cut. HTTP other than 200 means the search failed, not that '
        'there are no scenes.',
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
        'areaVariable': 'area',
        # Clicking a fire sets the box too: a fixed 6 km square around the
        # clicked cell, drawn on the map as if by hand. Constant in metres, not
        # in degrees, so it covers the same ground at any latitude.
        'clickArea': True,
        'clickAreaSizeMetres': 6000,
        'showSidePanel': False,
        # panel-8 publishes minval/maxval, which the Global tab's panels
        # read; Imagery doesn't need them and must not publish them here.
        'variableMappings': [],
    })
    return panel(
        21, 'Fires — pause on a day, then draw a box',
        'Play the days, pause on the one you care about, and draw a rectangle with the map draw tool. '
        'Draw it by pressing, dragging and releasing. '
        'Or click a fire: that sets a 6 km square around it as the box, which you can delete like a drawing. '
        'Close the draw tool before clicking a fire; while it is open, a click on a fire sets no box. '
        'The map on the right splits by a swipe curtain and searches Sentinel-2 for that box on both '
        'sides: from the paused window to the days after it, and the clearest of the six most recent scenes '
        'before it. A drawn rectangle hides the cells outside it; delete it to see them again. A clicked '
        'square leaves them visible.',
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


def regraft(dashboard, elements):
    """Injerta sobre un tablero que quizá ya tenga la pestaña.

    `graft` se niega a injertar dos veces, que es lo correcto para no duplicar
    nada por accidente. Actualizar lo ya desplegado necesita lo otro: quitar la
    pestaña anterior con lo suyo —y solo lo suyo— y volver a injertar.

    "Lo suyo" son los elementos que la pestaña puesta coloca en su rejilla, no
    los nombres de LAYOUT. La diferencia no es teórica: los paneles que alguien
    añade por la interfaz también se llaman `panel-<n>`, así que uno creado a
    mano puede caer en `panel-23`. Quitarlo por nombre se salta la guardia de
    colisiones de `graft` y lo borra en silencio —y `reprod` escribe en
    producción—. Yendo por la rejilla, un panel ajeno sobrevive: si su clave
    choca con la nuestra, `graft` se niega y no se escribe nada.
    """
    stripped = copy.deepcopy(dashboard)
    spec = stripped['spec']
    tabs = spec['layout']['spec']['tabs']
    ours = {item['spec']['element']['name']
            for tab in tabs if tab['spec']['title'] == TAB_TITLE
            for item in tab['spec'].get('layout', {}).get('spec', {}).get('items', [])}
    spec['layout']['spec']['tabs'] = [tab for tab in tabs if tab['spec']['title'] != TAB_TITLE]
    spec['elements'] = {key: value for key, value in spec['elements'].items() if key not in ours}
    mine = {variable['spec']['name'] for variable in variables()} | LEGACY_VARIABLES
    spec['variables'] = [v for v in spec['variables'] if v['spec']['name'] not in mine]
    return graft(stripped, elements)


def local_copy(dashboard):
    """La copia para el banco: otro uid, y sin los metadatos del servidor."""
    spec = copy.deepcopy(dashboard['spec'])
    spec['title'] = spec['title'] + ' (local copy)'
    return {'apiVersion': dashboard['apiVersion'], 'kind': 'Dashboard',
            'metadata': {'name': LOCAL_UID}, 'spec': spec}


MODES = {'local': graft, 'prod': graft, 'relocal': regraft, 'reprod': regraft}


def main(argv):
    if len(argv) != 4 or argv[1] not in MODES:
        raise SystemExit('usage: build.py local|prod|relocal|reprod IN.json OUT.json')
    dashboard = json.loads(pathlib.Path(argv[2]).read_text(encoding='utf-8'))
    grafter = MODES[argv[1]]
    out = grafter(dashboard, imagery_elements(dashboard))
    if argv[1] in ('local', 'relocal'):
        out = local_copy(out)
    pathlib.Path(argv[3]).write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main(sys.argv)
