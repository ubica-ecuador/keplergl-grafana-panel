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

import { altitudeOffsetFor, applyAltitude, type TilesetLike } from './tile3dAltitude';

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

/** What the deck subclass needs of the class it extends. */
interface DeckTile3DLayerLike {
  props: Record<string, unknown>;
  state?: {
    tileset3d?: TilesetLike | null;
    activeViewports?: Record<string, unknown>;
    lastUpdatedViewports?: Record<string, unknown> | null;
  } | null;
  updateState(params: unknown): void;
  _updateTileset?(viewports: Record<string, unknown> | null | undefined): void;
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
      if (!applyAltitude(tileset, altitudeOffsetFor(this.props, tileset))) {
        return false;
      }

      // deck empties `activeViewports` as soon as it has traversed with them,
      // so by the time a knob moves the only record of where the camera is
      // looking is the previous pass's. `_updateTileset` ignores an empty set.
      const active = this.state?.activeViewports;
      const viewports = active && Object.keys(active).length > 0 ? active : this.state?.lastUpdatedViewports;
      this._updateTileset?.(viewports);
      return true;
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
 */
export function withTile3dAltitude<C extends Constructor<object>>(Tile3DLayer: C): C {
  class Tile3DLayerWithAltitude extends (Tile3DLayer as Constructor<Tile3DLayerLike>) {
    constructor(...args: any[]) {
      super(...args);
      this.registerVisConfig(TILE3D_ALTITUDE_VIS_CONFIGS as unknown as Record<string, unknown>);
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
        return new Aware({ ...layer.props, ...knobs });
      });
    }
  }

  return Tile3DLayerWithAltitude as unknown as C;
}
