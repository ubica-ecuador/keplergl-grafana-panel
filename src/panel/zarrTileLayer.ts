import type { LayerIcon } from './cogPaintedLayer';
import { zarrTileTemplate } from '../data/zarrTileUrl';
import { shownInPane } from './paneVisibility';

/**
 * The kepler layer that draws a Zarr variable as tiles rendered by TiTiler.
 *
 * Pure on purpose — no kepler, no deck, no network. It receives the base class
 * and the deck layer factory as arguments so it can be exercised with stubs,
 * the way `wmsTimeLayer.ts` is; `zarrDeckLayer.ts` supplies the real ones.
 *
 * The division of labour is worth stating, because it is what makes this small:
 * TiTiler reads the store, decompresses the chunks, reprojects to Web Mercator
 * and applies the colour ramp, so what crosses the wire is an ordinary PNG. The
 * panel's whole job is deciding which url to ask for.
 */

/** Where a Zarr variable lives and how it should be painted. */
export interface ZarrTileMetadata {
  serverUrl: string;
  storeUrl: string;
  variable: string;
  /** `dimension=value` for every non-spatial axis except time. */
  selectors?: string[];
  /** Levels in the store's `multiscales` pyramid, or absent for a flat store. */
  levels?: number;
  /** The axis the clock walks, when the store does not call it `time`. */
  dimension?: string;
  colormap?: string;
  rescale?: string;
}

/** Builds the deck layer — see `zarrDeckLayer.ts`. */
export type ZarrDeckLayerFactory = (props: Record<string, unknown>) => unknown;

// Contravariant constructor parameters, so `any[]` rather than `unknown[]`; the
// same reason `wmsTimeLayer.ts` gives.
type Constructor<T> = new (...args: any[]) => T;

/** The members of kepler's base layer this subclass touches. */
interface ZarrLayerLike {
  id: string;
  /** kepler's placeholder, when the factory was handed no icon of its own. */
  readonly layerIcon?: unknown;
  config: { isVisible?: boolean; visConfig?: { opacity?: number; zarrLabel?: unknown } };
}

/** What kepler's `formatLayerData` hands back to `renderLayer`. */
interface ZarrLayerData {
  metadata?: ZarrTileMetadata;
}

/**
 * The props for deck's `TileLayer`, or null when there is nothing to ask for.
 *
 * `data` is the url template deck fills per tile; the moment rides inside it as
 * TiTiler's `sel`.
 *
 * It is repeated in `updateTriggers.getTileData` deliberately, and that
 * repetition is the point of this function. deck caches tiles against the
 * triggers it was told to watch, so a layer whose url changed but whose triggers
 * did not keeps painting what it fetched first — the failure this repo already
 * met with PMTiles, where the tell was requests that were headers and directory
 * reads but never tiles. Every date of the timeline then draws the same picture,
 * silently.
 */
export function zarrDeckProps(args: {
  id: string;
  metadata?: ZarrTileMetadata;
  label?: string | null;
  opacity?: number;
}): Record<string, unknown> | null {
  const { id, metadata, label, opacity } = args;
  if (!metadata) {
    return null;
  }

  const template = zarrTileTemplate({
    serverUrl: metadata.serverUrl,
    storeUrl: metadata.storeUrl,
    variable: metadata.variable,
    label: label ?? undefined,
    dimension: metadata.dimension,
    selectors: metadata.selectors,
    levels: metadata.levels,
    colormap: metadata.colormap,
    rescale: metadata.rescale,
  });
  if (!template) {
    return null;
  }

  return {
    id: `${id}-zarr-tiles`,
    data: template,
    opacity: opacity ?? 1,
    // Beyond the deepest level deck reuses the tiles it already holds. Left
    // unbounded on a pyramid, every zoom past it asks for a group the store
    // does not have and is answered 500, tile after tile. A store without a
    // pyramid is left unbounded on purpose: it answers at any zoom, slowly.
    ...(metadata.levels && metadata.levels > 0 ? { maxZoom: metadata.levels - 1 } : {}),
    updateTriggers: { getTileData: template },
  };
}

/**
 * Wraps kepler's base layer class into one that draws a Zarr variable.
 *
 * Extends the base layer rather than `AbstractTileLayer` because deck's own
 * `TileLayer` does the tiling here: what kepler's tile base adds is a
 * `TileDataset` of rows to hover and click, and a rendered PNG has none. This is
 * the shape `RasterTileLayer` upstream takes for the same reason.
 */
export function makeZarrLayer<C extends Constructor<object>>(
  BaseLayer: C,
  buildDeckLayer: ZarrDeckLayerFactory,
  icon?: LayerIcon
): C {
  class ZarrTileLayer extends (BaseLayer as Constructor<ZarrLayerLike>) {
    constructor(...args: any[]) {
      super(...args);
      // The layer already *applies* this — `zarrDeckProps` hands it to deck —
      // but kepler builds the panel from `visConfigSettings`, and a layer that
      // registers nothing gets an empty one. So without this line the opacity
      // is settable from a saved configuration and unreachable from the map:
      // the tiles arrive already coloured, which leaves how strongly the field
      // sits over the base map as the only thing a viewer can still decide.
      (this as unknown as { registerVisConfig(configs: Record<string, string>): void }).registerVisConfig({
        opacity: 'opacity',
      });
    }

    get layerIcon(): unknown {
      // Left to the base class when none was handed in, rather than reported as
      // undefined: kepler draws a placeholder for a layer with no icon, and an
      // undefined one would leave a blank where that should be.
      return icon ?? super.layerIcon;
    }

    get type(): string {
      return 'zarr';
    }

    get name(): string {
      return 'Zarr';
    }

    get requiredLayerColumns(): string[] {
      return [];
    }

    get supportedDatasetTypes(): string[] {
      return ['zarr'];
    }

    /** A Zarr dataset has no rows, and asking for them would hide the layer. */
    get requireData(): boolean {
      return false;
    }

    /**
     * Claims the datasets the panel minted for a Zarr variable, and no others.
     *
     * kepler walks every registered class asking this question when a dataset
     * arrives, so answering for someone else's dataset would draw a second,
     * broken layer over a perfectly good one.
     */
    static findDefaultLayerProps(dataset: { type?: string; id?: string; label?: string }): {
      props: Array<Record<string, unknown>>;
    } {
      if (dataset?.type !== 'zarr') {
        return { props: [] };
      }
      // A deterministic id, derived from the dataset. kepler mints a random
      // hash when none is given, and a random id cannot be written down —
      // which is what kept a saved configuration from naming this layer at
      // all, `splitMaps` included, so a dashboard could not open already
      // split.
      return {
        props: [{ id: `${dataset.id}-layer`, dataId: dataset.id, label: dataset.label ?? 'Zarr', isVisible: true }],
      };
    }

    /**
     * Renderable on visibility alone, not on having rows.
     *
     * The base class decides with `hasLayerData`, which asks for `data.length`.
     * A tileset has no rows at all, so the honest answer to that question is
     * "none" and kepler then never calls `renderLayer` — the map stays empty
     * and nothing is logged, which is a long way to walk before suspecting the
     * layer was never asked to draw. `RasterTileLayer` overrides this for
     * exactly the same reason.
     */
    shouldRenderLayer(): boolean {
      return Boolean(this.type && this.config.isVisible);
    }

    /** The metadata travels whole; there is no row to reshape. */
    formatLayerData(datasets: Record<string, { metadata?: ZarrTileMetadata }>, ...rest: unknown[]): ZarrLayerData {
      void rest;
      const dataId = (this.config as { dataId?: string }).dataId;
      const dataset = dataId ? datasets?.[dataId] : undefined;
      return { metadata: dataset?.metadata };
    }

    renderLayer(opts?: {
      data?: ZarrLayerData;
      /** The split map's verdict: shown in this pane, or the other one. */
      visible?: boolean;
    }): unknown[] {
      const visible = this.config.isVisible !== false && shownInPane(opts);
      const visConfig = this.config?.visConfig;
      const chosen = visConfig?.zarrLabel;
      const props = zarrDeckProps({
        id: this.id,
        metadata: opts?.data?.metadata,
        label: typeof chosen === 'string' && chosen ? chosen : null,
        opacity: visConfig?.opacity,
      });

      return props ? [buildDeckLayer({ ...props, visible })] : [];
    }
  }

  return ZarrTileLayer as unknown as C;
}
