import { DataFrame, FieldType } from '@grafana/data';

/**
 * Which column plays which part in a geospatial dataset.
 *
 * Values are field names, not indices, so a mapping stays valid when a query is
 * edited and the column order changes.
 */
export interface FieldRoles {
  latitude?: string;
  longitude?: string;
  time?: string;
  tripId?: string;
  /** Optional third dimension for trip paths; defaults to 0 when unmapped. */
  altitude?: string;
  geometry?: string;
  h3?: string;
  /**
   * A place given by something other than coordinates: a geohash, decoded to
   * its cell's centre, or a name or code looked up in a gazetteer (the panel's
   * `gazetteer` option). Geomap's two other location modes; see `placeLookup.ts`.
   * Used only when the query has no latitude and longitude of its own.
   */
  geohash?: string;
  lookup?: string;
  /** Origin/destination pairs feeding the flow layer. */
  originLat?: string;
  originLng?: string;
  destLat?: string;
  destLng?: string;
  originH3?: string;
  destH3?: string;
  count?: string;
  /**
   * A velocity field, given either as components or as speed plus
   * meteorological direction. Both pairs are all-or-nothing: half of one
   * describes nothing.
   */
  u?: string;
  v?: string;
  speed?: string;
  direction?: string;
  /**
   * A bearing to turn a symbol by, and a number to size it.
   *
   * Separate from {@link direction} and {@link speed}, which name a *wind* and
   * carry the meteorological convention with them. These two name any table
   * with something that points and something that measures: a vehicle, a vessel,
   * an aircraft.
   */
  rotation?: string;
  magnitude?: string;
  /**
   * A link to a cloud-optimised GeoTIFF, which is drawn as raster tiles rather
   * than as rows. One url per query — the first row wins.
   */
  rasterUrl?: string;
  /**
   * A link to the STAC item the imagery belongs to, when the query knows it.
   *
   * Beside `rasterUrl` rather than instead of it: the item is what a false
   * colour composite needs — the bands live in separate COGs it points at —
   * while the composed image `rasterUrl` names stays the fast path for true
   * colour. A query that offers only the first keeps today's behaviour.
   */
  rasterItemUrl?: string;
  /**
   * How to draw this query's raster: its colour ramp, its band combination,
   * and whether the tile server paints it.
   *
   * The panel options Raster colour ramp, Raster bands and Let the tile server
   * paint remain the fallback, one value for every raster the panel holds. What
   * the query adds is that two rasters on one map can differ: a classified land
   * cover the server paints from the file's own palette, under imagery the
   * browser colours with a ramp. A band combination is one of the ids the
   * Raster bands option offers (`BAND_COMBINATIONS`), so `'$bands' AS
   * raster_bands` lets a dashboard variable drive it; `raster_painted` reads
   * true or false, 1 or 0, yes or no. Like the Zarr pair, the first row with a
   * value wins.
   */
  rasterColormap?: string;
  rasterBands?: string;
  rasterPainted?: string;
  /**
   * How the tile server paints the raster, as its query parameters
   * (`bidx=1&colormap_name=viridis`, `rescale=0,3000&colormap=…`): what a
   * catalog says of the file, from the Spatial Catalog's Raster query. A query
   * that gives one is drawn painted unless its `raster_painted` says no, and
   * its keys win over the panel's for the same key. The first row with a
   * value wins.
   */
  rasterPaint?: string;
  /**
   * When each scene of a raster series stops being the picture: a yearly map lasts its year. With it a scene is in
   * the map's time window when its span touches the window, not only when its start falls inside.
   */
  rasterEnd?: string;
  /**
   * The pieces of one moment of a raster series: rows that share a value are one scene (the tiles of one satellite
   * pass), which a server-painted raster draws together; and where each piece lies, `west,south,east,north`.
   */
  rasterGroup?: string;
  rasterBbox?: string;
  /**
   * A WMS service and the one layer of it to draw.
   *
   * Both are needed: a service publishes many layers and nothing in the query
   * says which one is meant, so a url on its own is not a picture. The service
   * renders the imagery itself, which is why no tile server appears here.
   */
  wmsUrl?: string;
  wmsLayer?: string;
  /**
   * Which of the styles the WMS publishes for that layer to draw it with: the
   * `STYLES` of every GetMap and GetFeatureInfo, so a click answers for the
   * picture shown. Empty, or no column, is the service's default style. Read
   * from the row that names the service, like the layer.
   */
  wmsStyle?: string;
  /**
   * Where the legend of a WMS layer or an ArcGIS service is: a picture (a WMS
   * `LegendURL`, a GetLegendGraphic), or an ArcGIS REST `legend?f=json`, whose
   * swatches and labels the map draws itself (`serviceLegend.ts`). Drawn over
   * the map while the layer is shown.
   */
  legendUrl?: string;
  /**
   * A WMS or tile layer's box, `"west south east north"` in degrees: where the
   * map frames the layer and the part of its picture it draws (`parseWmsBox`).
   */
  tilesBbox?: string;
  /**
   * An ArcGIS Image Service, and the rules that say what to draw from it.
   *
   * Not a file but a **mosaic dataset**: a catalogue of rasters, a rule for
   * choosing between them, and a pyramid over the whole thing. That is what
   * lets one url answer for any extent at any zoom, where a COG collection cut
   * into 200 files needs one query per file.
   *
   * The mosaic rule is how a year is chosen — the same JSON the land-cover
   * dashboard already sends to `computeHistograms` — and the rendering rule how
   * it is drawn. Both are the service's own vocabulary, passed through
   * untouched rather than modelled here.
   */
  esriUrl?: string;
  esriMosaicRule?: string;
  esriRenderingRule?: string;
  /**
   * Map tiles a query points at: a `{z}/{x}/{y}` template or a PMTiles archive,
   * what the tiles are (`raster`, `mvt` or `pmtiles`), the zoom levels the
   * service has, and the service's own name for each level when it is not the
   * number (a WMTS's tile matrices: PDOK's are "00" to "19"), as
   * `"z:name,z:name"`. The Spatial Catalog's Services frame gives every map
   * service that is not a WMS in these columns (`xyzDataset.ts`). The
   * metadata url is where vector tiles describe themselves: a TileJSON, or the
   * PMTiles archive itself.
   */
  tilesUrl?: string;
  tilesFormat?: string;
  tilesMetadataUrl?: string;
  tilesMinZoom?: string;
  tilesMaxZoom?: string;
  tilesZoomIds?: string;
  /**
   * A Zarr store, the one array of it to draw, and — when that array has a time
   * axis — the exact index label of each moment.
   *
   * The label is a separate role rather than a rendering of {@link time}
   * because TiTiler hands it to xarray's `.sel`, which matches exactly and
   * offers no nearest-neighbour fallback: a store stamped at 09:00 rejects the
   * date-only spelling of its own timestamps.
   */
  zarrUrl?: string;
  zarrVariable?: string;
  zarrTimeLabel?: string;
  /**
   * How many levels the store's `multiscales` pyramid has, and which slice to
   * pin on every non-spatial axis other than time.
   *
   * Both come from the query rather than from the store because reading them
   * means fetching the store's metadata, and that is a request the panel would
   * make on every render to learn something a dashboard author already knows.
   */
  zarrLevels?: string;
  zarrSel?: string;
  /**
   * Which axis of the store the map's clock walks. Defaults to `time`.
   *
   * Named because a climate store often holds its temporal axis as something
   * else entirely — twelve months as `month=1..12`, integers rather than dates.
   * The clock still walks it; the query says which axis and what each moment is
   * called there.
   */
  zarrTimeDim?: string;
  /**
   * How to colour this variable, and the range to stretch it over.
   *
   * Both exist as panel options too, and those remain the fallback. What the
   * query adds is that a panel drawing two stores can style each of them: the
   * panel option is one value for every layer it holds, and two variables in
   * one panel hold different physical units. A range that suits an aerosol
   * depth of 0 to 1 leaves a field of kelvin flat — a uniform sheet, which
   * reads as bad data rather than as bad styling.
   *
   * The ramp takes a name or a whole ramp as TiTiler's interval JSON, the same
   * two spellings the panel option takes.
   */
  zarrColormap?: string;
  zarrRescale?: string;
}

/**
 * A user's answer for a role: a column name, or `null` for "use no column".
 *
 * Three states matter, and only two of them fit in `FieldRoles`: a role can be
 * autodetected (key absent), pointed at a column, or deliberately switched off.
 * Without the third, a query carrying a trip id could never be drawn as points —
 * clearing the field just handed the role back to autodetection.
 */
export type FieldRoleOverrides = Partial<Record<keyof FieldRoles, string | null>>;

/**
 * Applies a user's overrides to the autodetected roles.
 *
 * Roles switched off are removed outright, so everything downstream keeps
 * working with plain `string | undefined` and no notion of a disabled role.
 */
export function resolveRoles(detected: FieldRoles, overrides: FieldRoleOverrides | undefined): FieldRoles {
  const roles: FieldRoles = { ...detected };

  for (const [role, column] of Object.entries(overrides ?? {})) {
    const key = role as keyof FieldRoles;
    if (column === null) {
      delete roles[key];
    } else if (column) {
      roles[key] = column;
    }
  }

  return roles;
}

/**
 * Candidate column names per role, matched case-insensitively and exactly.
 *
 * Exact matching is deliberate: substring matching would make `origin_lat`
 * satisfy `lat` and silently turn an origin/destination table into a plain
 * point layer.
 *
 * `altitude` has no candidates on purpose. GPS traces routinely carry an
 * `elevation` column holding metres above sea level, and deck.gl reads the third
 * coordinate as height above the ground: a trail through Cuenca at 2,650 m is
 * drawn 2.65 km up, so it disappears the moment the camera descends below it —
 * roughly zoom 15. The layer looks fine zoomed out and vanishes zoomed in, which
 * reads as a rendering bug rather than as a mapping choice. Height on a trip
 * path is therefore opt-in through the field mapping editor.
 */
export const NAME_CANDIDATES: Record<string, string[]> = {
  latitude: ['latitude', 'lat', 'y'],
  longitude: ['longitude', 'lon', 'lng', 'long', 'x'],
  tripId: ['trip_id', 'tripid', 'track_id', 'trackid', 'trajectory_id', 'vehicle_id', 'journey_id'],
  // `altitude` is deliberately absent: see the note below.
  geometry: ['geom', 'geometry', 'the_geom', 'wkb_geometry', 'geojson', 'wkt', 'shape'],
  h3: ['h3', 'h3_index', 'hex_id', 'hexagon', 'h3index'],
  // The names Geomap's automatic location reads.
  geohash: ['geohash'],
  lookup: ['lookup'],
  // Wind. `ugrd`/`vgrd` are the GRIB2 short names GFS ships, so a table loaded
  // straight from a GRIB conversion is recognised without renaming anything.
  u: ['u', 'u10', 'u_wind', 'wind_u', 'ugrd', 'u_component'],
  v: ['v', 'v10', 'v_wind', 'wind_v', 'vgrd', 'v_component'],
  speed: ['wind_speed', 'windspeed', 'wind_speed_10m', 'speed', 'ws'],
  direction: ['wind_direction', 'winddirection', 'wind_direction_10m', 'direction', 'wind_dir', 'wd'],
  // Anything that points. `direction` is deliberately absent: it belongs to the
  // wind roles, and a column called that is read with the meteorological
  // convention when a wind speed sits beside it (see `buildSymbolLayer`).
  //
  // `cog` (course over ground) appears here and also in rasterUrl — the one
  // name two roles share on purpose, allowlisted in `detectFields.test.ts`. The
  // two readings exclude each other by type: the raster reader drops values that
  // are not strings, and a symbol layer is built only from a numeric bearing.
  rotation: ['bearing', 'heading', 'course', 'cog', 'track', 'azimuth', 'orientation'],
  magnitude: ['magnitude', 'intensity', 'amplitude'],
  originLat: ['origin_lat', 'origin_latitude', 'from_lat', 'start_lat', 'source_lat', 'pickup_lat', 'lat0'],
  originLng: [
    'origin_lon',
    'origin_lng',
    'origin_long',
    'origin_longitude',
    'from_lon',
    'from_lng',
    'start_lon',
    'start_lng',
    'source_lon',
    'source_lng',
    'pickup_lon',
    'pickup_lng',
    'lng0',
    'lon0',
  ],
  destLat: ['dest_lat', 'dest_latitude', 'destination_lat', 'to_lat', 'end_lat', 'target_lat', 'dropoff_lat', 'lat1'],
  destLng: [
    'dest_lon',
    'dest_lng',
    'dest_long',
    'dest_longitude',
    'destination_lon',
    'destination_lng',
    'to_lon',
    'to_lng',
    'end_lon',
    'end_lng',
    'target_lon',
    'target_lng',
    'dropoff_lon',
    'dropoff_lng',
    'lng1',
    'lon1',
  ],
  originH3: ['origin_h3', 'source_h3', 'from_h3', 'h3_0'],
  destH3: ['dest_h3', 'target_h3', 'to_h3', 'h3_1'],
  // `magnitude` is deliberately absent: it is now a rotation/magnitude role, and a
  // column literally named `magnitude` must land in one role only. If a query's
  // weight column happens to be named that, the user can map it by hand in the
  // field mapping editor rather than silently breaking the size channel bind.
  count: ['count', 'trips', 'weight', 'flow', 'total', 'volume'],
  // Raster. `asset_href` and `href` are what a STAC asset is called in the
  // catalogue's own JSON, so a query that lifts the asset straight out of a
  // search response needs no aliasing.
  rasterUrl: ['raster_url', 'cog_url', 'cog', 'asset_href', 'href'],
  rasterItemUrl: ['raster_item_url', 'stac_item_url', 'item_url'],
  rasterColormap: ['raster_colormap', 'raster_ramp'],
  rasterBands: ['raster_bands', 'band_combination'],
  rasterPainted: ['raster_painted'],
  rasterPaint: ['raster_paint'],
  rasterEnd: ['raster_end', 'end_datetime'],
  rasterGroup: ['raster_group'],
  rasterBbox: ['raster_bbox'],
  // WMS. `wms` alone is worth accepting because a query that fixes the service
  // by hand reads better as `SELECT '…' AS wms`, and `service_url` is what the
  // OGC calls the endpoint.
  wmsUrl: ['wms_url', 'wms', 'service_url'],
  wmsLayer: ['wms_layer', 'layer', 'layer_name'],
  // Not `style` alone: a table of buildings or of anything drawn has a column
  // called that about the row (OpenStreetMap's architectural `style`), and
  // read as a WMS style it would ask the service for a style it does not have.
  wmsStyle: ['wms_style', 'wms_styles'],
  // Not `legend` alone either, which a table uses for a label of the row.
  legendUrl: ['legend_url', 'legend_graphic_url'],
  // `tiles_bbox` is what the Spatial Catalog's Services frame calls it, for a
  // WMS and for tiles alike. Not `bbox` alone: that is a column of any table
  // of places, about the row.
  tilesBbox: ['tiles_bbox', 'wms_bbox'],
  // ArcGIS Image Service. Deliberately narrow: `esri` alone is not accepted,
  // because an ArcGIS shop has columns called that about anything.
  esriUrl: ['esri_url', 'image_service_url', 'imageserver_url'],
  esriMosaicRule: ['esri_mosaic_rule', 'mosaic_rule'],
  esriRenderingRule: ['esri_rendering_rule', 'rendering_rule'],
  // Map tiles, by the Spatial Catalog's names. Deliberately narrow: `url`,
  // `tiles` and `format` are words any table uses.
  tilesUrl: ['tiles_url', 'xyz_url'],
  tilesFormat: ['tiles_format'],
  tilesMetadataUrl: ['tiles_metadata_url'],
  tilesMinZoom: ['tiles_min_zoom'],
  tilesMaxZoom: ['tiles_max_zoom'],
  tilesZoomIds: ['tiles_zoom_ids'],
  // Zarr. Deliberately narrow: `variable` on its own is an ordinary column name
  // in any long-format table, and claiming it would read a frame of unrelated
  // measurements as a Zarr store.
  zarrUrl: ['zarr_url', 'zarr', 'store_url'],
  zarrVariable: ['zarr_variable', 'zarr_var'],
  zarrTimeLabel: ['zarr_time_label', 'zarr_label'],
  zarrLevels: ['zarr_levels', 'zarr_pyramid'],
  zarrSel: ['zarr_sel', 'zarr_select'],
  zarrTimeDim: ['zarr_time_dim', 'zarr_dim'],
  zarrColormap: ['zarr_colormap', 'zarr_ramp'],
  zarrRescale: ['zarr_rescale', 'zarr_range'],
};

/**
 * Infers field roles from a DataFrame by column name and type.
 *
 * This is only ever a starting point: the panel's field mapping editor lets the
 * user override every role. Detection deliberately accepts a wide set of names
 * so that an unrecognised column is a dropdown rather than a query rewrite.
 */
/**
 * The column a frame says its clock is (`meta.custom.timeField`, as the
 * Spatial Catalog data source writes it): a name, `null` when its dates are
 * no clock, or undefined when it says nothing.
 */
export function frameTimeField(frame: DataFrame): string | null | undefined {
  const custom = frame.meta?.custom as { timeField?: unknown } | undefined;
  if (!custom || !('timeField' in custom)) {
    return undefined;
  }
  return typeof custom.timeField === 'string' && custom.timeField ? custom.timeField : null;
}

/**
 * The pair a frame's rows are in force by (`meta.custom.timeInterval`, `{ start, end }`, as the Spatial Catalog
 * data source writes it for a Valid until or an Iceberg table's whole history), when it names two of its columns.
 */
export function frameTimeInterval(frame: DataFrame): { start: string; end: string } | null {
  const pair = (frame.meta?.custom as { timeInterval?: { start?: unknown; end?: unknown } } | undefined)?.timeInterval;
  const names = new Set(frame.fields.map((f) => f.name));
  return pair &&
    typeof pair.start === 'string' &&
    typeof pair.end === 'string' &&
    pair.start !== pair.end &&
    names.has(pair.start) &&
    names.has(pair.end)
    ? { start: pair.start, end: pair.end }
    : null;
}

export function detectFields(frame: DataFrame): FieldRoles {
  const roles: FieldRoles = {};

  for (const [role, candidates] of Object.entries(NAME_CANDIDATES)) {
    const match = findByName(frame, candidates);
    if (match) {
      roles[role as keyof FieldRoles] = match;
    }
  }

  // Time is found by type rather than by name: Grafana already knows which
  // column is temporal, and dashboards name it anything from `time` to
  // `recorded_at` to `__timestamp`. A frame that names its clock is taken at
  // its word (`frameTimeField`): that column, or none at all — a layer's dates
  // that are not when anything happened (a record's last update) are no clock.
  // A raster series' end is not its time.
  const named = frameTimeField(frame);
  const timeFields = frame.fields.filter((f) => f.type === FieldType.time);
  const timeField =
    named === undefined
      ? (timeFields.find((f) => f.name !== roles.rasterEnd) ?? timeFields[0])
      : named === null
        ? undefined
        : timeFields.find((f) => f.name === named);
  if (timeField) {
    roles.time = timeField.name;
  }

  // A count is a flow's weight, which the flow layer reads by kepler's name for
  // it: a column with the role reaches kepler renamed `count`
  // (toKeplerDataset.ts). Anywhere else the column keeps the query's name, so a
  // pipe's `flow`, a sensor's `total` or a heatmap's `weight` is where the
  // layers and the panel's options that name it look for it.
  if (!describesFlow(roles)) {
    delete roles.count;
  }

  return roles;
}

/**
 * Whether the roles describe origin–destination flows: both ends, by latitude
 * and longitude or by H3 cell. What `buildFlows` draws, and the only query whose
 * count the panel renames.
 */
export function describesFlow(roles: FieldRoles): boolean {
  return Boolean(
    (roles.originH3 && roles.destH3) || (roles.originLat && roles.originLng && roles.destLat && roles.destLng)
  );
}

/**
 * The column a map saved by 1.7.0 or earlier knew as `count` on a query that is
 * no flow: a column named like a count (`trips`, `weight`, `flow`, `total`,
 * `volume`), which those versions renamed `count` on every query. Not one named
 * `count` already, which needs no rename.
 */
export function legacyCountColumn(frame: DataFrame): string | undefined {
  const column = findByName(frame, NAME_CANDIDATES.count);
  return column && column.toLowerCase() !== 'count' ? column : undefined;
}

function findByName(frame: DataFrame, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const field = frame.fields.find((f) => f.name.toLowerCase() === candidate);
    if (field) {
      return field.name;
    }
  }
  return undefined;
}
