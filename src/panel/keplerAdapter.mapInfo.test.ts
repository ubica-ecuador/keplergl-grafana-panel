import { registerEntry, setMapInfo, wrapTo } from '@kepler.gl/actions';

import { KEPLER_INSTANCE_ID } from './constants';
import { captureMapConfig, loadDatasets } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';

/**
 * The map's name and description, **Interactions → Map info** in kepler, which
 * `getConfigToSave` leaves out of the config the panel saves. Run against
 * kepler's real store, so a kepler that moves them shows up here.
 */

function newMap() {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }));
  return store;
}

const mapInfoOf = (store: ReturnType<typeof newMap>) =>
  (store.getState() as { keplerGl: Record<string, { visState: { mapInfo?: unknown } }> }).keplerGl[KEPLER_INSTANCE_ID]
    .visState.mapInfo;

describe('the map name and description through Save map', () => {
  it('are saved beside the config, and back on the map when it loads', () => {
    const before = newMap();
    before.dispatch(wrapTo(KEPLER_INSTANCE_ID, setMapInfo({ title: 'Rain gauges', description: 'Cuenca, last 24 h' })));

    const saved = captureMapConfig(before);
    expect(saved?.info).toEqual({ title: 'Rain gauges', description: 'Cuenca, last 24 h' });

    const after = newMap();
    loadDatasets(after, after.dispatch, [], {}, saved);
    expect(mapInfoOf(after)).toEqual({ title: 'Rain gauges', description: 'Cuenca, last 24 h' });
  });

  it('leave a map that has neither saving what it saved before', () => {
    const saved = captureMapConfig(newMap());

    expect(saved).not.toBeNull();
    expect(saved).not.toHaveProperty('info');
  });

  it('keep a description that has no name', () => {
    const store = newMap();
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, setMapInfo({ description: 'Only a description' })));

    expect(captureMapConfig(store)?.info).toEqual({ description: 'Only a description' });
  });
});
