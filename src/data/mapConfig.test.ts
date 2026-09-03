import { keepRemoteDatasets, namesBasemap, parseMapConfigJson } from './mapConfig';
import savedByThePanel from '../../testdata/kepler-configs/kepler-v1-saved-config.json';

/** A tileset descriptor as kepler's DatasetSchema saves one. */
const vectorTile = {
  version: 'v1',
  data: {
    id: 'ab12',
    label: 'USA Population',
    color: [143, 47, 191],
    type: 'vector-tile',
    fields: [{ name: 'population', type: 'integer' }],
    allData: [],
    disableDataOperation: true,
    metadata: {
      type: 'remote',
      remoteTileFormat: 'mvt',
      tilesetDataUrl: 'https://tiles.example/{z}/{x}/{y}.pbf',
      tilesetMetadataUrl: 'https://tiles.example/metadata.json',
    },
  },
};

describe('parseMapConfigJson', () => {
  it('parses a kepler saved-config wrapper', () => {
    const saved = { version: 'v1', config: { visState: { layers: [] } } };

    expect(parseMapConfigJson(JSON.stringify(saved))).toEqual(saved);
  });

  it('unwraps a full exported map, keeping only the config', () => {
    // kepler's "Export map" and Dekart both hand out {datasets, config, info}.
    // Only the config half is meaningful here — the data comes from the queries.
    const exported = {
      datasets: [{ version: 'v1', data: { id: 'x', allData: [[1, 2]] } }],
      config: { version: 'v1', config: { visState: { layers: [] } } },
      info: { app: 'kepler.gl' },
    };

    expect(parseMapConfigJson(JSON.stringify(exported))).toEqual(exported.config);
  });

  it('keeps the URL-backed datasets of an exported map', () => {
    // A vector tile layer's whole content is its URL, so the descriptor has to
    // travel with the config or the layer comes back pointing at nothing.
    const exported = {
      datasets: [vectorTile, { version: 'v1', data: { id: 'rows', type: 'local', allData: [[1, 2]] } }],
      config: { version: 'v1', config: { visState: { layers: [] } } },
    };

    expect(parseMapConfigJson(JSON.stringify(exported))).toEqual({
      ...exported.config,
      datasets: [vectorTile],
    });
  });

  it('round-trips a config this panel wrote', () => {
    const saved = { version: 'v1', config: { visState: { layers: [] } }, datasets: [vectorTile] };

    expect(parseMapConfigJson(JSON.stringify(saved))).toEqual(saved);
  });

  it('drops datasets the paste carried that cannot be restored', () => {
    // Without this a hand-edited paste could leave a `datasets` key full of
    // entries the load path would hand to kepler as if they were tilesets.
    const saved = {
      version: 'v1',
      config: { visState: { layers: [] } },
      datasets: [{ version: 'v1', data: { id: 'rows', allData: [[1, 2]] } }],
    };

    expect(parseMapConfigJson(JSON.stringify(saved))).toEqual({ version: saved.version, config: saved.config });
  });

  it('returns null for anything that is not a config', () => {
    for (const input of ['', 'not json', '[]', 'null', '42', '{"nope":1}']) {
      expect(parseMapConfigJson(input)).toBeNull();
    }
  });
});

describe('keepRemoteDatasets', () => {
  it('keeps every type whose content is a URL', () => {
    const types = ['vector-tile', 'raster-tile', 'wms-tile', 'tile-3d', 'bitmap'];
    const entries = types.map((type, i) => ({ version: 'v1', data: { id: `d${i}`, type, fields: [] } }));

    expect(keepRemoteDatasets(entries).map((d) => d.data.type)).toEqual(types);
  });

  it('drops the datasets the queries rebuild and the files dropped into kepler', () => {
    const entries = [
      // What a dataset built from a Grafana query looks like.
      { version: 'v1', data: { id: 'A', type: '', fields: [] } },
      // What a CSV dropped into Add Data looks like: its rows would land in the
      // dashboard JSON, which is a different feature.
      { version: 'v1', data: { id: 'file', type: 'local', fields: [] } },
    ];

    expect(keepRemoteDatasets(entries)).toEqual([]);
  });

  it('strips rows a tileset descriptor should never carry', () => {
    const entries = [{ version: 'v1', data: { id: 'ab12', type: 'vector-tile', fields: [], allData: [[1, 2]] } }];

    expect(keepRemoteDatasets(entries)[0].data.allData).toEqual([]);
  });

  it('gives a descriptor with no field list an empty one', () => {
    // kepler's DatasetSchema.load indexes fields[0] unguarded.
    const entries = [{ version: 'v1', data: { id: 'ab12', type: 'vector-tile' } }];

    expect(keepRemoteDatasets(entries)[0].data.fields).toEqual([]);
  });

  it('tolerates junk where a dataset list should be', () => {
    for (const input of [undefined, null, 'nope', {}, [null], [{ version: 1, data: {} }], [{ version: 'v1' }]]) {
      expect(keepRemoteDatasets(input)).toEqual([]);
    }
  });
});

describe('namesBasemap', () => {
  const withStyle = (mapStyle: unknown) => ({ version: 'v1', config: { mapStyle } }) as never;

  it('is false for nothing at all', () => {
    expect(namesBasemap(undefined)).toBe(false);
    expect(namesBasemap(null)).toBe(false);
  });

  it('is false for a config that carries no style — the pasted-by-hand shape', () => {
    // Not the shape this panel captures: `getConfigToSave` always writes a
    // mapStyle (see the fixture case below). This is the one a user pastes into
    // Import configuration to place a layer, which is why the option was dead.
    expect(namesBasemap({ version: 'v1', config: { visState: {}, mapState: {} } } as never)).toBe(false);
    expect(namesBasemap(withStyle(null))).toBe(false);
  });

  it('is false for a mapStyle that chooses nothing', () => {
    expect(namesBasemap(withStyle({}))).toBe(false);
    expect(namesBasemap(withStyle({ styleType: '' }))).toBe(false);
    expect(namesBasemap(withStyle({ styleType: 7 }))).toBe(false);
  });

  it('is true only when a style is actually named', () => {
    expect(namesBasemap(withStyle({ styleType: 'dark' }))).toBe(true);
    expect(namesBasemap(withStyle({ styleType: 'grafana-custom-basemap' }))).toBe(true);
  });

  it('is true for a real config this panel saved, so those keep outranking the option', () => {
    // The guard rail on the fix's scope: a captured config names a style, and
    // must go on winning. Only configs that name none change behaviour.
    expect(namesBasemap(savedByThePanel as never)).toBe(true);
  });
});
