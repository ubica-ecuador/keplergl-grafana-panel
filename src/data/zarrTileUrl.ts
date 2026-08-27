/**
 * Everything TiTiler needs to render one variable of one Zarr store as tiles.
 *
 * A Zarr store is not a picture and not even a single array: it is a bag of
 * arrays with named dimensions. So a drawable thing is a store *plus* the
 * variable to read *plus*, when that variable has a time axis, which moment of
 * it — three facts, none of which the store alone supplies.
 */
export interface ZarrTileSpec {
  /** Base url of a TiTiler that mounts the `/zarr` router. */
  serverUrl: string;
  /** The store, as TiTiler will open it — an http(s) url or an s3:// path. */
  storeUrl: string;
  /** Which array of the store to draw. */
  variable: string;
  /**
   * The exact index label of the moment wanted, or absent for a variable with
   * no time axis.
   *
   * Exact is the operative word. TiTiler passes this to xarray's `.sel` and
   * exposes no `method`, so there is no falling back to the nearest neighbour:
   * a label that is not in the index answers 500 with `not all values found in
   * index 'time'`. Date-only strings work for a store stamped at midnight and
   * fail for one stamped at 09:00, which is why the label travels whole rather
   * than being rebuilt from a timestamp here.
   */
  label?: string;
  /**
   * Which axis {@link label} selects on. Defaults to `time`.
   *
   * The map's clock is not obliged to drive an axis called `time`, and on a
   * climate store it often cannot: twelve months held as `month=1..12` are
   * integers rather than dates, and the store answers to those. Naming the
   * dimension is what lets the timeline walk it anyway — the query maps each
   * moment of the clock to the label the store knows.
   */
  dimension?: string;
  /**
   * One `dimension=value` pair per non-spatial axis other than the one the
   * clock walks.
   *
   * A store is not obliged to have exactly one axis beyond y and x:
   * CarbonPlan's climate demo has a band *and* a month, and TiTiler takes a
   * repeated `sel` for each. Time is passed separately because the map's clock
   * owns it; everything else is fixed by the query.
   */
  selectors?: string[];
  /**
   * How many levels the store's `multiscales` pyramid has, or absent for a
   * store without one.
   *
   * Present, it changes the request: each zoom asks for its own level instead
   * of every zoom reading native resolution. That is the difference between a
   * continental view costing a second and costing twenty — measured — and it is
   * not something the server will do on its own, because `titiler.xarray` does
   * not read the `multiscales` convention at all. Its `group` parameter,
   * though, selects one, and its own documentation says the group "could be
   * associated with a zoom level".
   *
   * Assumes the ndpyramid convention, where the groups are named `0`, `1`, `2`
   * … by zoom. That is what every pyramid built for a web map uses.
   */
  levels?: number;
  /** `min,max` for the colour stretch. TiTiler's own spelling. */
  rescale?: string;
  /** A TiTiler colormap name — the same vocabulary as the panel's raster ramp. */
  colormap?: string;
}

/** The tiling scheme. Web Mercator, because that is what the map is in. */
const TILE_MATRIX_SET = 'WebMercatorQuad';

/**
 * The url template deck.gl fills in per tile, or null when there is nothing to ask.
 *
 * The `{z}/{x}/{y}` placeholders sit in the path and are left verbatim; only the
 * query is encoded, which `URLSearchParams` does correctly for all three shapes
 * TiTiler accepts — including the `=` inside `sel`, whose value is itself a
 * `dimension=label` pair.
 *
 * Returning null rather than a half-built url is the same choice
 * `framesToRasters` makes when a COG has no tile server: a query can name a
 * store before it names a variable, and drawing nothing is better than asking a
 * question that answers 500.
 */
export function zarrTileTemplate(spec: ZarrTileSpec): string | null {
  const serverUrl = spec.serverUrl.trim().replace(/\/+$/, '');
  const storeUrl = spec.storeUrl.trim();
  const variable = spec.variable.trim();
  if (!serverUrl || !storeUrl || !variable) {
    return null;
  }

  const params = new URLSearchParams({ url: storeUrl, variable });
  for (const selector of spec.selectors ?? []) {
    // A pair or nothing: half of one selects no slice, and TiTiler answers a
    // malformed `sel` with a 500 rather than ignoring it.
    if (/^[^=\s]+=.+$/.test(selector.trim())) {
      params.append('sel', selector.trim());
    }
  }
  if (spec.label) {
    params.append('sel', `${spec.dimension?.trim() || 'time'}=${spec.label}`);
  }
  if (spec.rescale) {
    params.set('rescale', spec.rescale);
  }
  if (spec.colormap) {
    params.set('colormap_name', spec.colormap);
  }

  // Appended raw rather than through `URLSearchParams`, and that is the whole
  // trick: the encoder would write `%7Bz%7D`, deck's substitution looks for a
  // literal `{z}`, and every tile would ask for a group called "{z}".
  const group = spec.levels && spec.levels > 0 ? '&group={z}' : '';

  return `${serverUrl}/zarr/tiles/${TILE_MATRIX_SET}/{z}/{x}/{y}.png?${params}${group}`;
}
