import { markerBounds, readMarkers } from './markers';
import { shownInPane } from './paneVisibility';
import { resolveSymbol, symbolNames } from './symbolGlyphs';

/**
 * The kepler layer that holds draggable reference markers — an isochrone's
 * origin and destination, a point to measure from — each publishing its
 * position to a pair of dashboard variables. `markers.ts` has the rules.
 *
 * Pure, like the other layers this plugin adds: the base class and the deck
 * layer factory arrive as arguments. `markersDeckLayer.ts` supplies the real
 * deck layer, which is where the dragging happens.
 *
 * It draws nothing from its dataset. kepler attaches every layer to one, so the
 * user adds this one to any dataset on the map and switches its type; the rows
 * are ignored, and the markers live in `visConfig`, which is saved with the map.
 */

export const MARKERS_TYPE = 'markers';

export const MARKERS_VIS_CONFIGS = {
  // A list, which kepler copies whole when restoring a saved config: it only
  // descends into plain objects.
  markers: {
    type: 'markers',
    defaultValue: [],
    label: 'markers.markers',
    group: 'display',
    property: 'markers',
  },
  // The symbol layer's catalogue, so a marker can be any glyph that layer can
  // draw. `circle` is drawn as a filled dot with a white ring rather than from
  // the atlas: it reads on any basemap and is the easiest target to grab.
  symbol: {
    type: 'select',
    defaultValue: 'circle',
    // A getter, like the symbol layer's: building the catalogue is not free,
    // and this object is built on import, by every panel.
    get options() {
      return symbolNames();
    },
    label: 'markers.symbol',
    group: 'display',
    property: 'symbol',
  },
  // Clockwise degrees, as a compass reads. Only an icon turns; the circle has
  // nothing to turn.
  angleDegrees: {
    type: 'number',
    defaultValue: 0,
    label: 'markers.angleDegrees',
    isRanged: false,
    range: [0, 360],
    step: 1,
    group: 'display',
    property: 'angleDegrees',
  },
  markerRadius: {
    type: 'number',
    defaultValue: 10,
    label: 'markers.markerRadius',
    isRanged: false,
    range: [4, 30],
    step: 1,
    group: 'display',
    property: 'markerRadius',
  },
};

type Constructor<T> = new (...args: any[]) => T;

interface MarkersLayerLike {
  id: string;
  readonly layerIcon?: unknown;
  config: { isVisible?: boolean; visConfig?: Record<string, unknown> };
  registerVisConfig(configs: Record<string, unknown>): void;
  updateMeta(meta: Record<string, unknown>): unknown;
}

export function makeMarkersLayer<C extends Constructor<object>>(
  BaseLayer: C,
  buildDeckLayer: (props: Record<string, unknown>) => unknown,
  icon?: unknown
): C {
  class MarkersLayer extends (BaseLayer as Constructor<MarkersLayerLike>) {
    constructor(props?: Record<string, unknown>) {
      super(props);
      this.registerVisConfig(MARKERS_VIS_CONFIGS as unknown as Record<string, unknown>);
    }

    get type(): string {
      return MARKERS_TYPE;
    }

    get name(): string {
      return 'Markers';
    }

    get layerIcon(): unknown {
      return icon ?? super.layerIcon;
    }

    get requiredLayerColumns(): string[] {
      return [];
    }

    /** The rows are not what is drawn, and needing them would hide the layer. */
    get requireData(): boolean {
      return false;
    }

    /** Never proposed for a dataset: markers are something a user adds on purpose. */
    static findDefaultLayerProps(): { props: Array<Record<string, unknown>> } {
      return { props: [] };
    }

    /** Renderable on visibility alone — the base class asks for rows. */
    shouldRenderLayer(): boolean {
      return Boolean(this.type && this.config.isVisible);
    }

    /** A marker is not a row: nothing to show in kepler's tooltip. */
    getHoverData(): null {
      return null;
    }

    formatLayerData(): Record<string, unknown> {
      // Published so kepler's "zoom to layer" and the viewport guard frame the
      // markers rather than falling back to kepler's default view.
      const bounds = markerBounds(readMarkers(this.config.visConfig));
      if (bounds) {
        this.updateMeta({ bounds });
      }
      return {};
    }

    renderLayer(opts?: { visible?: boolean }): unknown[] {
      const visConfig = this.config.visConfig ?? {};
      const markers = readMarkers(visConfig);
      if (markers.length === 0) {
        return [];
      }
      const radius = Number(visConfig.markerRadius);
      const angle = Number(visConfig.angleDegrees);
      return [
        buildDeckLayer({
          id: `${this.id}-markers`,
          keplerLayerId: this.id,
          markers,
          radiusPx: Number.isFinite(radius) && radius > 0 ? radius : 10,
          symbol:
            visConfig.symbol === 'circle' || visConfig.symbol === undefined
              ? 'circle'
              : resolveSymbol(visConfig.symbol),
          angleDegrees: Number.isFinite(angle) ? angle : 0,
          visible: this.config.isVisible !== false && shownInPane(opts),
        }),
      ];
    }
  }

  return MarkersLayer as unknown as C;
}
