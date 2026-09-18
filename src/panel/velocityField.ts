import {
  buildGradientField,
  buildWindField,
  GradientDirection,
  GridFrame,
  smoothWindField,
  WindField,
  WindFieldColumns,
} from '../data/buildWindField';
import { stackExaggeration, type ScreenCamera } from '../data/traceStreamlines';

/**
 * What the two layers that draw a grid of velocities share: the flow field,
 * which traces it into streamlines, and the vector field, which marks it with
 * arrows and wind barbs.
 *
 * Pure, like both of them. Everything here is about reading the field and
 * measuring speeds against a range; nothing here knows how either layer draws.
 */

/**
 * Where the map is looking from, in the plain numbers kepler keeps.
 *
 * A camera and not a rectangle of ground, because those stop being the same
 * thing the moment the map is tilted — see `ScreenCamera`. Plain numbers because
 * this travels through `visConfig`, which is saved with the dashboard.
 */
export interface CameraState {
  latitude: number;
  longitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  width: number;
  height: number;
}

/** Turns that into something that can unproject — see `flowFieldDeckLayer.ts`. */
export type ScreenCameraFactory = (camera: CameraState) => ScreenCamera | null;

/**
 * What the panel knows and the layer cannot work out for itself.
 *
 * Written into `visConfig` by `useFlowFieldContext`, and deliberately absent
 * from the layer panel — none of it is a choice the user makes. It travels
 * through `visConfig` because that is the one channel that reaches a layer
 * without touching its dataset, the same road `visConfig.zarrLabel` takes.
 */
export interface FlowFieldContext {
  /** Where the map is looking from, so seeding and step length follow the screen. */
  camera?: CameraState;
  /**
   * The tallest level on the map, in metres.
   *
   * Shared across the flow field layers rather than taken from each layer's own
   * altitude: the exaggeration scales the whole stack to a share of the view, so
   * a layer computing it from its own height would draw every level at the same
   * altitude and flatten the stack it exists to separate.
   */
  tallest?: number;
}

/**
 * How the query spells the velocity, and which columns each spelling needs.
 *
 * kepler renders a column picker per required and optional column of the
 * selected mode, which is the whole reason the four velocity roles finally have
 * a place in the interface: until now they were autodetect-only.
 */
export const VELOCITY_COLUMN_MODES = [
  {
    key: 'components',
    label: 'U / V components',
    requiredColumns: ['lat', 'lng', 'u', 'v'],
    optionalColumns: ['altitude'],
  },
  {
    key: 'polar',
    label: 'Speed / direction',
    requiredColumns: ['lat', 'lng', 'speed', 'direction'],
    optionalColumns: ['altitude'],
  },
  {
    key: 'gradient',
    label: 'Gradient of a value',
    requiredColumns: ['lat', 'lng', 'value'],
    optionalColumns: ['altitude'],
  },
];

/** One column of a kepler layer, as kepler stores it once the config is parsed. */
export interface LayerColumn {
  value?: string | null;
  fieldIdx?: number;
}

/**
 * The knobs both velocity layers carry, under the same names — which is what
 * lets kepler keep them when a layer's type is switched from one to the other:
 * `assignConfigToLayer` copies every key the new layer also has.
 */
export const VELOCITY_VIS_CONFIGS = {
  opacity: 'opacity',
  colorRange: 'colorRange',
  heightMeters: {
    type: 'number',
    defaultValue: 0,
    label: 'flowfield.heightMeters',
    isRanged: false,
    range: [0, 20000],
    step: 100,
    group: 'display',
    property: 'heightMeters',
  },
  elevationScale: {
    type: 'number',
    defaultValue: 1,
    label: 'flowfield.elevationScale',
    isRanged: false,
    range: [0, 5],
    step: 0.1,
    group: 'display',
    property: 'elevationScale',
  },
  colorBySpeed: {
    type: 'boolean',
    defaultValue: true,
    label: 'flowfield.colorBySpeed',
    group: 'color',
    property: 'colorBySpeed',
  },
  gradientDirection: {
    type: 'select',
    defaultValue: 'downhill',
    options: ['downhill', 'uphill', 'contours'],
    label: 'flowfield.gradientDirection',
    group: 'display',
    property: 'gradientDirection',
  },
  directionConvention: {
    type: 'select',
    defaultValue: 'from',
    options: ['from', 'towards'],
    label: 'flowfield.directionConvention',
    group: 'display',
    property: 'directionConvention',
  },
  /**
   * The speed range the colour, the width and the opacity are measured against,
   * when it is set by hand rather than taken from the field. Set by hand it is
   * the same on every level and every panel, which is the only way two of them
   * can be compared by eye.
   *
   * No default of its own: wind runs to tens of metres a second and a gradient's
   * slope to a few hundredths, so any fixed number is wrong for one of them. The
   * panel starts it at the field's own range the first time it is switched on.
   */
  fixedSpeedRange: {
    type: 'boolean',
    defaultValue: false,
    label: 'flowfield.fixedSpeedRange',
    group: 'color',
    property: 'fixedSpeedRange',
  },
  speedRange: {
    type: 'number',
    defaultValue: null,
    label: 'flowfield.speedRange',
    isRanged: true,
    range: [0, 50],
    step: 0.1,
    group: 'color',
    property: 'speedRange',
  },
  opacityBySpeed: {
    type: 'boolean',
    defaultValue: false,
    label: 'flowfield.opacityBySpeed',
    group: 'color',
    property: 'opacityBySpeed',
  },
  calmOpacity: {
    type: 'number',
    defaultValue: 0.2,
    label: 'flowfield.calmOpacity',
    isRanged: false,
    range: [0, 1],
    step: 0.05,
    group: 'color',
    property: 'calmOpacity',
  },
} as const;

/**
 * The colour channel this layer shows kepler's legend.
 *
 * kepler's legend draws a layer's colours from whatever channel the layer
 * offers, looking each of the channel's keys up on the config — scale, field and
 * domain — and the colours in `visConfig`. A flow field's colour is the speed of
 * lines traced through the field, which is no column of its dataset, so the
 * channel points at keys of its own that `formatLayerData` fills in.
 *
 * Deliberately not kepler's `colorField`. That one kepler owns: it saves it with
 * the map and, on loading, looks for a column of that name in the dataset —
 * and there is no `speed` column to find. Keys of our own are neither saved nor
 * validated, and are written again on every trace.
 */
export const VELOCITY_LEGEND_CHANNEL = {
  key: 'color',
  property: 'color',
  field: 'flowColorField',
  scale: 'flowColorScale',
  domain: 'flowColorDomain',
  range: 'colorRange',
  // kepler's `CHANNEL_SCALES.color`. The legend keeps only colour channels, and
  // tells them apart by this.
  channelScaleType: 'color',
} as const;

/** One filter as kepler leaves it inside a dataset's own filter record — see `timeWindowOf`. */
interface DatasetFilterRecordEntry {
  type?: string;
  value?: unknown;
  /** kepler's own: one field name per dataset the filter is bound to. */
  name?: unknown;
}

/** kepler's `KeplerTable.filterRecord`: the same filters, sorted by where each one runs. */
interface DatasetFilterRecord {
  cpu?: DatasetFilterRecordEntry[];
  gpu?: DatasetFilterRecordEntry[];
}

/** The kepler dataset a velocity layer reads: rows, and the columns they are in. */
export interface VelocityDataset {
  dataContainer?: { numRows(): number; valueAt(row: number, column: number): unknown };
  /**
   * `type` is kepler's own: a time column carries `timestamp`. `filterProps` is
   * also kepler's own, and only present once a filter has bound to the field —
   * see `timeValueAt`.
   */
  fields?: Array<{ name: string; type?: string; filterProps?: { mappedValue?: unknown[] } }>;
  /**
   * The rows that survived kepler's *CPU-mode* filters, when it has applied
   * any — kepler defaults a `timestamp` field's filter to GPU mode
   * (`getFilterProps` in `@kepler.gl/utils` sets `gpu: true` for
   * `ALL_FIELD_TYPES.timestamp`), and a numeric `range` filter the same way
   * (`ALL_FIELD_TYPES.real`/`.integer`), so in practice this narrows for
   * neither a time window nor a numeric threshold — only for a filter kepler
   * happens to run on the CPU (a category picked from a list, say). The time
   * window reaches the field a different way — see `timeWindowOf`.
   */
  filteredIndex?: number[];
  /** Set by `KeplerTable.filterTable` on every filter change — see `timeWindowOf`. */
  filterRecord?: DatasetFilterRecord;
}

/** kepler's name for a time column. */
const TIME_FIELD_TYPE = 'timestamp';

/** Which column holds the time, or -1. */
function timeColumnOf(dataset: VelocityDataset): number {
  return (dataset.fields ?? []).findIndex((field) => field?.type === TIME_FIELD_TYPE);
}

/** Whether a filter's `name` — kepler's own, one entry per dataset it binds to — names `field`. */
function bindsToField(filterName: unknown, field: string | undefined): boolean {
  if (!field) {
    return false;
  }
  return Array.isArray(filterName) ? filterName.includes(field) : filterName === field;
}

/**
 * The window a time-range filter bound to this dataset's own time column is
 * open to, or null when there is none.
 *
 * Read from the dataset's own filter record rather than trusted to have already
 * narrowed `filteredIndex`, because it has not — see the field comment on
 * `filteredIndex`. Measured in the browser: narrowing the map's time filter
 * left `filteredIndex` holding every row of every hour, while
 * `dataset.filterRecord.gpu` carried the filter's real, narrowed `[from, to]`
 * throughout.
 *
 * Both buckets (`cpu` and `gpu`) are checked, and the match is by field name
 * rather than "the first `timeRange` filter there is": cheap either way, and
 * it keeps working if a kepler version ever sorts a time filter into `cpu` (a
 * category filter already living in that bucket does not disqualify it), or if
 * a second, unrelated time-range filter is ever bound to some other column of
 * the same dataset.
 */
function timeWindowOf(dataset: VelocityDataset, column: number): [number, number] | null {
  const fieldName = dataset.fields?.[column]?.name;
  const record = dataset.filterRecord;
  const value = [...(record?.cpu ?? []), ...(record?.gpu ?? [])].find(
    (f) => f?.type === 'timeRange' && bindsToField(f.name, fieldName)
  )?.value;
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number'
    ? [value[0], value[1]]
    : null;
}

/**
 * A row's time column, in epoch ms.
 *
 * Reads kepler's own `field.filterProps.mappedValue[row]` first rather than
 * `Number(valueAt(...))` alone: kepler keeps some timestamp formats raw in the
 * data container — an ISO string is never converted to a number, only the `x`/
 * `X` (already-numeric) formats are (`ALL_FIELD_TYPES.timestamp`'s `parse` in
 * `processors/data-processor.js`) — and instead compares such a column through
 * this precomputed, per-row numeric array once a filter has bound to it
 * (`getTimestampFieldDomain`; read the same way in `gpu-filter-utils.js`'s
 * `getFilterValueAccessor`). `Number(valueAt(...))` is the fallback, both for a
 * column that already holds epoch ms and for the moment before any filter has
 * bound to an ISO one and computed the mapping.
 *
 * Without this, an ISO-string time column read `Number("2026-01-01T00:00:00Z")`
 * as `NaN` for every row once a time filter existed — before the filter was
 * read at all this silently drew every hour at once; after `timeWindowOf` this
 * silently drew none, since a window narrows to nothing when it cannot read a
 * single row's time.
 */
function timeValueAt(dataset: VelocityDataset, column: number, row: number): number {
  const mapped = dataset.fields?.[column]?.filterProps?.mappedValue?.[row];
  if (typeof mapped === 'number') {
    return mapped;
  }
  return Number(dataset.dataContainer?.valueAt(row, column));
}

/**
 * The rows the layers should read: the filtered ones, narrowed to the latest
 * hour among them.
 *
 * A forecast repeats every cell once per hour. Reading them all lets whichever
 * row came last win each cell — for a wind that reverses, the opposite of the
 * truth. "The latest inside the window" is the same rule `pickLatestWithin`
 * states for the WMS, both ends of the window included.
 */
export function latestStepRows(dataset: VelocityDataset): number[] {
  const container = dataset.dataContainer;
  if (!container) {
    return [];
  }
  let rows = dataset.filteredIndex ?? Array.from({ length: container.numRows() }, (_, i) => i);
  const column = timeColumnOf(dataset);
  if (column < 0) {
    return rows;
  }

  // The window a GPU-mode time filter never reached `filteredIndex` with — see
  // `timeWindowOf`. Applied on top of `filteredIndex` rather than instead of
  // it, so whatever `filteredIndex` does narrow for still holds. A window with
  // no row of any hour inside it is not a signal to fall back to every row —
  // it means the map's clock is looking at a stretch of the forecast this
  // dataset has nothing in, and the layer should draw nothing until it moves.
  const window = timeWindowOf(dataset, column);
  if (window) {
    const [from, to] = window;
    rows = rows.filter((row) => {
      const time = timeValueAt(dataset, column, row);
      return Number.isFinite(time) && time >= from && time <= to;
    });
  }

  let latest = -Infinity;
  for (const row of rows) {
    const time = timeValueAt(dataset, column, row);
    if (Number.isFinite(time) && time > latest) {
      latest = time;
    }
  }
  if (!Number.isFinite(latest)) {
    return rows;
  }
  return rows.filter((row) => timeValueAt(dataset, column, row) === latest);
}

/**
 * The hour on show, in epoch ms, or null when the query carries no time.
 *
 * Read through `timeValueAt`, the same reader `latestStepRows` chose the rows
 * with, and not `Number(valueAt(...))`: this is the key both layers keep their
 * hours and their fast paths by, and for an ISO-string column the bare parse is
 * `NaN` — every hour came out `null`, one name for all of them. Since kepler
 * narrows the table in place (same container, same signature), a layer then saw
 * nothing change when the map's clock moved and drew the first hour for good.
 */
export function latestStepOf(dataset: VelocityDataset): number | null {
  const container = dataset.dataContainer;
  const column = timeColumnOf(dataset);
  if (!container || column < 0) {
    return null;
  }
  const rows = latestStepRows(dataset);
  if (rows.length === 0) {
    return null;
  }
  const time = timeValueAt(dataset, column, rows[0]);
  return Number.isFinite(time) ? time : null;
}

/**
 * The rows kepler holds, in the shape `buildWindField` reads.
 *
 * Only the columns the layer was pointed at are materialised, and only the
 * rows of the latest hour still standing after kepler's filters — see
 * `latestStepRows`. A velocity query is normally narrow, but there is no
 * reason to copy a column, or an hour, nobody reads.
 */
export function gridFrameOf(
  dataset: VelocityDataset,
  columns: Record<string, LayerColumn>
): GridFrame | null {
  const container = dataset.dataContainer;
  if (!container) {
    return null;
  }

  const rows = latestStepRows(dataset);
  const fields: GridFrame['fields'] = [];

  for (const column of Object.values(columns)) {
    const name = column?.value;
    const index = column?.fieldIdx;
    if (!name || index === undefined || index < 0) {
      continue;
    }
    const values = new Float64Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      values[i] = Number(container.valueAt(rows[i], index));
    }
    fields.push({ name, values });
  }

  return { length: rows.length, fields };
}

/** The grid's extent, as kepler's `[west, south, east, north]`. */
export function fieldBounds(field: WindField): [number, number, number, number] {
  return [
    field.west,
    field.south,
    field.west + (field.columns - 1) * field.stepLon,
    field.south + (field.rows - 1) * field.stepLat,
  ];
}

/**
 * How high this level is, in metres.
 *
 * A bound altitude column wins, and the knob answers for a query that returns no
 * height at all — which is the ordinary case, since nothing autodetects an
 * altitude and a level's height is usually a property of the query rather than
 * of its rows.
 *
 * Shared with the adapter on purpose. The exaggeration is derived from the
 * tallest level *on the map*, so the reader that finds that tallest has to
 * answer this question exactly as the layer does; two spellings drifting apart
 * would flatten a stack for reasons nobody could see.
 */
export function levelHeight(
  columnValue: string | null | undefined,
  fromColumn: number,
  visConfig: Record<string, unknown>
): number {
  return columnValue ? fromColumn : setting(visConfig.heightMeters, 0);
}

/** What the altitude column of a velocity query means. */
export type AltitudeMeaning = { kind: 'level'; metres: number } | { kind: 'terrain' };

/**
 * Which of the two an altitude column is, decided by the data.
 *
 * A level's height is a property of the query — "this is the 850 hPa surface" —
 * and is the same in every row. Terrain is not: it is a height per place, and
 * the lines should lie on it. Reading the first value and calling it the level,
 * which is what this did before `constantOf` was retired, flattened a terrain
 * column in silence.
 */
export function altitudeMeaningOf(
  frame: GridFrame,
  column: string | null | undefined,
  visConfig: Record<string, unknown>
): AltitudeMeaning {
  const field = column ? frame.fields.find((f) => f.name === column) : undefined;
  if (!field) {
    return { kind: 'level', metres: setting(visConfig.heightMeters, 0) };
  }

  let first: number | null = null;
  for (let row = 0; row < frame.length; row++) {
    const value = Number(field.values[row]);
    if (!Number.isFinite(value)) {
      continue;
    }
    if (first === null) {
      first = value;
    } else if (Math.abs(value - first) > 1e-6 * Math.max(1, Math.abs(first))) {
      // Relative to the column's own magnitude, not a flat 1e-6: that is finer
      // than a float32 column can even represent at level heights — about
      // 1e-4 m near 1,500 m — so a genuinely constant level carried as float32
      // could round to a slightly different value row to row and be misread
      // as terrain for no reason but the storage type.
      return { kind: 'terrain' };
    }
  }
  return { kind: 'level', metres: first ?? setting(visConfig.heightMeters, 0) };
}

/**
 * How high a level is drawn: its height in metres — the level's own, from
 * `altitudeMeaningOf` or `levelHeight` — exaggerated against the tallest level
 * on the map and the width of the view, then scaled by the user's exaggeration.
 * Shared so a level drawn as streamlines and as arrows sits at one height.
 *
 * Takes the metres rather than the frame and the columns: the two callers now
 * have to ask `altitudeMeaningOf` first, because a *terrain* column has no
 * single height for this to exaggerate — only a level does.
 */
export function stackedAltitude(
  metres: number,
  visConfig: Record<string, unknown>,
  context: FlowFieldContext,
  camera: ScreenCamera | null
): number {
  // How wide the view is across its middle, which is what a person means by
  // it — and unlike the ground the camera can see, it does not balloon when
  // the map is tilted.
  const metresAcross = camera ? camera.metresPerPixel * camera.widthPx : undefined;
  return (
    metres *
    stackExaggeration(setting(context.tallest, metres), metresAcross) *
    setting(visConfig.elevationScale, 1)
  );
}

/**
 * A knob's value, or its default when the layer is carrying no answer.
 *
 * Neither of the obvious spellings is right. `Number(x) ?? d` never falls back,
 * because `Number(undefined)` is `NaN` and `??` only catches null — the value
 * then poisons whatever it is multiplied into, which for the exaggeration means
 * every vertex at `NaN` metres and an invisible layer. `Number(x) || d` falls
 * back on **zero**, and zero is a real answer to two of these: no smoothing, and
 * a flat stack. Absence is checked before the parse rather than after it, since
 * `Number(null)` is zero and would be read as an answer.
 */
export function setting(value: unknown, fallback: number): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** A domain that can be divided by: a zero-width one becomes one unit wide. */
function widened(min: number, max: number): [number, number] {
  // A field of uniform speed would otherwise divide by zero and paint every
  // line the ramp's first colour, which reads as the ramp being broken.
  return max > min ? [min, max] : [min, min + 1];
}

/**
 * The speed range of every cell of the field, holes stepped over.
 *
 * The whole field rather than the lines traced through it. The lines are
 * seeded from the camera, so a ramp stretched over them moved with the view:
 * panning from slack air into a jet repainted the same speed from the top of the
 * ramp to the bottom, and no colour meant anything from one moment to the next.
 */
export function fieldSpeedDomain(field: WindField): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < field.data.length; k += 2) {
    const speed = Math.hypot(field.data[k], field.data[k + 1]);
    if (!Number.isFinite(speed)) {
      continue;
    }
    min = Math.min(min, speed);
    max = Math.max(max, speed);
  }
  return Number.isFinite(min) ? widened(min, max) : [0, 1];
}

/**
 * The range the lines are painted against: the one set by hand when the switch
 * is on and the range is usable, the field's own otherwise.
 *
 * Put the right way round, because kepler's slider keeps its thumbs in order but
 * its number boxes do not.
 */
export function paintDomain(visConfig: Record<string, unknown>, fieldDomain: [number, number]): [number, number] {
  const range = visConfig.fixedSpeedRange === true ? rangeOf(visConfig.speedRange) : null;
  return range ? widened(range[0], range[1]) : fieldDomain;
}

/** A `[min, max]` knob the right way round, or null when it holds no such thing. */
export function rangeOf(value: unknown): [number, number] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const [a, b] = value.map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? [Math.min(a, b), Math.max(a, b)] : null;
}

/** Where a speed sits in a range: 0 at its calm end, 1 at its fast one, held at both. */
export function shareOfRange([min, max]: [number, number], speed: number): number {
  return Math.min(1, Math.max(0, (speed - min) / (max - min)));
}

/** `#rrggbb` as deck's `[r, g, b]`. */
function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * The colour a speed lands on, quantised over the ramp's own steps.
 *
 * Quantised rather than interpolated because that is what kepler's colour ramps
 * are: six or eight chosen colours, not two ends to blend between.
 */
export function colorForSpeed(
  colors: string[],
  domain: [number, number],
  speed: number
): [number, number, number] {
  if (colors.length === 0) {
    return [255, 255, 255];
  }
  const [min, max] = domain;
  const t = (speed - min) / (max - min);
  const index = Math.min(colors.length - 1, Math.max(0, Math.floor(t * colors.length)));
  return parseHex(colors[index]);
}

/**
 * The colour a speed is painted: the ramp's step when colouring by speed, the
 * layer's one colour otherwise, with an alpha from the calm opacity up to opaque
 * when opacity follows speed. Shared so both velocity layers agree on it.
 */
export function speedColorOf(
  visConfig: Record<string, unknown>,
  colors: string[],
  flat: [number, number, number],
  speedDomain: [number, number]
): (speed: number) => number[] {
  const bySpeed = visConfig.colorBySpeed !== false && colors.length > 0;
  const opacityBySpeed = visConfig.opacityBySpeed === true;
  const calm = Math.min(1, Math.max(0, setting(visConfig.calmOpacity, 0.2)));

  return (speed: number): number[] => {
    const rgb = bySpeed ? colorForSpeed(colors, speedDomain, speed) : flat;
    // The alpha rides in the colour rather than a separate channel, so a
    // caller that fades what it draws by multiplying colour — the flow
    // field's trail — fades the slack parts along with it.
    return opacityBySpeed
      ? [...rgb, Math.round(255 * (calm + shareOfRange(speedDomain, speed) * (1 - calm)))]
      : rgb;
  };
}

/**
 * The field the rows describe, smoothed, or null when they describe none.
 *
 * The smoothing default is the caller's because the two layers disagree on it,
 * and for a reason: the flow field traces particles that jitter on a raw 0.25°
 * grid, while an arrow on a data cell has to show the sample as it came.
 */
export function buildVelocityField(
  frame: GridFrame,
  columns: Record<string, LayerColumn>,
  columnMode: string | undefined,
  visConfig: Record<string, unknown>,
  defaultSmoothing: number
): WindField | null {
  const named = (key: string): string | undefined => columns[key]?.value ?? undefined;
  const latitude = named('lat');
  const longitude = named('lng');
  if (!latitude || !longitude) {
    return null;
  }

  const smoothing = Math.round(setting(visConfig.smoothing, defaultSmoothing));

  // The gradient mode smooths the scalar it derives from rather than the
  // vectors it derives — see `buildGradientField`.
  if (columnMode === 'gradient') {
    const value = named('value');
    if (!value) {
      return null;
    }
    return buildGradientField(
      frame,
      { latitude, longitude, value },
      { direction: (visConfig.gradientDirection as GradientDirection) ?? 'downhill', smoothing }
    );
  }

  const spec: WindFieldColumns =
    columnMode === 'polar'
      ? {
          latitude,
          longitude,
          speed: named('speed'),
          direction: named('direction'),
          directionConvention: visConfig.directionConvention === 'towards' ? 'towards' : 'from',
        }
      : { latitude, longitude, u: named('u'), v: named('v') };

  const raw = buildWindField(frame, spec);
  if (!raw) {
    return null;
  }
  return smoothing > 0 ? smoothWindField(raw, smoothing) : raw;
}

/**
 * The legend keys to write, or null when the config already carries them.
 *
 * Null rather than the same keys again because the flow field calls this on
 * every frame of its animation, and a config replaced sixty times a second is
 * sixty re-renders of every panel that reads it.
 */
export function legendPatch(
  config: Record<string, unknown>,
  fieldDomain: [number, number]
): Record<string, unknown> | null {
  const visConfig = (config.visConfig ?? {}) as Record<string, unknown>;
  const domain = paintDomain(visConfig, fieldDomain);
  // A gradient's vectors are metres of fall per metre, not metres a second.
  const measure = config.columnMode === 'gradient' ? 'Slope' : 'Speed';
  const had = config[VELOCITY_LEGEND_CHANNEL.domain] as [number, number] | undefined;
  const field = config[VELOCITY_LEGEND_CHANNEL.field] as { displayName?: string } | undefined;
  if (had && had[0] === domain[0] && had[1] === domain[1] && field?.displayName === measure) {
    return null;
  }
  return {
    [VELOCITY_LEGEND_CHANNEL.scale]: 'quantize',
    [VELOCITY_LEGEND_CHANNEL.domain]: domain,
    [VELOCITY_LEGEND_CHANNEL.field]: { name: measure.toLowerCase(), displayName: measure, type: 'real' },
  };
}

/**
 * What the colour is a measure of, or null to leave the answer to kepler's base
 * layer — for any other channel, and while the symbols are one colour, which is
 * what makes the legend draw a single swatch.
 */
export function legendDescription(
  config: Record<string, unknown>,
  key: string
): { label: string; measure?: string } | null {
  const visConfig = (config.visConfig ?? {}) as Record<string, unknown>;
  if (key !== VELOCITY_LEGEND_CHANNEL.key || visConfig.colorBySpeed === false) {
    return null;
  }
  const field = config[VELOCITY_LEGEND_CHANNEL.field] as { displayName?: string } | undefined;
  return { label: '', measure: field?.displayName };
}
