// parquet-wasm ships only an ESM build with a .wasm binary, which jest cannot
// load. kepler's file-handler pulls it in at import time through
// @loaders.gl/parquet; no jest test parses parquet files, so an empty module is
// enough. A test that ever does will fail loudly here rather than at import.
module.exports = {};
