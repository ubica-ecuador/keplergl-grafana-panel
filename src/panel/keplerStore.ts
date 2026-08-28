import { Layer, LayerClasses } from '@kepler.gl/layers';
import { keplerGlReducer, enhanceReduxMiddleware } from '@kepler.gl/reducers';
import { applyMiddleware, combineReducers, legacy_createStore, Store } from 'redux';

import { buildCogPaintedDeckLayer } from './cogPaintedDeckLayer';
import { makeCogPaintedLayer } from './cogPaintedLayer';
import { buildEsriImageDeckLayer } from './esriImageDeckLayer';
import { makeEsriImageLayer } from './esriImageLayer';
import { buildFlowFieldDeckLayer, makeScreenCamera } from './flowFieldDeckLayer';
import { makeFlowFieldLayer } from './flowFieldLayer';
import { withTripGpuFilterFix } from './tripLayerFix';
import { buildTimedWmsLayer } from './wmsDeckLayer';
import { withWmsTime } from './wmsTimeLayer';
import { buildZarrDeckLayer } from './zarrDeckLayer';
import { makeZarrLayer } from './zarrTileLayer';

/**
 * kepler's layer classes, with the Trip layer repaired, the WMS layer taught to
 * ask for a date, and two layers added that kepler has no equivalent of.
 *
 * kepler builds layers from `visState.layerClasses`, so replacing an entry here
 * is the whole of the change — see `tripLayerFix.ts` for what is wrong with the
 * stock Trip layer and why it has to be done at the class rather than the
 * instance, and `wmsTimeLayer.ts` for why a time-aware WMS cannot be driven
 * from outside the layer at all.
 */
const layerClasses = {
  ...LayerClasses,
  trip: withTripGpuFilterFix(LayerClasses.trip),
  wms: withWmsTime(LayerClasses.wms, buildTimedWmsLayer),
  // Not a repair but an addition: kepler ships no generic raster tileset —
  // `RemoteTileFormat` is mvt, pmtiles or wms, and its raster path is wired to
  // STAC and PMTiles — so a Zarr rendered by TiTiler has nothing upstream to
  // wrap. Built on the base `Layer` rather than on a concrete one, which is
  // where `RasterTileLayer` starts from too: a tileset has no rows, so every
  // concrete layer's column handling would be dead weight at best.
  zarr: makeZarrLayer(Layer as never, buildZarrDeckLayer),
  // A third addition, and the narrowest: it draws the same COGs kepler's own
  // raster layer draws, but asks the server for a finished picture instead of
  // raw arrays. kepler's layer cannot colour a *classified* raster — it rescales
  // the class numbers over the whole dtype range and every class lands on one
  // colour — while TiTiler reads the palette the file carries. Kept as a
  // separate class rather than a mode of the stock one so nothing changes for
  // the imagery that path already draws well.
  cogPainted: makeCogPaintedLayer(Layer as never, buildCogPaintedDeckLayer),
  // A fourth addition, and the one that needs no file at all. An ArcGIS Image
  // Service is a mosaic dataset behind an endpoint: it holds the catalogue, the
  // rule for choosing among its rasters and a pyramid over the whole thing, so
  // it answers for any extent at any zoom. Where the COG paths need one query
  // per file — 200 of them for a global 10 m collection — this needs one.
  esriImage: makeEsriImageLayer(Layer as never, buildEsriImageDeckLayer),
  // Also an addition, and for a stranger reason than the Zarr one: what this
  // layer draws is in no dataset. The rows are a lattice of velocity samples and
  // what is painted are the paths a particle would take through them — geometry
  // computed at draw time, from the viewport. Built on the base `Layer` because
  // the Trip layer it ultimately paints is all about turning rows into paths,
  // and every part of that would have to be overridden.
  flowfield: makeFlowFieldLayer(Layer as never, buildFlowFieldDeckLayer, makeScreenCamera),
};

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
