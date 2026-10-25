/** A GeoJSON areal geometry, as kepler's editor and polygon filters keep it. */
export type ArealGeometry =
  { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };

/**
 * Parses the WKT an area variable carries back into a GeoJSON geometry.
 *
 * The inverse of `geoJsonToWkt`, for the other direction of the area
 * variable: a shared link, the browser's back button or another panel puts a
 * figure in the variable, and the map draws it. Reads POLYGON and
 * MULTIPOLYGON in any case and spacing, with an optional `SRID=…;` prefix
 * (EWKT, as PostGIS prints it); Z and M ordinates are dropped. Anything else,
 * EMPTY included, is null: the caller leaves the map alone rather than guess.
 */
export function wktToGeoJson(wkt: string): ArealGeometry | null {
  const text = wkt.trim().replace(/^SRID=\d+;\s*/i, '');
  const match = /^(MULTIPOLYGON|POLYGON)\s*(?:ZM|Z|M)?\s*(\(.*\))$/is.exec(text);
  if (!match) {
    return null;
  }
  const tree = parseLists(match[2]);
  if (tree === null) {
    return null;
  }
  if (match[1].toUpperCase() === 'POLYGON') {
    const polygon = polygonOf(tree);
    return polygon ? { type: 'Polygon', coordinates: polygon } : null;
  }
  if (!Array.isArray(tree) || tree.length === 0) {
    return null;
  }
  const polygons = tree.map(polygonOf);
  return polygons.every((p): p is number[][][] => p !== null) ? { type: 'MultiPolygon', coordinates: polygons } : null;
}

/** A parenthesised list: nested lists, or at the leaves the text of one position. */
type Node = Node[] | string;

/** `((1 2, 3 4), (…))` → `[['1 2', '3 4'], […]]`, or null when the brackets do not balance. */
function parseLists(text: string): Node | null {
  const stack: Node[][] = [];
  let root: Node[] | null = null;
  let token = '';
  const flush = () => {
    const position = token.trim();
    token = '';
    if (position) {
      stack[stack.length - 1]?.push(position);
    }
  };
  for (const char of text) {
    if (char === '(') {
      if (root !== null && stack.length === 0) {
        return null;
      }
      const list: Node[] = [];
      stack[stack.length - 1]?.push(list);
      stack.push(list);
      root ??= list;
    } else if (char === ')') {
      flush();
      if (!stack.pop()) {
        return null;
      }
    } else if (char === ',') {
      flush();
    } else {
      token += char;
    }
  }
  return stack.length === 0 && token.trim() === '' ? root : null;
}

/** One polygon's rings, or null when a ring is not a closed ring of finite positions. */
function polygonOf(node: Node): number[][][] | null {
  if (!Array.isArray(node) || node.length === 0) {
    return null;
  }
  const rings = node.map(ringOf);
  return rings.every((r): r is number[][] => r !== null) ? rings : null;
}

function ringOf(node: Node): number[][] | null {
  if (!Array.isArray(node)) {
    return null;
  }
  const ring: number[][] = [];
  for (const position of node) {
    if (typeof position !== 'string') {
      return null;
    }
    const [x, y] = position.split(/\s+/).map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    ring.push([x, y]);
  }
  const [first, last] = [ring[0], ring[ring.length - 1]];
  if (first && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]]);
  }
  // A closed ring needs at least a triangle: three corners plus the closure.
  return ring.length >= 4 ? ring : null;
}
