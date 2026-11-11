import { createContext } from 'react';

import type { TableView } from './askMapTools';
import { heightsFor, paletteRange, reversedPalette } from './keplerLayers';

/**
 * Visualization recipes: what a dataset's shape asks for, and the layers that
 * show it. `profileTable` reads the shape from the rows (how many places, how
 * many readings per place, whether things move), not from column names alone;
 * each recipe scores that profile and builds kepler layers in the saved (v1)
 * format. The free panel ships its own recipes and names Plus's, which Plus
 * replaces with real ones through {@link AskMapComposition}.
 */

export interface DatasetProfile {
  dataset: string;
  label: string;
  rows: number;
  lat?: string;
  lng?: string;
  time?: string;
  /** Distinct coordinate pairs (to 5 decimals, ~1 m). */
  places: number;
  rowsPerPlace: number;
  /** A column naming the thing each row is about (sensor, vehicle), when one fits. */
  idField?: string;
  /** Average distinct positions per id: ~1 for fixed sensors, many for moving assets. */
  positionsPerId?: number;
  /** The numeric column worth showing, best guess first. */
  valueFields: string[];
  /** Text columns with 2–12 values. */
  categoryFields: string[];
  od?: { lat0: string; lng0: string; lat1: string; lng1: string };
  /** Bounding box diagonal in km. */
  extentKm: number;
  shapes: DataShape[];
}

export type DataShape = 'sensor-series' | 'moving-assets' | 'od-pairs' | 'dense-events' | 'points' | 'categories';

export interface RecipeOptions {
  /** The numeric column to show; the profile's best guess when left out. */
  valueField?: string;
  /** A category column, for recipes that colour by one. */
  categoryField?: string;
}

/** One layer a recipe adds, with an optional fade-on-zoom envelope. */
export interface RecipeLayer {
  config: Record<string, unknown>;
  fade?: { appear: number; full: number; fade: number; gone: number };
  /** In words, for the answer: what sets colour, size, height. */
  encoding: string;
}

export interface Recipe {
  id: string;
  title: string;
  product: 'free' | 'plus';
  /** 0 = does not fit; higher fits better. */
  score(profile: DatasetProfile): number;
  why(profile: DatasetProfile): string;
  /** Absent on a recipe this panel can only name (a Plus recipe seen from the free panel). */
  build?(profile: DatasetProfile, options: RecipeOptions): { layers: RecipeLayer[]; pitch?: number } | { error: string };
}

/** What a host (Plus) composes onto "Ask the map": its own recipes, replacing those with the same id. */
export interface AskMapCompositionValue {
  recipes?: Recipe[];
}
export const AskMapComposition = createContext<AskMapCompositionValue>({});

// ---------------------------------------------------------------- profiling

const LAT = /^(lat|latitude|y|.*_lat|.*_latitude)$/i;
const LNG = /^(lon|lng|long|longitude|x|.*_lon|.*_lng|.*_longitude)$/i;
const ID_NAMES = /(^|_)(id|name|station|sensor|site|device|vehicle|asset|imei|mmsi|icao24|callsign|unit|code)s?$/i;
/** What a column is most likely worth showing, first first: "mag" before "depth" for earthquakes. */
const VALUE_PRIORITY = [/value/i, /temp/i, /pm\d|aqi|no2|o3/i, /^mag|magnitude/i, /level/i, /speed/i, /count|total/i, /flow|rain|precip/i, /load|power|kw/i, /price/i, /pressure|humid/i, /depth/i];
const valueRank = (name: string) => {
  const i = VALUE_PRIORITY.findIndex((re) => re.test(name));
  return i < 0 ? VALUE_PRIORITY.length : i;
};

const isNumeric = (type: string) => type === 'real' || type === 'integer';
const isTime = (type: string) => type === 'timestamp' || type === 'date';

export function profileTable(table: TableView): DatasetProfile {
  const names = table.fields.map((f) => f.name);
  const col = (name: string) => names.indexOf(name);
  const pair = table.points[0] ?? guessPair(names);
  const od = guessOd(names);
  const time = table.fields.find((f) => isTime(f.type))?.name;
  const n = table.numRows;
  const step = Math.max(1, Math.floor(n / 20000)); // profile at most ~20k rows

  let places = 0;
  let extentKm = 0;
  const placeOfRow = new Map<number, string>();
  if (pair) {
    const [la, lo] = [col(pair[0]), col(pair[1])];
    const seen = new Set<string>();
    let [w, s, e, no] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let r = 0; r < n; r += step) {
      const y = Number(table.valueAt(r, la));
      const x = Number(table.valueAt(r, lo));
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      const key = `${x.toFixed(5)},${y.toFixed(5)}`;
      seen.add(key);
      placeOfRow.set(r, key);
      [w, s, e, no] = [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(no, y)];
    }
    places = seen.size;
    if (Number.isFinite(w)) {
      const dx = (e - w) * 111.32 * Math.cos((((s + no) / 2) * Math.PI) / 180);
      extentKm = Math.max(1, Math.hypot(dx, (no - s) * 110.57));
    }
  }
  const sampled = Math.ceil(n / step);
  const rowsPerPlace = places ? sampled / places : 0;

  // An id column: repeats, and (for a sensor) keeps one place, or (for an asset) moves.
  let idField: string | undefined;
  let positionsPerId: number | undefined;
  const candidates = table.fields
    .filter((f) => !isTime(f.type) && f.name !== pair?.[0] && f.name !== pair?.[1] && (f.type === 'string' || f.type === 'integer'))
    .sort((a, b) => Number(ID_NAMES.test(b.name)) - Number(ID_NAMES.test(a.name)));
  for (const f of candidates) {
    const c = col(f.name);
    const positions = new Map<string, Set<string>>();
    for (let r = 0; r < n; r += step) {
      const v = table.valueAt(r, c);
      if (v === null || v === undefined || v === '') {
        continue;
      }
      const set = positions.get(String(v)) ?? new Set<string>();
      const place = placeOfRow.get(r);
      if (place) {
        set.add(place);
      }
      positions.set(String(v), set);
    }
    const ids = positions.size;
    const perId = ids ? [...positions.values()].reduce((sum, set) => sum + set.size, 0) / ids : 0;
    // Named like an id, or each value staying at one place (a sensor's name): not a category
    // such as "type", whose two values cover hundreds of places each.
    if (ids >= 2 && ids <= Math.max(2, sampled / 2) && (ID_NAMES.test(f.name) || perId <= 1.5)) {
      idField = f.name;
      positionsPerId = perId;
      break;
    }
  }

  const coordinateNames = new Set([pair?.[0], pair?.[1], od?.lat0, od?.lng0, od?.lat1, od?.lng1].filter(Boolean) as string[]);
  const valueFields = table.fields
    .filter((f) => isNumeric(f.type) && !coordinateNames.has(f.name) && f.name !== idField)
    .map((f) => f.name)
    .sort((a, b) => valueRank(a) - valueRank(b));
  const categoryFields = table.fields
    .filter((f) => f.type === 'string' && f.name !== idField)
    .filter((f) => {
      const c = col(f.name);
      const values = new Set<string>();
      for (let r = 0; r < n && values.size <= 12; r += step) {
        values.add(String(table.valueAt(r, c)));
      }
      return values.size >= 2 && values.size <= 12;
    })
    .map((f) => f.name);

  const shapes: DataShape[] = [];
  if (od) {
    shapes.push('od-pairs');
  }
  if (pair && time && idField && positionsPerId !== undefined && positionsPerId > 3) {
    shapes.push('moving-assets');
  } else if (pair && time && places >= 2 && rowsPerPlace >= 3) {
    shapes.push('sensor-series');
  }
  if (pair && sampled >= 300 && rowsPerPlace < 1.5) {
    shapes.push('dense-events');
  }
  if (pair) {
    shapes.push('points');
  }
  if (pair && categoryFields.length) {
    shapes.push('categories');
  }

  return {
    dataset: table.id,
    label: table.label,
    rows: n,
    lat: pair?.[0],
    lng: pair?.[1],
    time,
    places,
    rowsPerPlace: Number(rowsPerPlace.toFixed(1)),
    idField,
    positionsPerId: positionsPerId !== undefined ? Number(positionsPerId.toFixed(1)) : undefined,
    valueFields,
    categoryFields,
    od,
    extentKm: Math.round(extentKm),
    shapes,
  };
}

function guessPair(names: string[]): [string, string] | null {
  const lat = names.find((n) => LAT.test(n) && !/(^|_)(o|d|origin|dest|from|to|src|dst|start|end|pickup|dropoff)_/i.test(n));
  const lng = names.find((n) => LNG.test(n) && !/(^|_)(o|d|origin|dest|from|to|src|dst|start|end|pickup|dropoff)_/i.test(n));
  return lat && lng ? [lat, lng] : null;
}

function guessOd(names: string[]): DatasetProfile['od'] {
  // Anchored at both ends, so "origin_lat" is not read as "o" + "rigin_lat".
  const find = (ends: string, axis: string) => names.find((n) => new RegExp(`^(?:${ends})_?(?:${axis})$`, 'i').test(n));
  const O = 'o|origin|from|src|start|pickup';
  const D = 'd|dest|destination|to|dst|end|dropoff';
  const LAT_AXIS = 'lat|latitude';
  const LNG_AXIS = 'lon|lng|long|longitude';
  const lat0 = find(O, LAT_AXIS) ?? names.find((n) => /^lat0$/i.test(n));
  const lng0 = find(O, LNG_AXIS) ?? names.find((n) => /^(lng|lon)0$/i.test(n));
  const lat1 = find(D, LAT_AXIS) ?? names.find((n) => /^lat1$/i.test(n));
  const lng1 = find(D, LNG_AXIS) ?? names.find((n) => /^(lng|lon)1$/i.test(n));
  return lat0 && lng0 && lat1 && lng1 ? { lat0, lng0, lat1, lng1 } : undefined;
}

// ---------------------------------------------------------------- recipes

const field = (name: string, type = 'real') => ({ name, type });

function pointLayer(
  p: DatasetProfile,
  id: string,
  label: string,
  extra: { color?: { name: string; type: string }; size?: string; radius?: number; palette?: string; reversed?: boolean; scale?: string }
) {
  const visualChannels: Record<string, unknown> = {};
  if (extra.color) {
    visualChannels.colorField = extra.color;
    visualChannels.colorScale = extra.scale ?? (extra.color.type === 'string' ? 'ordinal' : 'quantize');
  }
  if (extra.size) {
    visualChannels.sizeField = field(extra.size);
    visualChannels.sizeScale = 'sqrt';
  }
  return {
    id,
    type: 'point',
    config: {
      dataId: p.dataset,
      label,
      columnMode: 'points',
      columns: { lat: p.lat, lng: p.lng },
      isVisible: true,
      visConfig: {
        radius: extra.radius ?? 6,
        opacity: 0.85,
        filled: true,
        ...(extra.palette ? { colorRange: extra.reversed ? reversedPalette(extra.palette) : paletteRange(extra.palette) } : {}),
      },
    },
    visualChannels,
  };
}

const valueOf = (p: DatasetProfile, o: RecipeOptions) => o.valueField ?? p.valueFields[0];

/** Recipes the free panel draws itself. */
export const FREE_RECIPES: Recipe[] = [
  {
    id: 'dense-events',
    title: '3D hexagons far, points near',
    product: 'free',
    score: (p) => (p.shapes.includes('dense-events') ? 0.8 : 0),
    why: (p) => `${p.rows} separate events: cells summarise them zoomed out, single points take over zoomed in.`,
    build: (p, o) => {
      const value = valueOf(p, o);
      const cell = Number(Math.max(0.2, Math.min(500, p.extentKm / 60)).toPrecision(2));
      // Hand-over zoom: where a cell (worldUnitSize km) shrinks to ~20 px.
      const handover = Math.max(3, Math.min(16, Math.round(Math.log2((40075 / cell) * (20 / 256)) + 1)));
      const hex = {
        id: 'recipe-hexagons',
        type: 'hexagon',
        config: {
          dataId: p.dataset,
          label: `${p.label} – cells`,
          columnMode: 'points',
          columns: { lat: p.lat, lng: p.lng },
          isVisible: true,
          visConfig: {
            opacity: 0.85,
            worldUnitSize: cell,
            coverage: 0.9,
            enable3d: true,
            elevationScale: heightsFor(p.extentKm).elevationScale,
            colorRange: paletteRange('Global Warming'),
            ...(value ? { colorAggregation: 'average', sizeAggregation: 'count' } : {}),
          },
        },
        visualChannels: value ? { colorField: field(value), colorScale: 'quantile' } : {},
      };
      const points = pointLayer(p, 'recipe-points', `${p.label} – points`, {
        color: value ? field(value) : undefined,
        palette: 'Global Warming',
      });
      return {
        pitch: 40,
        layers: [
          {
            config: hex,
            fade: { appear: 0, full: 0, fade: handover - 1, gone: handover },
            encoding: `hexagons of ${cell} km: colour ${value ? `average ${value}` : 'row count'}, height row count; fade out at zoom ${handover}`,
          },
          {
            config: points,
            fade: { appear: handover - 1, full: handover, fade: 24, gone: 24 },
            encoding: `points from zoom ${handover}: colour ${value ?? 'one colour'}`,
          },
        ],
      };
    },
  },
  {
    id: 'sensor-points',
    title: 'Sensors coloured by their reading',
    product: 'free',
    score: (p) => (p.shapes.includes('sensor-series') ? 0.6 : 0),
    why: (p) => `${p.places} fixed places with ~${Math.round(p.rowsPerPlace)} readings each: colour by the reading and play the time filter to watch it change.`,
    build: (p, o) => {
      const value = valueOf(p, o);
      if (!value) {
        return { error: `${p.label} has no numeric column to colour by.` };
      }
      return {
        layers: [
          {
            config: pointLayer(p, 'recipe-sensors', `${p.label} – ${value}`, {
              color: field(value),
              radius: 10,
              palette: 'RdYlBu',
              reversed: true,
              scale: 'quantize',
            }),
            encoding: `one dot per reading at each sensor, colour ${value} (blue low, red high); the time filter picks which readings show`,
          },
        ],
      };
    },
  },
  {
    id: 'categories',
    title: 'Points by category',
    product: 'free',
    score: (p) => (p.shapes.includes('categories') && !p.shapes.includes('sensor-series') ? 0.4 : 0),
    why: (p) => `${p.categoryFields[0]} has a handful of values: one colour each.`,
    build: (p, o) => {
      const category = o.categoryField ?? p.categoryFields[0];
      if (!category) {
        return { error: `${p.label} has no category column.` };
      }
      return {
        layers: [
          {
            config: pointLayer(p, 'recipe-categories', `${p.label} – ${category}`, {
              color: field(category, 'string'),
              palette: 'Tableau10',
              size: valueOf(p, o),
            }),
            encoding: `colour ${category}${valueOf(p, o) ? `, radius ${valueOf(p, o)}` : ''}`,
          },
        ],
      };
    },
  },
  {
    id: 'od-arcs',
    title: 'Origin–destination arcs',
    product: 'free',
    score: (p) => (p.shapes.includes('od-pairs') ? 0.9 : 0),
    why: () => 'Each row joins two places: arcs show where things go.',
    build: (p, o) => {
      if (!p.od) {
        return { error: `${p.label} has no origin/destination columns.` };
      }
      const value = valueOf(p, o);
      return {
        pitch: 30,
        layers: [
          {
            config: {
              id: 'recipe-arcs',
              type: 'arc',
              config: {
                dataId: p.dataset,
                label: `${p.label} – flows`,
                columnMode: 'points',
                columns: { lat0: p.od.lat0, lng0: p.od.lng0, lat1: p.od.lat1, lng1: p.od.lng1 },
                isVisible: true,
                visConfig: { opacity: 0.8, thickness: 2, colorRange: paletteRange('Global Warming') },
              },
              visualChannels: value
                ? { colorField: field(value), colorScale: 'quantile', sizeField: field(value), sizeScale: 'linear' }
                : {},
            },
            encoding: `arcs from origin to destination${value ? `, colour and width ${value}` : ''}`,
          },
        ],
      };
    },
  },
];

/** Plus recipes the free panel can only name; Plus replaces them (same id) with buildable ones. */
export const PLUS_RECIPE_STUBS: Recipe[] = [
  {
    id: 'sensor-surface-sparklines',
    title: 'Interpolated surface + sparkline cards (Plus)',
    product: 'plus',
    score: (p) => (p.shapes.includes('sensor-series') && p.places >= 4 ? 0.9 : 0),
    why: (p) => `${p.places} sensors with series: a surface fills the space between them with the latest reading, and a card per sensor shows its series.`,
  },
  {
    id: 'sensor-gauges',
    title: 'Gauges per sensor (Plus)',
    product: 'plus',
    score: (p) => (p.shapes.includes('sensor-series') ? 0.5 : 0),
    why: () => 'A ring or level marker per sensor with its latest value, for levels and percentages.',
  },
  {
    id: 'fleet',
    title: 'Fleet: assets at their latest position with trails (Plus)',
    product: 'plus',
    score: (p) => (p.shapes.includes('moving-assets') ? 0.9 : 0),
    why: (p) => `${p.idField} moves (~${p.positionsPerId} positions each): each asset drawn where it is now, with its trail.`,
  },
];

/** The recipes on offer: the free ones, Plus's stubs, then whatever the host composed (same id wins). */
export function recipeCatalog(composed: Recipe[] = []): Recipe[] {
  const byId = new Map<string, Recipe>();
  for (const recipe of [...FREE_RECIPES, ...PLUS_RECIPE_STUBS, ...composed]) {
    byId.set(recipe.id, recipe);
  }
  return [...byId.values()];
}
