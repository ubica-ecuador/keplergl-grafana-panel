/**
 * How a map asks a features service for what is over its view: an OGC API Features collection's items, a WFS's
 * GetFeature or an ArcGIS layer's query, each for an area, a time range and a limit, all answering GeoJSON that
 * kepler loads by its address.
 *
 * The catalog's data source gives each features entry its address without area, time or limit (`items_href`), and
 * how it is asked (`feature_protocol`); this adds the rest, and reads it back off an address, since kepler keeps
 * nothing of a file dataset but its address.
 *
 * - OGC API: `bbox`, `datetime`, `limit`.
 * - WFS: `BBOX` in `urn:ogc:def:crs:EPSG::4326`, latitude first as that system has it, and `COUNT` (`MAXFEATURES`
 *   in 1.1). A WFS has no time parameter: a time range is a filter on the entry's time property, and as `BBOX` and
 *   `FILTER` cannot go together, the area goes into the filter too.
 * - ArcGIS: `geometry` as an envelope in degrees, `time` in milliseconds, `resultRecordCount`.
 */

export type FeatureProtocol = 'ogc-features' | 'wfs' | 'arcgis' | 'socrata';

export type Area = [number, number, number, number];

/** What a features request is made of before its area, time and limit. */
export interface FeatureTarget {
  protocol: FeatureProtocol;
  /** The address without area, time or limit. */
  itemsHref: string;
  /** WFS: the property a time range is kept to; ArcGIS: the layer's time field (any: it has time). */
  timeProperty?: string | null;
  /** Socrata: the geometry column an area is asked on (`shape:<name>` when it is not points). */
  geometryField?: string;
}

/** A request read back off its address: its target, and the area, time and limit it asked. */
export interface ReadRequest {
  target: FeatureTarget;
  bbox: Area | null;
  time: boolean;
  limit: number | null;
}

/** A parameter of an address whatever its case, as WFS parameters are. */
function param(url: URL, name: string): string | null {
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return value;
    }
  }
  return null;
}

/** Drops parameters whatever their case. */
function drop(url: URL, names: string[]): void {
  for (const key of [...url.searchParams.keys()]) {
    if (names.includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
}

const iso = (t: number) => new Date(t).toISOString();
const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A WFS filter over an area (when given) and a time range: FES 2.0, or Filter 1.1 for a WFS 1.1. */
function wfsFilter(version: string, area: Area | null, range: { from: number; to: number }, property: string): string {
  const v2 = !version.startsWith('1.');
  const f = v2 ? 'fes' : 'ogc';
  const ns = v2
    ? 'xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gml="http://www.opengis.net/gml/3.2"'
    : 'xmlns:ogc="http://www.opengis.net/ogc" xmlns:gml="http://www.opengis.net/gml"';
  const ref = v2 ? 'ValueReference' : 'PropertyName';
  const box = area
    ? `<${f}:BBOX><gml:Envelope srsName="urn:ogc:def:crs:EPSG::4326">` +
      `<gml:lowerCorner>${area[1]} ${area[0]}</gml:lowerCorner><gml:upperCorner>${area[3]} ${area[2]}</gml:upperCorner>` +
      `</gml:Envelope></${f}:BBOX>`
    : '';
  const compare = (op: string, t: number) =>
    `<${f}:${op}><${f}:${ref}>${xml(property)}</${f}:${ref}><${f}:Literal>${iso(t)}</${f}:Literal></${f}:${op}>`;
  return (
    `<${f}:Filter ${ns}><${f}:And>${box}` +
    compare('PropertyIsGreaterThanOrEqualTo', range.from) +
    compare('PropertyIsLessThanOrEqualTo', range.to) +
    `</${f}:And></${f}:Filter>`
  );
}

/**
 * The address of a features request: the target's, with the area, the time range (null: none asked, as for a
 * collection without time) and the limit.
 */
export function featureRequestUrl(
  target: FeatureTarget,
  area: Area | null,
  range: { from: number; to: number } | null,
  limit: number
): string {
  const url = new URL(target.itemsHref);
  if (target.protocol === 'wfs') {
    const version = param(url, 'VERSION') ?? '2.0.0';
    url.searchParams.set(version.startsWith('1.') ? 'MAXFEATURES' : 'COUNT', String(limit));
    if (range && target.timeProperty) {
      url.searchParams.set('FILTER', wfsFilter(version, area, range, target.timeProperty));
    } else if (area) {
      url.searchParams.set('BBOX', `${area[1]},${area[0]},${area[3]},${area[2]},urn:ogc:def:crs:EPSG::4326`);
    }
    return url.toString();
  }
  if (target.protocol === 'socrata') {
    // SoQL: points within a box, shapes that intersect it; the date column in the time range.
    const field = target.geometryField ?? '';
    const parts: string[] = [];
    if (area && field) {
      const [w, s, e, n] = area;
      parts.push(
        field.startsWith('shape:')
          ? `intersects(${field.slice(6)}, 'POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))')`
          : `within_box(${field}, ${n}, ${w}, ${s}, ${e})`
      );
    }
    if (range && target.timeProperty) {
      const floating = (t: number) => iso(t).replace(/\.\d+Z$/, '');
      parts.push(`${target.timeProperty} between '${floating(range.from)}' and '${floating(range.to)}'`);
    }
    if (parts.length) {
      url.searchParams.set('$where', parts.join(' AND '));
    }
    url.searchParams.set('$limit', String(limit));
    return url.toString();
  }
  if (target.protocol === 'arcgis') {
    if (area) {
      url.searchParams.set('geometry', area.join(','));
    }
    if (range) {
      url.searchParams.set('time', `${Math.round(range.from)},${Math.round(range.to)}`);
    }
    url.searchParams.set('resultRecordCount', String(limit));
    return url.toString();
  }
  if (area) {
    url.searchParams.set('bbox', area.join(','));
  }
  if (range) {
    url.searchParams.set('datetime', `${iso(range.from)}/${iso(range.to)}`);
  }
  url.searchParams.set('limit', String(limit));
  return url.toString();
}

const box = (values: number[]): Area | null =>
  values.length === 4 && values.every(Number.isFinite) ? (values as Area) : null;
const count = (value: string | null) => {
  const n = Number(value);
  return value !== null && Number.isFinite(n) && n > 0 ? n : null;
};

/** A features request read back off its address, or null when the address is none (not a URL). */
export function readFeatureRequest(source: string): ReadRequest | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (param(url, 'REQUEST')?.toLowerCase() === 'getfeature') {
    const filter = param(url, 'FILTER') ?? '';
    const corner = (name: string) =>
      (new RegExp(`<gml:${name}>([^<]*)</gml:${name}>`).exec(filter)?.[1] ?? '').trim().split(/\s+/).map(Number);
    const [s, w] = corner('lowerCorner');
    const [n, e] = corner('upperCorner');
    const bboxParam = (param(url, 'BBOX') ?? '').split(',').slice(0, 4).map(Number);
    const property = /<(?:fes:ValueReference|ogc:PropertyName)>([^<]*)</.exec(filter)?.[1] ?? null;
    const limit = count(param(url, 'COUNT') ?? param(url, 'MAXFEATURES'));
    drop(url, ['bbox', 'filter', 'count', 'maxfeatures', 'startindex']);
    return {
      target: { protocol: 'wfs', itemsHref: url.toString(), timeProperty: property },
      bbox: filter
        ? box([w, s, e, n])
        : box(bboxParam.length === 4 ? [bboxParam[1], bboxParam[0], bboxParam[3], bboxParam[2]] : []),
      time: property !== null,
      limit,
    };
  }
  if (/\/resource\/[\w-]+\.geojson$/.test(url.pathname)) {
    const where = url.searchParams.get('$where') ?? '';
    const point = /within_box\((\w+),\s*([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+)\)/.exec(where);
    const shape =
      /intersects\((\w+),\s*'POLYGON\(\(([-\d.e]+) ([-\d.e]+),\s*([-\d.e]+) [-\d.e]+,\s*[-\d.e]+ ([-\d.e]+)/.exec(
        where
      );
    const dated = /(\w+) between '/.exec(where);
    const limit = count(url.searchParams.get('$limit'));
    drop(url, ['$where', '$limit', '$offset']);
    return {
      target: {
        protocol: 'socrata',
        itemsHref: url.toString(),
        timeProperty: dated?.[1] ?? null,
        geometryField: point ? point[1] : shape ? `shape:${shape[1]}` : '',
      },
      // within_box(field, north, west, south, east); the polygon's first corner is west, south.
      bbox: point
        ? box([Number(point[3]), Number(point[4]), Number(point[5]), Number(point[2])])
        : shape
          ? box([Number(shape[2]), Number(shape[3]), Number(shape[4]), Number(shape[5])])
          : null,
      time: Boolean(dated),
      limit,
    };
  }
  if (/\/query\/?$/.test(url.pathname) && url.searchParams.get('f') === 'geojson') {
    const bbox = box((url.searchParams.get('geometry') ?? '').split(',').map(Number));
    const time = url.searchParams.has('time');
    const limit = count(url.searchParams.get('resultRecordCount'));
    drop(url, ['geometry', 'time', 'resultrecordcount', 'resultoffset']);
    return { target: { protocol: 'arcgis', itemsHref: url.toString(), timeProperty: null }, bbox, time, limit };
  }
  const bbox = box((url.searchParams.get('bbox') ?? '').split(',').map(Number));
  const time = url.searchParams.has('datetime');
  const limit = count(url.searchParams.get('limit'));
  for (const name of ['bbox', 'datetime', 'limit']) {
    url.searchParams.delete(name);
  }
  return { target: { protocol: 'ogc-features', itemsHref: url.toString(), timeProperty: null }, bbox, time, limit };
}
