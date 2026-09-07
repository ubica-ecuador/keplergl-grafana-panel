// meshoptimizer ships its decoder as an ESM-only .mjs, and the jest transform
// provided by the Grafana scaffolding matches .js/.ts only — adding the package
// to transformIgnorePatterns therefore changes nothing. kepler pulls it in
// through @luma.gl/gltf at import time; no jest test decodes a glTF mesh, so an
// empty module is enough. A test that ever does will fail loudly here rather
// than at import.
module.exports = {};
