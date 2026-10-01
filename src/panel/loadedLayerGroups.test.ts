import { loadMapStyles, mapConfigChange, mapStyleChange, registerEntry, wrapTo } from '@kepler.gl/actions';

import { CARTO_DARK_MATTER_LAYERS, OPENFREEMAP_LIBERTY_LAYERS, UPPER_CASE_LAYERS } from './basemapStyleFixtures';
import { KEPLER_INSTANCE_ID } from './constants';
import { createKeplerStore } from './keplerStore';
import { STYLE_LAYER_GROUPS } from './layerGroups';
import { withLoadedLayerGroups } from './loadedLayerGroups';

type MapStyleState = {
  styleType: string;
  visibleLayerGroups: Record<string, boolean>;
  mapStyles: Record<string, { layerGroups: Array<{ slug: string }> }>;
};
const mapStyleOf = (store: ReturnType<typeof createKeplerStore>) =>
  (store.getState() as { keplerGl: Record<string, { mapStyle: MapStyleState }> }).keplerGl[KEPLER_INSTANCE_ID].mapStyle;
const to = wrapTo(KEPLER_INSTANCE_ID);
const doc = (layers: unknown[]) => ({ version: 8, sources: {}, layers });
const slugs = (groups: Array<{ slug: string }>) => groups.map((g) => g.slug);

describe('withLoadedLayerGroups', () => {
  it('keeps only the groups the arriving document has', () => {
    const action = to(
      loadMapStyles({
        x: { id: 'x', url: 'u', layerGroups: STYLE_LAYER_GROUPS, style: doc(OPENFREEMAP_LIBERTY_LAYERS) },
      } as never)
    );
    const groups = (withLoadedLayerGroups(action) as any).payload.payload.newStyles.x.layerGroups;
    expect(slugs(groups)).toEqual(['label', 'poi', 'road', 'border', 'building', 'water', '3d building']);
  });

  it('leaves an entry without a document alone — a style that never loads keeps its switches', () => {
    const action = loadMapStyles({ x: { id: 'x', url: 'u', layerGroups: STYLE_LAYER_GROUPS } } as never);
    expect((withLoadedLayerGroups(action) as any).payload.newStyles.x.layerGroups).toBe(STYLE_LAYER_GROUPS);
  });

  it('passes every other action through untouched', () => {
    const action = to(mapStyleChange('x'));
    expect(withLoadedLayerGroups(action)).toBe(action);
  });
});

describe('a self-hosted style in the real store', () => {
  // mapStyleChange to a style without its document starts kepler's load task,
  // which fetches the URL. A fetch that never answers keeps the task pending,
  // and the test hands the document over itself, as the task would.
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = jest.fn(() => new Promise<Response>(() => {})) as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('shows the groups its document has, and keeps the switches the map held', () => {
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
    const custom = {
      id: 'custom',
      label: 'Custom',
      url: 'https://tiles.internal/style.json',
      layerGroups: STYLE_LAYER_GROUPS,
    };
    const positron = {
      id: 'positron',
      label: 'Positron',
      url: 'https://p/style.json',
      layerGroups: STYLE_LAYER_GROUPS,
    };
    // Registration, as KeplerGl's _loadMapStyle does it: no documents yet.
    store.dispatch(to(loadMapStyles({ positron, custom } as never)) as never);
    store.dispatch(
      to(loadMapStyles({ positron: { ...positron, style: doc(CARTO_DARK_MATTER_LAYERS) } } as never)) as never
    );
    store.dispatch(to(mapStyleChange('positron')) as never);
    const held = { ...mapStyleOf(store).visibleLayerGroups, label: false, water: false };
    store.dispatch(to(mapConfigChange({ visibleLayerGroups: held } as never)) as never);

    store.dispatch(to(mapStyleChange('custom')) as never);
    store.dispatch(to(loadMapStyles({ custom: { ...custom, style: doc(UPPER_CASE_LAYERS) } } as never)) as never);

    const state = mapStyleOf(store);
    expect(state.styleType).toBe('custom');
    expect(slugs(state.mapStyles.custom.layerGroups)).toEqual(['label', 'poi', 'road', 'building', 'water']);
    expect(state.visibleLayerGroups).toEqual({ label: false, poi: true, road: true, building: true, water: false });
  });
});
