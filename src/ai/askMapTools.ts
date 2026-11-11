/**
 * The tools "Ask the map" hands the model: questions answered from the rows the
 * map already holds, and the few things it may do to the map (filter, clear,
 * frame). Pure over a {@link TableView} and a {@link MapActions}, so they are
 * tested without kepler or a model.
 *
 * Nothing here runs code or SQL the model wrote: a query is a small JSON
 * description (conditions, a group, an aggregate) evaluated in this file, and
 * the only rows that leave the browser are the ones a tool returns, capped.
 */

import { bboxPolygon, circlePolygon, contains, polygonFrom, type AreaGeometry } from './areas';
import { AGGREGATIONS, LAYER_TYPES, SUGGESTED_PALETTES, paletteRange, type LayerSpec, type LayerStyle } from './keplerLayers';
import { profileTable, recipeCatalog, type Recipe } from './recipes';

export interface TableView {
  id: string;
  label: string;
  fields: Array<{ name: string; type: string }>;
  numRows: number;
  valueAt(row: number, col: number): unknown;
  /** [latitude, longitude] column pairs the map's layers draw this table with. */
  points: Array<[string, string]>;
}

export interface MapActions {
  filterRange(field: string, range: [number, number]): boolean;
  filterValues(field: string, values: string[]): boolean;
  clearFilter(field: string): void;
  /** Removes every filter on the map; returns the fields it cleared. */
  clearAllFilters(): string[];
  /** [west, south, east, north] */
  fitBounds(bounds: [number, number, number, number]): void;
  /** Adds a layer; `extentKm` is the data's bbox diagonal, for default cell sizes. */
  addLayer(spec: LayerSpec, extentKm: number): { id: string } | { error: string };
  /** Adds a layer from a saved-format config (a recipe's); its id gets a unique suffix. */
  addLayerConfig(config: Record<string, unknown>): { id: string } | { error: string };
  /** Ids of the visible layers that draw a dataset. */
  visibleLayersOf(dataId: string): string[];
  /** Changes a layer found by id or label. */
  updateLayer(ref: string, change: LayerChange): { id: string; type: string } | { error: string };
  /** Removes a layer this assistant added; others are refused (hide them instead). */
  removeLayer(ref: string): { id: string } | { error: string };
  setView(view: { pitch?: number; bearing?: number; zoom?: number; latitude?: number; longitude?: number }): void;
  /** Current pitch, to tilt the map when a layer goes 3D on a flat map. */
  pitch(): number;
  setBasemap(id: string): boolean;
  /** Animated camera move. */
  flyTo(view: { latitude: number; longitude: number; zoom?: number; pitch?: number; bearing?: number }, seconds: number): void;
  /** Fade a layer in and out with zoom (kepler's fade-on-zoom); null stops turns it off for that layer. */
  fadeByZoom(ref: string, stops: ZoomStops | null): { id: string } | { error: string };
  /** Filters every visible layer by the area, replacing earlier figures; false when no layer is visible. */
  filterArea(geometry: AreaGeometry): boolean;
  /** Removes every drawn figure and the area filters they make. */
  clearAreas(): number;
  /** Figures on the map, newest last (the viewer's drawings and earlier filter_area calls). */
  drawnAreas(): Array<{ id: string; geometry: { type: string; coordinates?: unknown } }>;
  /** Sets the dashboard time range: Grafana relative times (now-7d) or epoch milliseconds. */
  setTimeRange(from: string, to: string): void;
  /** Puts the map back as it was before the previous question that changed it; null when there is none. */
  undo(): UndoResult | null;
}

/** What an undo put back, so the answer can say it instead of guessing. */
export interface UndoResult {
  /** The dashboard time range restored, as Grafana writes it (now-30d, or epoch ms). */
  timeRange?: { from: string; to: string };
  /** Whether an area filter is back on. */
  areaFilter: boolean;
}

export interface ZoomStops {
  appear: number;
  full: number;
  fade: number;
  gone: number;
}

export interface LayerChange extends LayerStyle {
  visible?: boolean;
  label?: string;
}

export interface ToolContext {
  tables: TableView[];
  actions: MapActions;
  /** Recipes a host composed (Plus), on top of the free panel's own. */
  recipes?: Recipe[];
}

/** What a tool returns to the model, and the line the panel shows for it. */
export interface ToolOutcome {
  result: unknown;
  /** Set for tools that changed the map: shown to the viewer as a chip. */
  mapChange?: string;
}

type Op = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'in' | 'contains' | 'is_null' | 'not_null';
interface Condition {
  field: string;
  op: Op;
  value?: unknown;
}

const MAX_ROWS = 50;
const MAX_COLUMNS = 12;
const MAX_TEXT = 160;
const TIME_BUCKETS = { hour: 13, day: 10, month: 7, year: 4 } as const;

class ToolError extends Error {}

const DATASET_PARAM = {
  type: 'string',
  description: 'Dataset id or label. Optional when the map has one dataset.',
};

const WHERE_PARAM = {
  type: 'array',
  description:
    'Conditions, all of which a row must meet. Timestamps take ISO 8601 strings. "contains" is a case-insensitive substring match; "in" takes an array; "between" takes [min, max] inclusive.',
  items: {
    type: 'object',
    properties: {
      field: { type: 'string' },
      op: {
        type: 'string',
        enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'contains', 'is_null', 'not_null'],
      },
      value: { description: 'A number, a string, or an array for "in" and "between".' },
    },
    required: ['field', 'op'],
  },
};

const AREA_PARAM = {
  type: 'object',
  description:
    'An area: circle (latitude, longitude, radius_km), box (west, south, east, north), polygon (coordinates: [[lon, lat], …]) or drawn (the last figure drawn on the map, by the viewer or by filter_area). Use coordinates you know for named places.',
  properties: {
    shape: { type: 'string', enum: ['circle', 'box', 'polygon', 'drawn'] },
    latitude: { type: 'number' },
    longitude: { type: 'number' },
    radius_km: { type: 'number' },
    west: { type: 'number' },
    south: { type: 'number' },
    east: { type: 'number' },
    north: { type: 'number' },
    coordinates: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
  },
  required: ['shape'],
};

/** The tools, in the OpenAI function-calling shape `@grafana/llm` sends on. */
export const ASK_MAP_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'describe_field',
      description:
        "Summarise one column of a dataset on the map: count, nulls, min/max/mean/median for numbers and times, the most frequent values for text. Use it to learn a column's values before filtering on it.",
      parameters: {
        type: 'object',
        properties: { dataset: DATASET_PARAM, field: { type: 'string' } },
        required: ['field'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_rows',
      description:
        'Read the rows the map holds. Without group_by or aggregate it returns matching rows (sorted, limited). With aggregate it returns one value; with group_by (a column) or group_by_time (a time bucket) it returns one row per group, largest first. Every number you state must come from this or describe_field.',
      parameters: {
        type: 'object',
        properties: {
          dataset: DATASET_PARAM,
          where: WHERE_PARAM,
          area: { ...AREA_PARAM, description: `Only rows whose point lies in this area. ${AREA_PARAM.description}` },
          group_by: { type: 'string', description: 'Column to group on.' },
          group_by_time: {
            type: 'object',
            description: 'Group a timestamp column into buckets.',
            properties: {
              field: { type: 'string' },
              bucket: { type: 'string', enum: Object.keys(TIME_BUCKETS) },
              chronological: { type: 'boolean', description: 'Return buckets in time order instead of largest first.' },
            },
            required: ['field', 'bucket'],
          },
          aggregate: {
            type: 'object',
            description: 'count needs no field; sum/avg/min/max need a numeric field.',
            properties: {
              op: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] },
              field: { type: 'string' },
            },
            required: ['op'],
          },
          order_by: { type: 'string', description: 'Column to sort rows by (row mode only).' },
          descending: { type: 'boolean' },
          columns: { type: 'array', items: { type: 'string' }, description: 'Columns to return (row mode).' },
          limit: { type: 'integer', description: `At most ${MAX_ROWS}. Default 10 rows or 20 groups.` },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'filter_map',
      description:
        'Filter what the map draws on one column, replacing any filter already on it. Numbers and timestamps take min and/or max (timestamps as ISO 8601); text columns take values. Filters on different columns combine (AND).',
      parameters: {
        type: 'object',
        properties: {
          dataset: DATASET_PARAM,
          field: { type: 'string' },
          min: { description: 'Lower bound, inclusive.' },
          max: { description: 'Upper bound, inclusive.' },
          values: { type: 'array', items: { type: 'string' } },
        },
        required: ['field'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'clear_filters',
      description: 'Remove the filter on one column, or every filter on the map when no field is given.',
      parameters: { type: 'object', properties: { field: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_layer',
      description:
        'Draw a dataset with a new layer on top of the others. point: one dot per row; heatmap: density (three_d makes it a surface); hexagon/grid: rows binned into cells (three_d extrudes them, height from size_by or the count); cluster: dots merged by proximity. The map is tilted automatically for 3D.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...LAYER_TYPES] },
          dataset: DATASET_PARAM,
          label: { type: 'string', description: 'Name shown in the layer list and legend.' },
          color_by: { type: 'string', description: 'Column for colour (cells: aggregated with aggregation). A heatmap uses it as its weight.' },
          size_by: { type: 'string', description: 'Column for dot radius (point), cell height (hexagon/grid) or weight (heatmap).' },
          aggregation: { type: 'string', enum: [...AGGREGATIONS], description: 'How hexagon/grid/cluster combine color_by and size_by. Default average.' },
          three_d: { type: 'boolean' },
          radius: { type: 'number', description: 'Pixels for point/heatmap/cluster; kilometres for hexagon/grid cells (picked from the data extent when left out).' },
          opacity: { type: 'number', description: '0 to 1.' },
          palette: { type: 'string', description: `A kepler palette name, e.g. ${SUGGESTED_PALETTES.join(', ')}.` },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_layer',
      description:
        'Change an existing layer (by id or label, see the layers in the system prompt): show/hide it, rename it, recolour or resize it by a column, switch 3D, radius, opacity, palette. Hiding a layer is how to "remove" one the panel came with.',
      parameters: {
        type: 'object',
        properties: {
          layer: { type: 'string' },
          visible: { type: 'boolean' },
          label: { type: 'string' },
          color_by: { type: 'string' },
          size_by: { type: 'string' },
          aggregation: { type: 'string', enum: [...AGGREGATIONS] },
          three_d: { type: 'boolean' },
          radius: { type: 'number' },
          opacity: { type: 'number' },
          palette: { type: 'string' },
        },
        required: ['layer'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'remove_layer',
      description: 'Remove a layer this conversation added. Layers the panel came with can only be hidden (update_layer visible=false).',
      parameters: { type: 'object', properties: { layer: { type: 'string' } }, required: ['layer'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_view',
      description: 'Tilt (pitch 0–60, 0 is flat), rotate (bearing in degrees) or move the camera (zoom 0–20, latitude/longitude of the centre).',
      parameters: {
        type: 'object',
        properties: {
          pitch: { type: 'number' },
          bearing: { type: 'number' },
          zoom: { type: 'number' },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_basemap',
      description: 'Switch the base map to one of the ids listed in the system prompt.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'suggest_visualizations',
      description:
        'Read the shape of the data (fixed sensors with series, moving assets, origin–destination pairs, dense events, categories) and list the visualization recipes that fit, best first. Use it when asked how to show the data, for "a better map", or before building several layers by hand.',
      parameters: { type: 'object', properties: { dataset: DATASET_PARAM } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'apply_recipe',
      description:
        'Build every layer of a recipe from suggest_visualizations at once (with fades by zoom and camera tilt where the recipe has them), hiding the dataset\'s current layers unless keep_existing. Recipes marked unavailable need Kepler Plus.',
      parameters: {
        type: 'object',
        properties: {
          recipe: { type: 'string' },
          dataset: DATASET_PARAM,
          value_field: { type: 'string', description: 'Numeric column to show; the recipe picks one when left out.' },
          category_field: { type: 'string' },
          keep_existing: { type: 'boolean' },
        },
        required: ['recipe'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'filter_area',
      description:
        'Keep only what lies inside an area on every visible layer (a spatial filter, drawn on the map as a figure; it is also what an area variable of the dashboard publishes). Replaces earlier figures. Returns how many rows fall inside.',
      parameters: { type: 'object', properties: { area: AREA_PARAM }, required: ['area'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'clear_area',
      description: 'Remove every figure drawn on the map and the spatial filters they make.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fly_to',
      description: 'Animated camera flight to a place (coordinates you know for named places), with optional zoom (0–20), pitch and bearing.',
      parameters: {
        type: 'object',
        properties: {
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          zoom: { type: 'number' },
          pitch: { type: 'number' },
          bearing: { type: 'number' },
          seconds: { type: 'number', description: 'Flight length, 0.5–10. Default 3.' },
        },
        required: ['latitude', 'longitude'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fade_by_zoom',
      description:
        'Make a layer appear and disappear with zoom: invisible at zoom ≤ appear, fading in until full, fully visible until fade, fading out until gone, invisible beyond. Zooms 0–24 (0 world, 5 country, 10 city, 15 street). E.g. "show the points only when zoomed in past 6": appear 5, full 6, fade 24, gone 24. off=true removes it for the layer.',
      parameters: {
        type: 'object',
        properties: {
          layer: { type: 'string' },
          appear: { type: 'number' },
          full: { type: 'number' },
          fade: { type: 'number' },
          gone: { type: 'number' },
          off: { type: 'boolean' },
        },
        required: ['layer'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_time_range',
      description:
        'Set the dashboard time range, which every panel follows (this map\'s data and time filter included). from/to are Grafana relative times (now-7d, now-24h, now/d, now) or ISO 8601 instants.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'undo',
      description: 'Put the map back as it was before the previous question that changed it (layers, filters, areas, camera, base map, time range).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'zoom_to',
      description:
        'Frame the map on the rows that meet the conditions and lie in the area (all rows of the dataset when neither is given). Jumps; use fly_to for an animated move to a place.',
      parameters: { type: 'object', properties: { dataset: DATASET_PARAM, where: WHERE_PARAM, area: AREA_PARAM } },
    },
  },
];

export function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  try {
    switch (name) {
      case 'describe_field':
        return { result: describeField(ctx, args) };
      case 'query_rows':
        return { result: queryRows(ctx, args) };
      case 'filter_map':
        return filterMap(ctx, args);
      case 'clear_filters':
        return clearFilters(ctx, args);
      case 'zoom_to':
        return zoomTo(ctx, args);
      case 'add_layer':
        return addLayer(ctx, args);
      case 'update_layer':
        return updateLayer(ctx, args);
      case 'remove_layer':
        return removeLayer(ctx, args);
      case 'set_view':
        return setView(ctx, args);
      case 'set_basemap':
        return setBasemap(ctx, args);
      case 'filter_area':
        return filterArea(ctx, args);
      case 'suggest_visualizations':
        return suggestVisualizations(ctx, args);
      case 'apply_recipe':
        return applyRecipe(ctx, args);
      case 'clear_area': {
        const n = ctx.actions.clearAreas();
        return { result: { ok: true, removed: n }, mapChange: 'Cleared the area filter' };
      }
      case 'fly_to':
        return flyTo(ctx, args);
      case 'fade_by_zoom':
        return fadeByZoom(ctx, args);
      case 'set_time_range':
        return setTimeRange(ctx, args);
      case 'undo': {
        const undone = ctx.actions.undo();
        return undone
          ? {
              result: {
                ok: true,
                restored: 'layers, filters, camera and base map as they were before the previous question that changed them',
                dashboardTimeRange: undone.timeRange ?? 'unchanged',
                areaFilter: undone.areaFilter,
              },
              mapChange: 'Undid the previous changes',
            }
          : { result: { error: 'Nothing to undo in this conversation.' } };
      }
      default:
        return { result: { error: `Unknown tool ${name}.` } };
    }
  } catch (error) {
    if (error instanceof ToolError) {
      return { result: { error: error.message } };
    }
    throw error;
  }
}

// ---------------------------------------------------------------- tools

function describeField(ctx: ToolContext, args: Record<string, unknown>) {
  const table = pickTable(ctx.tables, args.dataset);
  const { index, type } = column(table, args.field);
  const values: unknown[] = [];
  let nulls = 0;
  for (let r = 0; r < table.numRows; r++) {
    const v = table.valueAt(r, index);
    if (v === null || v === undefined || v === '') {
      nulls++;
    } else {
      values.push(v);
    }
  }
  const base = { dataset: table.label, field: String(args.field), type, rows: table.numRows, nulls };
  if (isNumeric(type) || isTime(type)) {
    const nums = values.map((v) => toComparable(v, type)).filter((n): n is number => typeof n === 'number' && isFinite(n));
    nums.sort((a, b) => a - b);
    if (!nums.length) {
      return base;
    }
    const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
    const out = (n: number) => formatValue(n, type);
    return { ...base, min: out(nums[0]), max: out(nums[nums.length - 1]), mean: out(mean), median: out(nums[Math.floor(nums.length / 2)]) };
  }
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([value, count]) => ({ value: truncate(value), count }));
  return { ...base, distinct: counts.size, top };
}

function queryRows(ctx: ToolContext, args: Record<string, unknown>) {
  const table = pickTable(ctx.tables, args.dataset);
  const rows = withinArea(ctx, table, matchingRows(table, args.where), args.area);
  const aggregate = args.aggregate as { op?: string; field?: string } | undefined;
  const byTime = args.group_by_time as
    | { field?: string; bucket?: keyof typeof TIME_BUCKETS; chronological?: boolean }
    | undefined;

  if (args.group_by || byTime) {
    const keyOf = groupKey(table, args.group_by, byTime);
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const key = keyOf(r);
      const list = groups.get(key);
      list ? list.push(r) : groups.set(key, [r]);
    }
    const limit = clampLimit(args.limit, 20);
    const out = [...groups.entries()].map(([group, members]) => {
      const value = aggregate && aggregate.op !== 'count' ? aggregateOf(table, members, aggregate) : undefined;
      return { group, count: members.length, ...(value !== undefined ? { [aggregate!.op!]: value } : {}) };
    });
    const sortKey = aggregate && aggregate.op !== 'count' ? aggregate.op! : 'count';
    // Largest first, so a limit keeps the top groups; time buckets in time order when asked.
    out.sort(
      byTime?.chronological
        ? (a, b) => (a.group < b.group ? -1 : 1)
        : (a, b) => num(b[sortKey as 'count']) - num(a[sortKey as 'count'])
    );
    return { dataset: table.label, matched: rows.length, groups: groups.size, rows: out.slice(0, limit), truncated: out.length > limit };
  }

  if (aggregate) {
    const value = aggregate.op === 'count' ? rows.length : aggregateOf(table, rows, aggregate);
    return { dataset: table.label, matched: rows.length, [aggregate.op ?? 'count']: value };
  }

  if (args.order_by) {
    const { index, type } = column(table, args.order_by);
    const dir = args.descending ? -1 : 1;
    rows.sort((a, b) => dir * compareValues(toComparable(table.valueAt(a, index), type), toComparable(table.valueAt(b, index), type)));
  }
  const wanted = Array.isArray(args.columns) && args.columns.length ? (args.columns as unknown[]).map(String) : table.fields.map((f) => f.name);
  const cols = wanted.slice(0, MAX_COLUMNS).map((name) => ({ name, ...column(table, name) }));
  const limit = clampLimit(args.limit, 10);
  const out = rows.slice(0, limit).map((r) => Object.fromEntries(cols.map((c) => [c.name, formatValue(table.valueAt(r, c.index), c.type)])));
  return { dataset: table.label, matched: rows.length, rows: out, truncated: rows.length > limit };
}

function filterMap(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const table = pickTable(ctx.tables, args.dataset);
  const field = String(args.field ?? '');
  const { index, type } = column(table, field);

  if (isNumeric(type) || isTime(type)) {
    if (args.min === undefined && args.max === undefined) {
      throw new ToolError(`${field} is ${type}: give min and/or max.`);
    }
    // An open side runs to the data's own extent.
    let lo = Infinity;
    let hi = -Infinity;
    for (let r = 0; r < table.numRows; r++) {
      const v = toComparable(table.valueAt(r, index), type);
      if (typeof v === 'number' && isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    const min = args.min === undefined ? lo : toComparable(args.min, type);
    const max = args.max === undefined ? hi : toComparable(args.max, type);
    if (typeof min !== 'number' || typeof max !== 'number' || !isFinite(min) || !isFinite(max)) {
      throw new ToolError(`Could not read min/max for ${field}.`);
    }
    if (!ctx.actions.filterRange(field, [min, max])) {
      throw new ToolError('The map is not ready to filter yet; try again in a moment.');
    }
    const shown = matchingRows(table, [{ field, op: 'between', value: [args.min ?? formatValue(lo, type), args.max ?? formatValue(hi, type)] }]).length;
    const label = `${field} ${formatValue(min, type)} – ${formatValue(max, type)}`;
    return { result: { ok: true, filter: label, rowsInRange: shown }, mapChange: `Filtered ${label}` };
  }

  const values = Array.isArray(args.values) ? (args.values as unknown[]).map(String) : args.values !== undefined ? [String(args.values)] : [];
  if (!values.length) {
    throw new ToolError(`${field} is text: give values (see describe_field for what it holds).`);
  }
  if (!ctx.actions.filterValues(field, values)) {
    throw new ToolError('The map is not ready to filter yet; try again in a moment.');
  }
  const shown = matchingRows(table, [{ field, op: 'in', value: values }]).length;
  const label = `${field} = ${values.map(truncate).join(', ')}`;
  return { result: { ok: true, filter: label, matchingRows: shown }, mapChange: `Filtered ${label}` };
}

function clearFilters(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  if (args.field) {
    ctx.actions.clearFilter(String(args.field));
    return { result: { ok: true, cleared: [String(args.field)] }, mapChange: `Cleared the filter on ${String(args.field)}` };
  }
  const cleared = ctx.actions.clearAllFilters();
  return { result: { ok: true, cleared }, mapChange: 'Cleared every filter' };
}

function zoomTo(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const table = pickTable(ctx.tables, args.dataset);
  const pair = table.points[0] ?? guessPoint(table);
  if (!pair) {
    throw new ToolError(`${table.label} has no latitude/longitude columns to frame.`);
  }
  const lat = column(table, pair[0]).index;
  const lon = column(table, pair[1]).index;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  let count = 0;
  for (const r of withinArea(ctx, table, matchingRows(table, args.where), args.area)) {
    const y = Number(table.valueAt(r, lat));
    const x = Number(table.valueAt(r, lon));
    if (!isFinite(x) || !isFinite(y)) {
      continue;
    }
    count++;
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  if (!count) {
    throw new ToolError('No row with coordinates meets those conditions.');
  }
  // A lone point (or a tight cluster) still gets a city's worth of context.
  const pad = Math.max(0.02, Math.max(e - w, n - s) * 0.05);
  const bounds: [number, number, number, number] = [
    Math.max(-180, w - pad),
    Math.max(-85, s - pad),
    Math.min(180, e + pad),
    Math.min(85, n + pad),
  ];
  ctx.actions.fitBounds(bounds);
  return { result: { ok: true, rows: count, bounds }, mapChange: `Zoomed to ${count} ${count === 1 ? 'row' : 'rows'}` };
}

function styleArgs(table: TableView, args: Record<string, unknown>): LayerStyle {
  const field = (name: unknown) => {
    if (name === undefined || name === null || name === '') {
      return undefined;
    }
    const { type } = column(table, name);
    return { name: String(name), type };
  };
  if (args.palette !== undefined && !paletteRange(String(args.palette))) {
    throw new ToolError(`No palette "${String(args.palette)}". Try one of: ${SUGGESTED_PALETTES.join(', ')}.`);
  }
  if (args.aggregation !== undefined && !(AGGREGATIONS as readonly string[]).includes(String(args.aggregation))) {
    throw new ToolError(`aggregation is one of ${AGGREGATIONS.join(', ')}.`);
  }
  const num = (v: unknown) => (v === undefined ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    colorBy: field(args.color_by),
    sizeBy: field(args.size_by),
    threeD: typeof args.three_d === 'boolean' ? args.three_d : undefined,
    radius: num(args.radius),
    opacity: num(args.opacity),
    palette: args.palette !== undefined ? String(args.palette) : undefined,
    aggregation: args.aggregation as LayerStyle['aggregation'],
  };
}

/** Tilts a flat map so a layer just made 3D can be seen as such. */
function tiltFor3d(ctx: ToolContext, threeD: boolean | undefined, changes: string[]) {
  if (threeD && ctx.actions.pitch() < 20) {
    ctx.actions.setView({ pitch: 45 });
    changes.push('tilted the map to 45°');
  }
}

function addLayer(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const table = pickTable(ctx.tables, args.dataset);
  const type = String(args.type ?? '') as LayerSpec['type'];
  if (!(LAYER_TYPES as readonly string[]).includes(type)) {
    throw new ToolError(`type is one of ${LAYER_TYPES.join(', ')}.`);
  }
  const pair = table.points[0] ?? guessPoint(table);
  if (!pair) {
    throw new ToolError(`${table.label} has no latitude/longitude columns to draw.`);
  }
  const style = styleArgs(table, args);
  const label = args.label ? String(args.label) : `${table.label} ${type}${style.threeD ? ' 3D' : ''}`;
  const added = ctx.actions.addLayer({ ...style, type, dataId: table.id, label, lat: pair[0], lng: pair[1] }, extentKm(table, pair));
  if ('error' in added) {
    throw new ToolError(added.error);
  }
  const changes = [`Added ${type} layer "${label}"`];
  tiltFor3d(ctx, style.threeD, changes);
  return { result: { ok: true, id: added.id, label, encoding: encodingOf(type, style) }, mapChange: changes.join(', ') };
}

/** What drives colour and size, in words, so the answer does not guess ("height by depth" when it is the count). */
function encodingOf(type: LayerSpec['type'], style: LayerStyle): string {
  const agg = style.aggregation ?? 'average';
  switch (type) {
    case 'heatmap':
      return `colour: density${style.colorBy || style.sizeBy ? ` weighted by ${(style.sizeBy ?? style.colorBy)!.name}` : ''}${style.threeD ? '; surface height: the same density' : ''}`;
    case 'hexagon':
    case 'grid':
    case 'cluster': {
      const colour = style.colorBy ? `${agg} ${style.colorBy.name} per cell` : 'number of rows per cell';
      if (type === 'cluster') {
        return `colour: ${colour}; dot size: rows per cluster`;
      }
      const height = style.sizeBy ? `${agg} ${style.sizeBy.name} per cell` : 'number of rows per cell';
      return `colour: ${colour}${style.threeD ? `; height: ${height}` : ''}`;
    }
    default:
      return `colour: ${style.colorBy ? style.colorBy.name : 'one colour'}; radius: ${style.sizeBy ? style.sizeBy.name : 'fixed'}`;
  }
}

function updateLayer(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const ref = String(args.layer ?? '');
  // Columns are checked against the first dataset that has them; the bridge checks the layer's own.
  const table = ctx.tables.find((t) =>
    [args.color_by, args.size_by].every((f) => f === undefined || t.fields.some((x) => x.name === f))
  ) ?? pickTable(ctx.tables, undefined);
  const change = {
    ...styleArgs(table, args),
    visible: typeof args.visible === 'boolean' ? args.visible : undefined,
    label: args.label !== undefined ? String(args.label) : undefined,
  };
  const updated = ctx.actions.updateLayer(ref, change);
  if ('error' in updated) {
    throw new ToolError(updated.error);
  }
  const what = Object.entries(args)
    .filter(([k]) => k !== 'layer')
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(', ');
  const changes = [`Layer "${ref}": ${what || 'unchanged'}`];
  tiltFor3d(ctx, change.threeD, changes);
  return { result: { ok: true, id: updated.id }, mapChange: changes.join(', ') };
}

function removeLayer(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const removed = ctx.actions.removeLayer(String(args.layer ?? ''));
  if ('error' in removed) {
    throw new ToolError(removed.error);
  }
  return { result: { ok: true, id: removed.id }, mapChange: `Removed layer "${String(args.layer)}"` };
}

function setView(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const view: Parameters<MapActions['setView']>[0] = {};
  const num = (k: string) => (args[k] !== undefined && Number.isFinite(Number(args[k])) ? Number(args[k]) : undefined);
  const pitch = num('pitch');
  if (pitch !== undefined) {
    view.pitch = Math.min(60, Math.max(0, pitch));
  }
  for (const k of ['bearing', 'zoom', 'latitude', 'longitude'] as const) {
    const v = num(k);
    if (v !== undefined) {
      view[k] = v;
    }
  }
  if (!Object.keys(view).length) {
    throw new ToolError('Give at least one of pitch, bearing, zoom, latitude, longitude.');
  }
  ctx.actions.setView(view);
  return { result: { ok: true, ...view }, mapChange: `View ${Object.entries(view).map(([k, v]) => `${k} ${v}`).join(', ')}` };
}

function setBasemap(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const id = String(args.id ?? '');
  if (!ctx.actions.setBasemap(id)) {
    throw new ToolError(`No base map "${id}"; use an id from the system prompt.`);
  }
  return { result: { ok: true, id }, mapChange: `Base map ${id}` };
}

function suggestVisualizations(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const tables = args.dataset ? [pickTable(ctx.tables, args.dataset)] : ctx.tables;
  const catalog = recipeCatalog(ctx.recipes);
  return {
    result: tables.map((t) => {
      const profile = profileTable(t);
      const fits = catalog
        .map((r) => ({ r, score: r.score(profile) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || Number(Boolean(b.r.build)) - Number(Boolean(a.r.build)))
        .map(({ r }) => ({
          recipe: r.id,
          title: r.title,
          why: r.why(profile),
          available: Boolean(r.build),
          ...(r.build ? {} : { needs: 'Kepler Geospatial Maps Plus' }),
        }));
      const { dataset, label, rows, places, rowsPerPlace, idField, positionsPerId, time, valueFields, categoryFields, shapes } = profile;
      return {
        dataset,
        label,
        shape: { rows, places, rowsPerPlace, idField, positionsPerId, time, valueFields, categoryFields, shapes },
        // The recipe to apply when asked for "the best": the top one this panel can build.
        best: fits.find((f) => f.available)?.recipe ?? null,
        recipes: fits,
      };
    }),
  };
}

function applyRecipe(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const table = pickTable(ctx.tables, args.dataset);
  const recipe = recipeCatalog(ctx.recipes).find((r) => r.id === String(args.recipe ?? ''));
  if (!recipe) {
    throw new ToolError(`No recipe "${String(args.recipe)}"; call suggest_visualizations first.`);
  }
  if (!recipe.build) {
    throw new ToolError(`"${recipe.title}" needs Kepler Geospatial Maps Plus; this panel is the free one.`);
  }
  const options = {
    valueField: args.value_field !== undefined ? String(args.value_field) : undefined,
    categoryField: args.category_field !== undefined ? String(args.category_field) : undefined,
  };
  for (const name of [options.valueField, options.categoryField]) {
    if (name !== undefined) {
      column(table, name);
    }
  }
  const profile = profileTable(table);
  const built = recipe.build(profile, options);
  if ('error' in built) {
    throw new ToolError(built.error);
  }
  const hidden = args.keep_existing === true ? [] : ctx.actions.visibleLayersOf(table.id);
  const added: Array<{ id: string; encoding: string }> = [];
  for (const layer of built.layers) {
    const out = ctx.actions.addLayerConfig(layer.config);
    if ('error' in out) {
      throw new ToolError(`${String((layer.config as { type?: string }).type)} layer: ${out.error}`);
    }
    if (layer.fade) {
      ctx.actions.fadeByZoom(out.id, layer.fade);
    }
    added.push({ id: out.id, encoding: layer.encoding });
  }
  for (const id of hidden) {
    ctx.actions.updateLayer(id, { visible: false });
  }
  const changes = [`Recipe "${recipe.title}": ${added.length} ${added.length === 1 ? 'layer' : 'layers'}`];
  if (hidden.length) {
    changes.push(`hid ${hidden.length} earlier`);
  }
  if (built.pitch !== undefined && ctx.actions.pitch() < 20) {
    ctx.actions.setView({ pitch: built.pitch });
    changes.push(`tilted to ${built.pitch}°`);
  }
  return { result: { ok: true, recipe: recipe.id, layers: added, hidden }, mapChange: changes.join(', ') };
}

/** The geometry an area argument describes, and a few words for the viewer. */
export function resolveArea(ctx: ToolContext, area: unknown): { geometry: AreaGeometry; label: string } {
  const a = (area ?? {}) as Record<string, unknown>;
  const n = (k: string) => (a[k] !== undefined && Number.isFinite(Number(a[k])) ? Number(a[k]) : undefined);
  switch (a.shape) {
    case 'circle': {
      const [lat, lon, r] = [n('latitude'), n('longitude'), n('radius_km')];
      if (lat === undefined || lon === undefined || r === undefined || r <= 0) {
        throw new ToolError('A circle needs latitude, longitude and a positive radius_km.');
      }
      return { geometry: circlePolygon(lat, lon, r), label: `within ${r} km of ${lat.toFixed(2)}, ${lon.toFixed(2)}` };
    }
    case 'box': {
      const [w, so, e, no] = [n('west'), n('south'), n('east'), n('north')];
      if ([w, so, e, no].some((v) => v === undefined) || w! >= e! || so! >= no!) {
        throw new ToolError('A box needs west < east and south < north.');
      }
      return { geometry: bboxPolygon(w!, so!, e!, no!), label: `in the box ${w}, ${so} – ${e}, ${no}` };
    }
    case 'polygon': {
      const geometry = polygonFrom(a.coordinates);
      if (!geometry) {
        throw new ToolError('A polygon needs at least three [lon, lat] points.');
      }
      return { geometry, label: 'in the polygon' };
    }
    case 'drawn': {
      const last = ctx.actions.drawnAreas().at(-1);
      if (!last || (last.geometry.type !== 'Polygon' && last.geometry.type !== 'MultiPolygon')) {
        throw new ToolError('No area is drawn on the map. The viewer draws one with the polygon or rectangle tool (top right).');
      }
      return { geometry: last.geometry as AreaGeometry, label: 'in the drawn area' };
    }
    default:
      throw new ToolError('area.shape is circle, box, polygon or drawn.');
  }
}

function withinArea(ctx: ToolContext, table: TableView, rows: number[], area: unknown): number[] {
  if (area === undefined || area === null) {
    return rows;
  }
  const { geometry } = resolveArea(ctx, area);
  const pair = table.points[0] ?? guessPoint(table);
  if (!pair) {
    throw new ToolError(`${table.label} has no latitude/longitude columns to place in an area.`);
  }
  const lat = column(table, pair[0]).index;
  const lon = column(table, pair[1]).index;
  return rows.filter((r) => {
    const y = Number(table.valueAt(r, lat));
    const x = Number(table.valueAt(r, lon));
    return Number.isFinite(x) && Number.isFinite(y) && contains(geometry, x, y);
  });
}

function filterArea(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const { geometry, label } = resolveArea(ctx, args.area);
  const inside = ctx.tables.map((t) => {
    try {
      return { dataset: t.label, rowsInside: withinArea(ctx, t, allRows(t), args.area).length };
    } catch {
      return { dataset: t.label, rowsInside: null };
    }
  });
  if (!ctx.actions.filterArea(geometry)) {
    throw new ToolError('No layer is visible to filter.');
  }
  return { result: { ok: true, area: label, inside }, mapChange: `Area filter: ${label}` };
}

function flyTo(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const num = (k: string) => (args[k] !== undefined && Number.isFinite(Number(args[k])) ? Number(args[k]) : undefined);
  const [latitude, longitude] = [num('latitude'), num('longitude')];
  if (latitude === undefined || longitude === undefined || Math.abs(latitude) > 85 || Math.abs(longitude) > 180) {
    throw new ToolError('fly_to needs latitude (±85) and longitude (±180).');
  }
  const view: Parameters<MapActions['flyTo']>[0] = { latitude, longitude };
  const zoom = num('zoom');
  if (zoom !== undefined) {
    view.zoom = Math.min(20, Math.max(0, zoom));
  }
  const pitch = num('pitch');
  if (pitch !== undefined) {
    view.pitch = Math.min(60, Math.max(0, pitch));
  }
  const bearing = num('bearing');
  if (bearing !== undefined) {
    view.bearing = bearing;
  }
  const seconds = Math.min(10, Math.max(0.5, num('seconds') ?? 3));
  ctx.actions.flyTo(view, seconds);
  return {
    result: { ok: true, ...view, seconds },
    mapChange: `Flew to ${latitude.toFixed(2)}, ${longitude.toFixed(2)}${view.zoom !== undefined ? ` (zoom ${view.zoom})` : ''}`,
  };
}

function fadeByZoom(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const ref = String(args.layer ?? '');
  if (args.off === true) {
    const out = ctx.actions.fadeByZoom(ref, null);
    if ('error' in out) {
      throw new ToolError(out.error);
    }
    return { result: { ok: true, id: out.id, off: true }, mapChange: `Layer "${ref}" no longer fades with zoom` };
  }
  const n = (k: string, d: number) => Math.min(24, Math.max(0, Number.isFinite(Number(args[k])) && args[k] !== undefined ? Number(args[k]) : d));
  const stops = { appear: n('appear', 0), full: n('full', 0), fade: n('fade', 24), gone: n('gone', 24) };
  if (!(stops.appear <= stops.full && stops.full <= stops.fade && stops.fade <= stops.gone)) {
    throw new ToolError('Stops must run appear ≤ full ≤ fade ≤ gone.');
  }
  const out = ctx.actions.fadeByZoom(ref, stops);
  if ('error' in out) {
    throw new ToolError(out.error);
  }
  return {
    result: { ok: true, id: out.id, ...stops },
    mapChange: `Layer "${ref}" visible from zoom ${stops.full}${stops.fade < 24 ? ` to ${stops.fade}` : ''}`,
  };
}

const RELATIVE_TIME = /^now([+-]\d+[smhdwMy])*(\/[smhdwMy])?$/;

function setTimeRange(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const read = (v: unknown, name: string) => {
    const text = String(v ?? '').trim();
    if (RELATIVE_TIME.test(text)) {
      return text;
    }
    const ms = Date.parse(text);
    if (Number.isFinite(ms)) {
      return String(ms);
    }
    throw new ToolError(`${name} must be a Grafana relative time (now-7d) or an ISO 8601 instant.`);
  };
  const from = read(args.from, 'from');
  const to = read(args.to, 'to');
  if (/^\d+$/.test(from) && /^\d+$/.test(to) && Number(from) >= Number(to)) {
    throw new ToolError('from must be before to.');
  }
  ctx.actions.setTimeRange(from, to);
  const show = (t: string) => (/^\d+$/.test(t) ? new Date(Number(t)).toISOString() : t);
  return { result: { ok: true, from: show(from), to: show(to) }, mapChange: `Dashboard time ${show(from)} → ${show(to)}` };
}

const allRows = (t: TableView) => Array.from({ length: t.numRows }, (_, i) => i);

/** The diagonal of the rows' bounding box in kilometres (equirectangular, plenty for sizing cells). */
function extentKm(table: TableView, pair: [string, string]): number {
  const lat = column(table, pair[0]).index;
  const lon = column(table, pair[1]).index;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let r = 0; r < table.numRows; r++) {
    const y = Number(table.valueAt(r, lat));
    const x = Number(table.valueAt(r, lon));
    if (Number.isFinite(x) && Number.isFinite(y)) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
  }
  if (!Number.isFinite(w)) {
    return 100;
  }
  const midLat = ((s + n) / 2) * (Math.PI / 180);
  const dx = (e - w) * 111.32 * Math.cos(midLat);
  const dy = (n - s) * 110.57;
  return Math.max(1, Math.hypot(dx, dy));
}

// ---------------------------------------------------------------- helpers

function pickTable(tables: TableView[], wanted: unknown): TableView {
  if (!tables.length) {
    throw new ToolError('The map has no data loaded.');
  }
  if (wanted === undefined || wanted === null || wanted === '') {
    return tables[0];
  }
  const name = String(wanted);
  const found = tables.find((t) => t.id === name || t.label === name);
  if (!found) {
    throw new ToolError(`No dataset "${name}". Datasets: ${tables.map((t) => t.label).join(', ')}.`);
  }
  return found;
}

function column(table: TableView, field: unknown): { index: number; type: string } {
  const name = String(field ?? '');
  const index = table.fields.findIndex((f) => f.name === name);
  if (index < 0) {
    const near = table.fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
    throw new ToolError(
      near ? `No column "${name}"; did you mean "${near.name}"?` : `No column "${name}" in ${table.label}. Columns: ${table.fields.map((f) => f.name).join(', ')}.`
    );
  }
  return { index, type: table.fields[index].type };
}

function matchingRows(table: TableView, where: unknown): number[] {
  const conditions = (Array.isArray(where) ? where : []) as Condition[];
  const tests = conditions.map((c) => {
    const { index, type } = column(table, c.field);
    return (r: number) => meets(table.valueAt(r, index), type, c);
  });
  const out: number[] = [];
  for (let r = 0; r < table.numRows; r++) {
    if (tests.every((t) => t(r))) {
      out.push(r);
    }
  }
  return out;
}

function meets(raw: unknown, type: string, c: Condition): boolean {
  const empty = raw === null || raw === undefined || raw === '';
  switch (c.op) {
    case 'is_null':
      return empty;
    case 'not_null':
      return !empty;
  }
  if (empty) {
    return false;
  }
  if (c.op === 'contains') {
    return String(raw).toLowerCase().includes(String(c.value ?? '').toLowerCase());
  }
  const v = toComparable(raw, type);
  if (c.op === 'in') {
    const list = Array.isArray(c.value) ? c.value : [c.value];
    return list.some((x) => compareValues(v, toComparable(x, type)) === 0);
  }
  if (c.op === 'between') {
    const [lo, hi] = Array.isArray(c.value) ? c.value : [undefined, undefined];
    return compareValues(v, toComparable(lo, type)) >= 0 && compareValues(v, toComparable(hi, type)) <= 0;
  }
  const cmp = compareValues(v, toComparable(c.value, type));
  switch (c.op) {
    case 'eq':
      return cmp === 0;
    case 'neq':
      return cmp !== 0;
    case 'gt':
      return cmp > 0;
    case 'gte':
      return cmp >= 0;
    case 'lt':
      return cmp < 0;
    case 'lte':
      return cmp <= 0;
    default:
      throw new ToolError(`Unknown operator ${String(c.op)}.`);
  }
}

function groupKey(table: TableView, field: unknown, byTime?: { field?: string; bucket?: keyof typeof TIME_BUCKETS }) {
  if (byTime) {
    const { index, type } = column(table, byTime.field);
    const width = TIME_BUCKETS[byTime.bucket ?? 'day'];
    if (!width) {
      throw new ToolError(`Unknown bucket ${String(byTime.bucket)}.`);
    }
    return (r: number) => {
      const ms = toComparable(table.valueAt(r, index), isTime(type) ? type : 'timestamp');
      return typeof ms === 'number' && isFinite(ms) ? new Date(ms).toISOString().slice(0, width) : '(none)';
    };
  }
  const { index } = column(table, field);
  return (r: number) => {
    const v = table.valueAt(r, index);
    return v === null || v === undefined || v === '' ? '(none)' : truncate(String(v));
  };
}

function aggregateOf(table: TableView, rows: number[], aggregate: { op?: string; field?: string }): unknown {
  const { index, type } = column(table, aggregate.field);
  const nums = rows.map((r) => toComparable(table.valueAt(r, index), type)).filter((n): n is number => typeof n === 'number' && isFinite(n));
  if (!nums.length) {
    return null;
  }
  switch (aggregate.op) {
    case 'sum':
      return round(nums.reduce((s, n) => s + n, 0));
    case 'avg':
      return formatValue(nums.reduce((s, n) => s + n, 0) / nums.length, type);
    case 'min':
      return formatValue(Math.min(...nums), type);
    case 'max':
      return formatValue(Math.max(...nums), type);
    default:
      throw new ToolError(`Unknown aggregate ${String(aggregate.op)}.`);
  }
}

const isNumeric = (type: string) => type === 'real' || type === 'integer';
const isTime = (type: string) => type === 'timestamp' || type === 'date';

/** A value made comparable for its column: epoch ms for times, a number for numbers, a string otherwise. */
export function toComparable(value: unknown, type: string): number | string | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (isTime(type)) {
    if (typeof value === 'number') {
      // Seconds, not milliseconds, below the year 5138 in seconds.
      return Math.abs(value) < 1e11 ? value * 1000 : value;
    }
    if (value instanceof Date) {
      return value.getTime();
    }
    const asNumber = Number(value);
    if (String(value).trim() !== '' && isFinite(asNumber)) {
      return Math.abs(asNumber) < 1e11 ? asNumber * 1000 : asNumber;
    }
    const ms = Date.parse(String(value));
    return isFinite(ms) ? ms : undefined;
  }
  if (isNumeric(type)) {
    const n = typeof value === 'number' ? value : Number(value);
    return isFinite(n) ? n : undefined;
  }
  return String(value);
}

function compareValues(a: number | string | undefined, b: number | string | undefined): number {
  if (a === undefined || b === undefined) {
    return a === b ? 0 : a === undefined ? 1 : -1;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b));
}

function formatValue(value: unknown, type: string): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (isTime(type)) {
    const ms = typeof value === 'number' ? value : toComparable(value, type);
    return typeof ms === 'number' && isFinite(ms) ? new Date(ms).toISOString() : String(value);
  }
  if (typeof value === 'number') {
    return round(value);
  }
  if (typeof value === 'string') {
    return truncate(value);
  }
  if (typeof value === 'object') {
    return truncate(JSON.stringify(value));
  }
  return value;
}

const round = (n: number) => (Number.isInteger(n) ? n : Number(n.toPrecision(6)));
const truncate = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);
const num = (v: unknown) => (typeof v === 'number' ? v : -Infinity);
const clampLimit = (limit: unknown, fallback: number) =>
  Math.max(1, Math.min(MAX_ROWS, Number.isFinite(Number(limit)) && limit !== undefined ? Math.floor(Number(limit)) : fallback));

function guessPoint(table: TableView): [string, string] | null {
  const names = table.fields.map((f) => f.name);
  const lat = names.find((n) => /^(lat|latitude|.*_lat|.*_latitude|y)$/i.test(n));
  const lon = names.find((n) => /^(lon|lng|long|longitude|.*_lon|.*_lng|.*_longitude|x)$/i.test(n));
  return lat && lon ? [lat, lon] : null;
}
