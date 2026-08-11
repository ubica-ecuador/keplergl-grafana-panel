import { LayerClasses } from '@kepler.gl/layers';
import { keplerGlReducer, enhanceReduxMiddleware } from '@kepler.gl/reducers';
import { applyMiddleware, combineReducers, legacy_createStore, Store } from 'redux';

import { withTripGpuFilterFix } from './tripLayerFix';

/**
 * kepler's layer classes, with the Trip layer repaired.
 *
 * kepler builds layers from `visState.layerClasses`, so replacing the entry here
 * is the whole of the fix — see `tripLayerFix.ts` for what is wrong with the
 * stock one and why it has to be done at the class rather than the instance.
 */
const layerClasses = { ...LayerClasses, trip: withTripGpuFilterFix(LayerClasses.trip) };

/**
 * Builds a Redux store dedicated to one panel instance.
 *
 * Grafana externalizes `redux` and `react-redux`, so this store is created from
 * the very same module instance Grafana itself uses. That is fine — the store is
 * private to this panel and mounted under its own `<Provider>`. The consequence
 * is that react-redux's context is overridden inside that subtree, which is why
 * no `@grafana/ui` component may be rendered inside the kepler subtree.
 *
 * `enhanceReduxMiddleware` adds react-palm's taskMiddleware, which kepler.gl
 * needs for its side effects (tile loading, file parsing, geocoding).
 */
export function createKeplerStore(): Store {
  // kepler.gl's components look their state up at `state.keplerGl` by default.
  // Mounting the reducer at the store root instead makes every one of them fail
  // with "kepler.gl state does not exist".
  const reducer = combineReducers({
    keplerGl: keplerGlReducer.initialState({
      uiState: {
        // The export/share modals reach for cloud providers we do not configure.
        currentModal: null,
      },
      // Merged key by key into kepler's own initial vis state, so this replaces
      // the layer registry and nothing else.
      visState: { layerClasses },
    }),
  });

  return legacy_createStore(reducer, {}, applyMiddleware(...enhanceReduxMiddleware([])));
}
