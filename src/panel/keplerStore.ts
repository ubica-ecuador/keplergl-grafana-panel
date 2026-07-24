import { keplerGlReducer, enhanceReduxMiddleware } from '@kepler.gl/reducers';
import { applyMiddleware, combineReducers, legacy_createStore, Store } from 'redux';

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
    }),
  });

  return legacy_createStore(reducer, {}, applyMiddleware(...enhanceReduxMiddleware([])));
}
