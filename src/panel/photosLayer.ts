/**
 * The kepler layer that draws a picture at each point: Geomap's Photos layer.
 *
 * Built on kepler's own point layer, so the rows, the coordinate columns,
 * filters, the tooltip and clicks are all the point layer's; only the drawing
 * differs. Each row's picture is read from a column of image addresses
 * (`visConfig.photoField`) and handed to deck's IconLayer, which fetches and
 * packs them itself. A frame in the layer's colour sits behind each picture,
 * square or round. Pure, like the other layers here: the base class and the
 * deck factory come in as arguments (`photosDeckLayer.ts`).
 */

export const PHOTOS_TYPE = 'photos';

export type PhotoKind = 'square' | 'circle';

export interface PhotosVisConfig {
  photoField?: string;
  /** The picture's side, in pixels. */
  photoSize?: number;
  photoKind?: PhotoKind;
  /** The frame's width around the picture, in pixels. */
  photoBorder?: number;
  opacity?: number;
}

/** The picture settings, registered so a saved map keeps them. */
export const PHOTOS_VIS_CONFIGS = {
  photoField: {
    type: 'select',
    defaultValue: '',
    label: 'photos.photoField',
    property: 'photoField',
    group: 'display',
    options: [],
  },
  photoSize: {
    type: 'number',
    defaultValue: 40,
    label: 'photos.photoSize',
    property: 'photoSize',
    group: 'display',
    range: [8, 200],
    step: 1,
    isRanged: false,
  },
  photoKind: {
    type: 'select',
    defaultValue: 'square',
    label: 'photos.photoKind',
    property: 'photoKind',
    group: 'display',
    options: ['square', 'circle'],
  },
  photoBorder: {
    type: 'number',
    defaultValue: 2,
    label: 'photos.photoBorder',
    property: 'photoBorder',
    group: 'display',
    range: [0, 20],
    step: 1,
    isRanged: false,
  },
};

export type PhotosDeckLayersFactory = (args: {
  shared: Record<string, unknown>;
  getPhoto: (d: { index: number }) => string | null;
  size: number;
  kind: PhotoKind;
  border: number;
  borderColor: number[];
}) => unknown[];

type Constructor<T> = new (...args: any[]) => T;

interface PointLayerLike {
  config: {
    dataId: string | null;
    color: number[];
    columns: unknown;
    visConfig: PhotosVisConfig & Record<string, unknown>;
  };
  getDefaultDeckLayerProps(opts: unknown): Record<string, unknown>;
  formatLayerData(datasets: Record<string, unknown>, oldLayerData?: unknown): Record<string, unknown>;
}

interface PhotoDataset {
  fields?: Array<{ name: string }>;
  dataContainer?: { valueAt(row: number, column: number): unknown };
}

/** The address of each row's picture, or null where the column is missing or empty. */
export function photoAccessor(dataset: PhotoDataset | undefined, field: string | undefined) {
  const column = field ? (dataset?.fields?.findIndex((f) => f.name === field) ?? -1) : -1;
  return (d: { index: number }): string | null => {
    if (column < 0 || !dataset?.dataContainer) {
      return null;
    }
    const value = dataset.dataContainer.valueAt(d.index, column);
    return typeof value === 'string' && value.trim() ? value : null;
  };
}

export function makePhotosLayer<C extends Constructor<object>>(
  PointLayer: C,
  buildDeckLayers: PhotosDeckLayersFactory
): C {
  class PhotosLayer extends (PointLayer as Constructor<PointLayerLike>) {
    constructor(...args: any[]) {
      super(...args);
      // kepler copies a saved layer's visConfig onto the keys the layer
      // registered and drops the rest, so the picture settings have to be
      // registered or a saved map loses them and draws empty square frames.
      (this as unknown as { registerVisConfig(configs: Record<string, unknown>): void }).registerVisConfig(
        PHOTOS_VIS_CONFIGS
      );
    }

    get type(): string {
      return PHOTOS_TYPE;
    }

    get name(): string {
      return 'Photos';
    }

    /**
     * Claims no dataset by itself: the point layer it extends would claim every
     * table with coordinates, and draw a second, pictureless layer on each.
     */
    static findDefaultLayerProps(): { props: Array<Record<string, unknown>> } {
      return { props: [] };
    }

    formatLayerData(datasets: Record<string, PhotoDataset>, oldLayerData?: unknown): Record<string, unknown> {
      const formatted = super.formatLayerData(datasets, oldLayerData);
      const dataId = this.config.dataId;
      return {
        ...formatted,
        getPhoto: photoAccessor(dataId ? datasets[dataId] : undefined, this.config.visConfig.photoField),
      };
    }

    renderLayer(opts: {
      data: Record<string, unknown> & { data?: unknown; getPosition?: unknown; getFilterValue?: unknown };
      gpuFilter?: { filterValueUpdateTriggers?: unknown };
    }): unknown[] {
      const { data, gpuFilter } = opts;
      const visConfig = this.config.visConfig;
      const defaults = this.getDefaultDeckLayerProps(opts);
      const shared = {
        ...defaults,
        data: data.data,
        getPosition: data.getPosition,
        getFilterValue: data.getFilterValue,
        opacity: visConfig.opacity ?? 1,
        pickable: true,
        autoHighlight: false,
        updateTriggers: {
          getPosition: this.config.columns,
          getFilterValue: gpuFilter?.filterValueUpdateTriggers,
          getIcon: visConfig.photoField,
        },
      };
      return buildDeckLayers({
        shared,
        getPhoto: (data.getPhoto as (d: { index: number }) => string | null) ?? (() => null),
        size: visConfig.photoSize ?? 40,
        kind: visConfig.photoKind === 'circle' ? 'circle' : 'square',
        border: visConfig.photoBorder ?? 2,
        borderColor: this.config.color,
      });
    }
  }

  return PhotosLayer as unknown as C;
}
