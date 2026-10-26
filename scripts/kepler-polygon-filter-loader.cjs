/*
 * A webpack loader for @kepler.gl/utils' filter-utils.js: kepler's polygon
 * filter learns to cut the panel's own row layers.
 *
 * `getPolygonFilterFunctor` decides per layer whether a row is inside a drawn
 * figure, and it switches on `layer.type`: point, icon, arc, line, the grid
 * layers, H3, GeoJSON and heatmap. Every other type lands on `default` and
 * keeps every row, so a figure applied to the Symbols layer filtered nothing
 * while the point layer next to it was cut. The switch is inside kepler and
 * called from inside the same file (`computePolygonFilteredIndexByLayer`), so
 * nothing outside it can widen it; this adds one case to the `default` branch:
 * a layer that declares `polygonFilterByPosition` is tested exactly as the
 * point layer is, by the position its own `getPositionAccessor` reads.
 *
 * The text it replaces is checked, not assumed: a kepler release that moves it
 * fails the build here instead of quietly dropping the case.
 */

const FUNCTOR = 'getPolygonFilterFunctor = function getPolygonFilterFunctor(layer, filter, dataContainer) {';
const DEFAULT_BRANCH = /\n(\s*)default:\n(\s*)return function \(\) \{\n\s*return true;\n\s*\};/;

function patchPolygonFilter(source) {
  const start = source.indexOf(FUNCTOR);
  if (start < 0) {
    throw new Error('kepler-polygon-filter-loader: getPolygonFilterFunctor not found in filter-utils.js');
  }
  const head = source.slice(0, start);
  const body = source.slice(start);
  const match = DEFAULT_BRANCH.exec(body);
  if (!match) {
    throw new Error("kepler-polygon-filter-loader: getPolygonFilterFunctor's default branch has changed");
  }
  const [, caseIndent, bodyIndent] = match;
  const inner = `${bodyIndent}  `;
  const added = [
    `\n${caseIndent}default:`,
    `${bodyIndent}if (layer.polygonFilterByPosition) {`,
    `${inner}return function (data) {`,
    `${inner}  var pos = getPosition(data);`,
    `${inner}  return hasFiniteLngLat(pos) && isInPolygon(pos, filter.value);`,
    `${inner}};`,
    `${bodyIndent}}`,
  ].join('\n');
  return head + body.replace(DEFAULT_BRANCH, (branch) => added + branch.slice(`\n${caseIndent}default:`.length));
}

module.exports = function keplerPolygonFilterLoader(source) {
  return patchPolygonFilter(source);
};
module.exports.patchPolygonFilter = patchPolygonFilter;
