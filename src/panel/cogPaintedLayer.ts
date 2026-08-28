import { cogTileTemplate } from '../data/cogTileUrl';

/**
 * The kepler layer that draws a COG the *tile server* has already coloured.
 *
 * The sibling of `zarrTileLayer.ts`, and it exists because kepler's own raster
 * layer cannot draw a classified image. That layer asks TiTiler for `.npy` and
 * colours the pixels in a shader, which suits imagery — a three-band scene
 * wants its stretch chosen in the browser — but a land-cover raster has nine
 * classes and one correct palette, usually carried inside the file. Measured on
 * a real one: the shader rescales values 1-11 over the full `uint8` range and
 * every class lands on the same colour, so the map draws one flat slab.
 *
 * Asking for `.png` hands the drawing back to the server, which reads the
 * file's own palette and honours it, and leaves this module with one job:
 * deciding which url to ask for.
 *
 * Pure on purpose — no kepler, no deck, no network. It receives the base class
 * and the deck layer factory as arguments so it can be exercised with stubs,
 * the way `zarrTileLayer.ts` is; `cogPaintedDeckLayer.ts` supplies the real ones.
 */

/** Where the image lives and which server should paint it. */
export interface CogPaintedMetadata {
  /** Base url of a TiTiler that mounts the `/cog` router. */
  serverUrl: string;
  /** The COG the dataset opened on, signature and all. */
  sourceUrl: string;
}

/** Builds the deck layer — see `cogPaintedDeckLayer.ts`. */
export type CogPaintedDeckLayerFactory = (props: Record<string, unknown>) => unknown;

// Contravariant constructor parameters, so `any[]` rather than `unknown[]`; the
// same reason `zarrTileLayer.ts` gives.
type Constructor<T> = new (...args: any[]) => T;

/** The members of kepler's base layer this subclass touches. */
interface CogPaintedLayerLike {
  id: string;
  config: { visConfig?: { opacity?: number; cogScene?: unknown } };
}

/** What kepler's `formatLayerData` hands back to `renderLayer`. */
interface CogPaintedLayerData {
  metadata?: CogPaintedMetadata;
}

/** The dataset type the panel mints for a COG it wants the server to paint. */
export const COG_PAINTED_TYPE = 'cogPainted';

/**
 * The props for deck's `TileLayer`, or null when there is nothing to ask for.
 *
 * The template is repeated in `updateTriggers.getTileData` deliberately, and
 * that repetition is the point. deck caches tiles against the triggers it was
 * told to watch, so a layer whose url changed but whose triggers did not keeps
 * painting what it fetched first — the failure this repo already met with
 * PMTiles, where the tell was requests that were headers and directory reads
 * but never tiles. Every year of the series would then draw the same picture,
 * silently.
 */
export function cogPaintedDeckProps(args: {
  id: string;
  metadata?: CogPaintedMetadata;
  /** The scene the timeline chose, when it has chosen one. */
  scene?: string | null;
  opacity?: number;
}): Record<string, unknown> | null {
  const { id, metadata, scene, opacity } = args;
  if (!metadata) {
    return null;
  }

  const template = cogTileTemplate({
    serverUrl: metadata.serverUrl,
    sourceUrl: scene || metadata.sourceUrl,
  });
  if (!template) {
    return null;
  }

  return {
    id: `${id}-cog-tiles`,
    data: template,
    opacity: opacity ?? 1,
    updateTriggers: { getTileData: template },
  };
}

/**
 * Wraps kepler's base layer class into one that draws a server-painted COG.
 *
 * Extends the base layer rather than `AbstractTileLayer` because deck's own
 * `TileLayer` does the tiling here: what kepler's tile base adds is a
 * `TileDataset` of rows to hover and click, and a rendered PNG has none.
 */
export function makeCogPaintedLayer<C extends Constructor<object>>(
  BaseLayer: C,
  buildDeckLayer: CogPaintedDeckLayerFactory
): C {
  class CogPaintedLayer extends (BaseLayer as Constructor<CogPaintedLayerLike>) {
    get type(): string {
      return COG_PAINTED_TYPE;
    }

    get name(): string {
      return 'Raster (painted)';
    }

    get requiredLayerColumns(): string[] {
      return [];
    }

    get supportedDatasetTypes(): string[] {
      return [COG_PAINTED_TYPE];
    }

    /** A painted COG has no rows, and asking for them would hide the layer. */
    get requireData(): boolean {
      return false;
    }

    /**
     * Claims the datasets the panel minted for a painted COG, and no others.
     *
     * kepler walks every registered class asking this question when a dataset
     * arrives, so answering for someone else's dataset would draw a second,
     * broken layer over a perfectly good one.
     */
    static findDefaultLayerProps(dataset: { type?: string; id?: string; label?: string }): {
      props: Array<Record<string, unknown>>;
    } {
      if (dataset?.type !== COG_PAINTED_TYPE) {
        return { props: [] };
      }
      return { props: [{ dataId: dataset.id, label: dataset.label ?? 'Raster', isVisible: true }] };
    }

    /**
     * Renderable on visibility alone, not on having rows.
     *
     * The base class decides with `hasLayerData`, which asks for `data.length`.
     * A tileset has no rows at all, so the honest answer is "none" and kepler
     * then never calls `renderLayer` — the map stays empty and nothing is
     * logged. `RasterTileLayer` overrides this for exactly the same reason.
     */
    shouldRenderLayer(): boolean {
      return Boolean(this.type && (this.config as { isVisible?: boolean }).isVisible);
    }

    /** The metadata travels whole; there is no row to reshape. */
    formatLayerData(
      datasets: Record<string, { metadata?: CogPaintedMetadata }>,
      ...rest: unknown[]
    ): CogPaintedLayerData {
      void rest;
      const dataId = (this.config as { dataId?: string }).dataId;
      const dataset = dataId ? datasets?.[dataId] : undefined;
      return { metadata: dataset?.metadata };
    }

    renderLayer(opts?: { data?: CogPaintedLayerData }): unknown[] {
      const visConfig = this.config?.visConfig;
      const chosen = visConfig?.cogScene;
      const props = cogPaintedDeckProps({
        id: this.id,
        metadata: opts?.data?.metadata,
        scene: typeof chosen === 'string' && chosen ? chosen : null,
        opacity: visConfig?.opacity,
      });

      return props ? [buildDeckLayer(props)] : [];
    }
  }

  return CogPaintedLayer as unknown as C;
}
