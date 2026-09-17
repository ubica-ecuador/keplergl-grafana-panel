import { Layer, LayerClasses, RasterTileIcon } from '@kepler.gl/layers';
import { keplerGlReducer, enhanceReduxMiddleware } from '@kepler.gl/reducers';
import type { ComponentType } from 'react';
import { applyMiddleware, combineReducers, legacy_createStore, Store } from 'redux';

import { buildCogPaintedDeckLayer } from './cogPaintedDeckLayer';
import { makeCogPaintedLayer } from './cogPaintedLayer';
import { buildEsriImageDeckLayer } from './esriImageDeckLayer';
import { makeEsriImageLayer } from './esriImageLayer';
import { buildFlowFieldDeckLayer, makeScreenCamera } from './flowFieldDeckLayer';
import { makeFlowFieldLayer } from './flowFieldLayer';
import { buildMarkersDeckLayer } from './markersDeckLayer';
import { makeMarkersLayer } from './markersLayer';
import { ownLayerIcon } from './ownLayerIcon';
import { buildSymbolDeckLayer } from './symbolDeckLayer';
import { makeSymbolLayer } from './symbolLayer';
import { withTile3dAltitude } from './tile3dAltitudeLayer';
import { buildVectorFieldDeckLayer } from './vectorFieldDeckLayer';
import { makeVectorFieldLayer } from './vectorFieldLayer';
import { buildTimedWmsLayer } from './wmsDeckLayer';
import { withWmsTime } from './wmsTimeLayer';
import { buildZarrDeckLayer } from './zarrDeckLayer';
import { withFoldedSplitMaps } from './splitMapsNormalise';
import { makeZarrLayer } from './zarrTileLayer';

/**
 * The icon a stock layer shows, borrowed for one of ours.
 *
 * Read off the class rather than imported: kepler exports the raster tile icon
 * from its package index but not the arc one, and the only other way to it is a
 * path into `dist/esm` that the next release is free to move. `layerIcon` is a
 * getter on the prototype returning a constant, so it can be read without
 * building a layer.
 *
 * Returns undefined if kepler ever stops exposing it, and the factories fall
 * back to the base class's placeholder — a missing icon is not worth a crash.
 */
export function iconOf(LayerClass: unknown): unknown {
  const prototype = (LayerClass as { prototype?: object } | undefined)?.prototype;
  if (!prototype) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'layerIcon');
  return descriptor?.get?.call(prototype);
}

/**
 * A borrowed kepler icon, in the amber that marks this plugin's own layers in
 * kepler's layer menu — see `ownLayerIcon.tsx`. The stock layers keep theirs.
 */
const own = (icon: unknown) => ownLayerIcon(icon as ComponentType);

/** The arc layer's icon, which the flow field borrows: both draw curves. */
const ARC_ICON = own(iconOf(LayerClasses.arc));

/** The icon layer's icon, which the vector field borrows: both draw icons. */
const ICON_LAYER_ICON = own(iconOf(LayerClasses.icon));

/** The point layer's icon, which the markers borrow: both draw dots. */
const POINT_LAYER_ICON = own(iconOf(LayerClasses.point));

/** kepler's raster tile icon, which the three tileset layers borrow. */
const RASTER_ICON = own(RasterTileIcon);

/**
 * kepler's layer classes, with the WMS layer taught to ask for a date and four
 * layers added that kepler has no equivalent of.
 *
 * kepler builds layers from `visState.layerClasses`, so replacing an entry here
 * is the whole of the change — see `wmsTimeLayer.ts` for why a time-aware WMS
 * cannot be driven from outside the layer at all, and why that has to be done
 * at the class rather than at the instance.
 */
const layerClasses = {
  ...LayerClasses,
  wms: withWmsTime(LayerClasses.wms, buildTimedWmsLayer),
  // A repair, like the WMS one above. A 3D tileset states its geometry at its
  // real altitude and this map's ground is a plane at zero, so a mesh surveyed
  // on a hill draws in mid-air — and past a certain camera does not draw at
  // all, with no error to explain it. `tile3dAltitude.ts` has the measurements.
  tile3d: withTile3dAltitude(LayerClasses.tile3d),
  // Not a repair but an addition: kepler ships no generic raster tileset —
  // `RemoteTileFormat` is mvt, pmtiles or wms, and its raster path is wired to
  // STAC and PMTiles — so a Zarr rendered by TiTiler has nothing upstream to
  // wrap. Built on the base `Layer` rather than on a concrete one, which is
  // where `RasterTileLayer` starts from too: a tileset has no rows, so every
  // concrete layer's column handling would be dead weight at best.
  zarr: makeZarrLayer(Layer as never, buildZarrDeckLayer, RASTER_ICON),
  // A third addition, and the narrowest: it draws the same COGs kepler's own
  // raster layer draws, but asks the server for a finished picture instead of
  // raw arrays. kepler's layer cannot colour a *classified* raster — it rescales
  // the class numbers over the whole dtype range and every class lands on one
  // colour — while TiTiler reads the palette the file carries. Kept as a
  // separate class rather than a mode of the stock one so nothing changes for
  // the imagery that path already draws well.
  cogPainted: makeCogPaintedLayer(Layer as never, buildCogPaintedDeckLayer, RASTER_ICON),
  // A fourth addition, and the one that needs no file at all. An ArcGIS Image
  // Service is a mosaic dataset behind an endpoint: it holds the catalogue, the
  // rule for choosing among its rasters and a pyramid over the whole thing, so
  // it answers for any extent at any zoom. Where the COG paths need one query
  // per file — 200 of them for a global 10 m collection — this needs one.
  esriImage: makeEsriImageLayer(Layer as never, buildEsriImageDeckLayer, RASTER_ICON),
  // Also an addition, and for a stranger reason than the Zarr one: what this
  // layer draws is in no dataset. The rows are a lattice of velocity samples and
  // what is painted are the paths a particle would take through them — geometry
  // computed at draw time, from the viewport. Built on the base `Layer` because
  // the Trip layer it ultimately paints is all about turning rows into paths,
  // and every part of that would have to be overridden.
  flowfield: makeFlowFieldLayer(Layer as never, buildFlowFieldDeckLayer, makeScreenCamera, ARC_ICON),
  // The flow field's sibling: the same grid of velocities, marked with arrows
  // and wind barbs instead of traced. Same column modes and shared knobs under
  // the same names, so kepler keeps them when a layer's type is switched between
  // the two.
  vectorfield: makeVectorFieldLayer(Layer as never, buildVectorFieldDeckLayer, makeScreenCamera, ICON_LAYER_ICON),
  // The vector field's opposite number: where that one marks a grid, this draws
  // one symbol per row, turned and sized by columns of the table. Built on the
  // base `Layer` so kepler's row machinery — filters, the clock, tooltips —
  // applies unchanged.
  symbol: makeSymbolLayer(Layer as never, buildSymbolDeckLayer, ICON_LAYER_ICON),
  // Reference points the user drags, each publishing its position to a pair of
  // dashboard variables — an isochrone's origin and destination. Nothing from
  // the dataset is drawn; see `markersLayer.ts`.
  markers: makeMarkersLayer(Layer as never, buildMarkersDeckLayer, POINT_LAYER_ICON),
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
 * `enhanceReduxMiddleware` adds the task middleware kepler.gl needs for its side
 * effects — tile loading, file parsing, geocoding. It used to come from
 * react-palm; since 3.3.0-alpha.11 kepler ships its own in `@kepler.gl/tasks`,
 * which is why this plugin no longer depends on react-palm.
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

  // kepler's split-map merge appends panes instead of folding them in, and does
  // it again on every refresh that finds the panes empty — 2, 4, 8, … 512 panes
  // in one session, measured. No kepler action can trim the list, so it is
  // folded back here, at the one seam this plugin owns: reading what the reducer
  // returned is not a dispatch, so it cannot loop, and a state already within
  // bounds comes back by identity. See `splitMapsNormalise.ts`.
  const withinBounds = (state: never, action: never) => withFoldedSplitMaps(reducer(state, action));

  return legacy_createStore(withinBounds as never, {}, applyMiddleware(...enhanceReduxMiddleware([])));
}
