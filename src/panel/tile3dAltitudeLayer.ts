/**
 * Teaches kepler's 3D tile layer where the ground is.
 *
 * A tileset states its geometry at its real altitude and the panel's world is
 * flat, so a mesh surveyed on a hill draws in mid-air — and, past a certain
 * camera, does not draw at all. `tile3dAltitude.ts` explains the mechanism and
 * carries the arithmetic; this file is the wiring.
 *
 * Two knobs reach the layer panel:
 *
 * - **Sit on the ground** — bring the tileset's base down to z = 0. On by
 *   default, because a mesh added through *Add Data → Tileset → 3D Tile*
 *   otherwise renders nothing at all at any useful camera, with no error to
 *   explain it. For a tileset already surveyed near sea level the correction is
 *   a metre or two.
 * - **Height (m)** — a trim on top, for a tileset whose own idea of its base is
 *   wrong, or to lift one clear of something underneath it.
 *
 * **Why a class in the registry rather than props from the panel.** kepler
 * builds its layers itself; by the time an instance could be reached from
 * outside, the deck layer has already gone to the renderer. `withWmsTime` is
 * the same pattern for the same reason.
 *
 * **Why the deck layer is subclassed too.** The offset has to be resolved
 * against the tileset — the layer needs to know how high the tileset thinks it
 * is — and the tileset only exists inside the deck layer, after an async load.
 * So the knobs travel as deck props and the work happens in `updateState`,
 * which deck calls again both when a prop changes and when the tileset lands.
 */

import {
  altitudeOffsetFor,
  applyAltitude,
  catchUpTile,
  groundUnder,
  groundsUnderView,
  needsMove,
  nextGround,
  searchSettled,
  spansTooWide,
  trimOf,
  upAt,
  type Placement,
  type TileLike,
  type TilesetLike,
} from './tile3dAltitude';
import { sturdyLoader } from './tile3dLoader';

/** The knobs, in the shape `registerVisConfig` takes. */
export const TILE3D_ALTITUDE_VIS_CONFIGS = {
  groundTileset: {
    type: 'boolean',
    defaultValue: true,
    label: 'tile3d.groundTileset',
    group: 'display',
    property: 'groundTileset',
  },
  altitudeOffset: {
    type: 'number',
    defaultValue: 0,
    label: 'tile3d.altitudeOffset',
    isRanged: false,
    // Wide enough for a mesh on a plateau — Cuenca sits at 2 550 m — and for
    // pushing one below the map to bury it.
    range: [-4000, 4000],
    step: 1,
    group: 'display',
    property: 'altitudeOffset',
  },
} as const;

/** deck's viewport, as far as grounding a tileset round the whole world reads it. */
interface ViewportLike {
  /** Tileset3D keeps the tree it traverses for each viewport under this id. */
  id?: string;
  longitude?: number;
  latitude?: number;
  cameraPosition?: ArrayLike<number>;
  distanceScales?: { unitsPerMeter?: ArrayLike<number> };
}

/** What the deck subclass needs of the class it extends. */
interface DeckTile3DLayerLike {
  props: Record<string, unknown>;
  context?: { viewport?: ViewportLike } | null;
  state?: {
    tileset3d?: TilesetLike | null;
    activeViewports?: Record<string, unknown>;
    lastUpdatedViewports?: Record<string, unknown> | null;
    /** deck's, one entry per tile it has built a sublayer for; `needsUpdate` has it built again. */
    layerMap?: Record<string, { needsUpdate?: boolean }>;
    /** deck's, bumped each time a traversal completes. */
    frameNumber?: number;
    /**
     * Ours, for a tileset round the whole world: the tileset they describe, the
     * ground last settled on, when the last search step was taken (deck's frame
     * and the time), and where the tileset was last put.
     */
    groundOf?: TilesetLike | null;
    ground?: number | null;
    groundSearchFrame?: number | null;
    groundSearchTime?: number | null;
    placed?: Placement | null;
  } | null;
  updateState(params: unknown): void;
  _updateTileset?(viewports: Record<string, unknown> | null | undefined): void;
  /** deck's, bound as the tileset's `onTileLoad` when the tileset is created. */
  _onTileLoad?(tile: unknown): void;
}

/**
 * How far, in metres, the ground under the view — or the turn of the vertical
 * there — must move a tileset round the whole world before it is moved again:
 * every move re-traverses the whole tree, and panning a few blocks should not.
 * A change of the Height adjustment always moves it (`needsMove`).
 */
const GROUND_TOLERANCE = 30;

/** Where the view looks and how high the camera is above the ground plane, or null while deck has no viewport. */
function viewOf(
  viewport: ViewportLike | null | undefined
): { id: string; longitude: number; latitude: number; cameraHeight: number } | null {
  const unitsPerMetre = viewport?.distanceScales?.unitsPerMeter?.[2];
  const cameraZ = viewport?.cameraPosition?.[2];
  const { id, longitude, latitude } = viewport ?? {};
  if (
    typeof id !== 'string' ||
    typeof longitude !== 'number' ||
    typeof latitude !== 'number' ||
    typeof cameraZ !== 'number' ||
    typeof unitsPerMetre !== 'number' ||
    !(unitsPerMetre > 0)
  ) {
    return null;
  }
  return { id, longitude, latitude, cameraHeight: cameraZ / unitsPerMetre };
}

// The usual mixin constructor type. `any[]` rather than `unknown[]` on purpose:
// constructor parameters are checked contravariantly, so `unknown[]` would
// reject every concrete class — including kepler's own.
type Constructor<T> = new (...args: any[]) => T;

/**
 * One subclass per base class, for the life of the page.
 *
 * Not a nicety: deck decides whether a layer is *the same layer* by its class
 * as well as its id, so handing it a freshly minted class on every render would
 * finalize the tileset and download it again — several hundred megabytes, every
 * frame. GeoLibre caches the same way, for the same reason.
 *
 * Keyed on the base rather than held in one variable because the base is read
 * off the instance kepler built, and kepler is free to build a different class
 * for, say, a Google tileset.
 */
const subclasses = new WeakMap<object, Constructor<DeckTile3DLayerLike>>();

/**
 * The given deck layer class, taught to keep its tileset on the ground.
 *
 * The base comes from the instance rather than from an import: kepler's own
 * `KeplerTile3DLayer` is not exported, and it carries repairs of its own —
 * legacy coordinate systems, caught traversal errors, an export-aware
 * `isLoaded` — that a layer assembled from scratch here would throw away.
 */
export function altitudeAware<C extends Constructor<DeckTile3DLayerLike>>(Base: C): C {
  const cached = subclasses.get(Base);
  if (cached) {
    return cached as C;
  }

  class AltitudeAwareTile3DLayer extends (Base as Constructor<DeckTile3DLayerLike>) {
    static layerName = 'AltitudeAwareTile3DLayer';
    static defaultProps = {
      ...((Base as { defaultProps?: Record<string, unknown> }).defaultProps ?? {}),
      groundTileset: true,
      altitudeOffset: 0,
    };

    updateState(params: unknown): void {
      super.updateState(params);
      this.syncAltitude();
    }

    /**
     * Puts the tileset where the knobs say, and re-traverses if it moved.
     *
     * The re-traversal is the point: every bounding volume the last pass culled
     * against has moved with the tree, so without it the map stays blank until
     * the user happens to nudge the camera.
     *
     * It runs only when something actually moved, and that guard is what keeps
     * it from looping: `_updateTileset` ends in `setState`, which brings
     * `updateState` round again.
     */
    syncAltitude(): boolean {
      const tileset = this.state?.tileset3d;
      if (!tileset) {
        return false;
      }
      const moved = groundsUnderView(tileset)
        ? this.groundUnderView(tileset)
        : applyAltitude(tileset, altitudeOffsetFor(this.props, tileset));
      if (!moved) {
        return false;
      }

      // Every tile already loaded has been moved with the tileset
      // (`applyAltitude`), but deck builds a tile's sublayer once and only
      // builds it again when told to.
      const layerMap = this.state?.layerMap;
      for (const key in layerMap ?? {}) {
        layerMap![key].needsUpdate = true;
      }

      // deck empties `activeViewports` as soon as it has traversed with them,
      // so by the time a knob moves the only record of where the camera is
      // looking is the previous pass's. `_updateTileset` ignores an empty set.
      const active = this.state?.activeViewports;
      const viewports = active && Object.keys(active).length > 0 ? active : this.state?.lastUpdatedViewports;
      this._updateTileset?.(viewports);
      return true;
    }

    /**
     * A tile has loaded: put it where the tileset now is, in case it loaded
     * against where the tileset was (`catchUpTile`), then on to deck.
     */
    _onTileLoad(tile: unknown): void {
      catchUpTile(tile as TileLike);
      super._onTileLoad?.(tile);
    }

    /**
     * Lowers a tileset round the whole world by the ground under the centre of
     * the view (`groundUnder`, `nextGround`), along the vertical there.
     *
     * A search step waits for the last one to settle (`searchSettled`): deck
     * bumps `frameNumber` each time a traversal completes, and until one has,
     * `isLoaded` still describes the tiles from before the step.
     */
    groundUnderView(tileset: TilesetLike): boolean {
      const view = viewOf(this.context?.viewport);
      const state = this.state;
      if (!view || !state) {
        return false;
      }
      const now = performance.now();
      if (state.groundOf !== tileset) {
        // A new tileset — another URL, or the same one loaded again — owes nothing to the last one's ground.
        state.groundOf = tileset;
        state.ground = null;
        state.groundSearchFrame = null;
        state.groundSearchTime = now;
        state.placed = null;
      }
      let ground = 0;
      if (this.props.groundTileset !== false) {
        const settled = searchSettled({
          loaded: Boolean(tileset.isLoaded?.()),
          frame: state.frameNumber,
          stepFrame: state.groundSearchFrame,
          now,
          stepTime: state.groundSearchTime,
        });
        const reading = groundUnder(tileset, view.longitude, view.latitude, view.id);
        const next = nextGround(reading, view, settled, state.ground ?? null);
        if (next.searched) {
          state.groundSearchFrame = state.frameNumber ?? null;
          state.groundSearchTime = now;
        }
        state.ground = next.ground;
        ground = next.ground;
      }
      const placement: Placement = { ground, trim: trimOf(this.props), up: upAt(view.longitude, view.latitude) };
      if (!needsMove(state.placed ?? null, placement, GROUND_TOLERANCE)) {
        return false;
      }
      state.placed = placement;
      return applyAltitude(tileset, placement.trim - placement.ground, { up: placement.up });
    }
  }

  subclasses.set(Base, AltitudeAwareTile3DLayer as Constructor<DeckTile3DLayerLike>);
  return AltitudeAwareTile3DLayer as unknown as C;
}

/** The members of kepler's 3D tile layer this wrapper touches. */
interface Tile3DLayerLike {
  config?: { visConfig?: Record<string, unknown> };
  registerVisConfig(configs: Record<string, unknown>): void;
  renderLayer(opts?: unknown): unknown[];
  /** Private to kepler: it frames the map round the tileset only while this is false. */
  _hasFittedBounds?: boolean;
  /** kepler's own, an arrow defined in its constructor. */
  _onTilesetLoad?: (tileset3d: TilesetLike) => void;
}

/** A deck layer, as far as the rebuild cares. */
function isDeckLayer(value: unknown): value is { props: Record<string, unknown>; constructor: Function } {
  return Boolean(value) && typeof value === 'object' && 'props' in (value as object);
}

/**
 * Wraps kepler's 3D tile layer class so its tileset can be moved in z.
 *
 * The deck layer is rebuilt from the props kepler assembled rather than
 * assembled again here, so the id, the loader, the access token, the tile
 * callbacks and whatever upstream adds later all keep working without this
 * module knowing about them — the same bargain `withWmsTime` strikes.
 *
 * Two more things ride on the same rebuild, because real tilesets needed them
 * and this is where kepler's layer is in reach:
 *
 * - the loader is swapped for its mended self (`tile3dLoader.ts`), without
 *   which Cesium OSM Buildings and Google's 3D Tiles through ion drew nothing;
 * - a tileset that spans too wide (`spansTooWide`) does not frame the map:
 *   kepler framed a map of one city out to the whole planet for OSM Buildings.
 *   kepler already skips Google's for the same reason.
 */
export function withTile3dAltitude<C extends Constructor<object>>(Tile3DLayer: C): C {
  class Tile3DLayerWithAltitude extends (Tile3DLayer as Constructor<Tile3DLayerLike>) {
    constructor(...args: any[]) {
      super(...args);
      this.registerVisConfig(TILE3D_ALTITUDE_VIS_CONFIGS as unknown as Record<string, unknown>);
      const keplerOnTilesetLoad = this._onTilesetLoad;
      if (typeof keplerOnTilesetLoad === 'function') {
        this._onTilesetLoad = (tileset3d: TilesetLike) => {
          if (spansTooWide(tileset3d)) {
            this._hasFittedBounds = true;
          }
          keplerOnTilesetLoad(tileset3d);
        };
      }
    }

    renderLayer(opts?: unknown): unknown[] {
      const layers = super.renderLayer(opts) ?? [];
      const visConfig = this.config?.visConfig ?? {};
      // Read once, outside the loop: `groundTileset` defaults to on, so only an
      // explicit `false` turns it off — an unset knob must not sink the layer.
      const knobs = {
        groundTileset: visConfig.groundTileset !== false,
        altitudeOffset: typeof visConfig.altitudeOffset === 'number' ? visConfig.altitudeOffset : 0,
      };

      return layers.map((layer) => {
        if (!isDeckLayer(layer)) {
          return layer;
        }
        const Aware = altitudeAware(layer.constructor as Constructor<DeckTile3DLayerLike>);
        const mended = 'loader' in layer.props ? { loader: sturdyLoader(layer.props.loader) } : {};
        return new Aware({ ...layer.props, ...knobs, ...mended });
      });
    }
  }

  return Tile3DLayerWithAltitude as unknown as C;
}
