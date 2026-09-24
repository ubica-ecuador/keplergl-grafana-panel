// A `.css?raw` import is the stylesheet's text, which webpack reads through an
// `asset/source` rule jest does not have. No test looks at what MapLibre's
// stylesheet says, so an empty one is enough for the modules that scope it.
module.exports = '';
