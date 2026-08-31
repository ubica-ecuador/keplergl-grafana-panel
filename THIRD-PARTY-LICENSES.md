# Third-party licences

`ubica-keplergl-panel` is licensed under Apache-2.0 (see `LICENSE`). The published archive bundles
compiled third-party code and vendored assets. Their notices follow.

## Bundled libraries

| Library | Version | Licence | Copyright |
| --- | --- | --- | --- |
| kepler.gl and its `@kepler.gl/*` packages | 3.3.0-alpha.7 | MIT | Copyright contributors to the kepler.gl project |
| @deck.gl/core, /layers, /geo-layers and the rest | 9.3.10 | MIT | Copyright Vis.gl contributors. |
| @luma.gl/core and the rest | 9.3.6 | MIT | Copyright (c) 2020 vis.gl contributors |
| @deck.gl-community/editable-layers | 9.3.8 | MIT | Copyright (c) 2020 vis.gl a Series of LF Projects, LLC |
| @flowmap.gl/data, @flowmap.gl/layers | 9.4.0 | Apache-2.0 | See the package's own LICENSE |
| @hubble.gl/react, @hubble.gl/core | 2.0.0-alpha.4 | MIT | Copyright (c) 2021 Uber Technologies, Inc.; Copyright Vis.gl contributors. |
| react-palm | 3.3.11 | MIT | Copyright (c) 2019 Brian Ford |
| styled-components | 6.4.3 | MIT | Copyright (c) 2016-present Glen Maddern and Maximilian Stoiber |
| @loaders.gl/core and the rest (25+ sub-packages) | 4.4.1 – 4.4.4 | MIT | Copyright (c) vis.gl contributors |
| @math.gl/core, /web-mercator, /culling and the rest | 4.1.0 | MIT | Copyright (c) 2017 Uber Technologies, Inc. |
| @probe.gl/log, /env, /stats | 4.1.1 | MIT | Copyright Vis.gl contributors. |
| mjolnir.js | 3.0.1 | MIT | Copyright (c) 2017 Uber Technologies, Inc. |
| react-map-gl | 8.1.2 | MIT | Copyright Vis.gl contributors. |
| @vis.gl/react-maplibre | 8.1.1 | MIT | Copyright Vis.gl contributors. |
| mapbox-gl (the 1.13.1 copy nested under `@kepler.gl/utils`) | 1.13.1 | BSD-3-Clause | Copyright (c) 2020, Mapbox |
| lodash, lodash-es | 4.17.21, 4.18.1 | MIT | Copyright OpenJS Foundation and other contributors \<https://openjsf.org/\> |
| d3-array, d3-axis, d3-brush, d3-color, d3-dispatch, d3-drag, d3-dsv, d3-format, d3-geo, d3-interpolate, d3-path, d3-scale, d3-scale-chromatic, d3-selection, d3-shape, d3-time, d3-time-format, d3-timer, d3-transition (19 packages) | 3.0.0 – 4.1.0 | ISC | Copyright 2010–20XX Mike Bostock (end year varies by package/release, holder and licence text identical) |
| d3-ease | 3.0.1 | BSD-3-Clause | Copyright 2010-2021 Mike Bostock; Copyright 2001 Robert Penner |

`lodash` is the single heaviest package in the bundle by sourcemap reference count (1051, ahead of
`@kepler.gl/components` at 421); `lodash-es`'s `LICENSE` is byte-identical to `lodash`'s, confirmed by
`diff`, so both ship under one row. The nineteen ISC `d3-*` packages above share one licence text
verbatim (confirmed by diffing each against `d3-array/LICENSE` with the copyright line stripped) —
except that `d3-geo`'s `LICENSE` additionally embeds a separate MIT-style notice for a bundled
GeographicLib excerpt ("Copyright 2008-2012 Charles Karney"), and `d3-scale-chromatic`'s additionally
embeds an Apache-style notice for its ColorBrewer color data ("Copyright 2002 Cynthia Brewer, Mark
Harrower, and The Pennsylvania State University") — the same colorbrewer text `chroma-js`'s own copy
carries and that is already reproduced in `LICENSE.txt`'s chroma.js banner, but attached here to a
different, separately-licensed package's own file, so it is named rather than assumed covered. Neither
embeds a standalone `NOTICE` file, so they are called out here rather than in the Apache NOTICE
section below. `d3-ease` is not part of the ISC family at all: its own `LICENSE` is BSD-3-Clause with
a second copyright holder (Robert Penner, for the original easing equations), confirmed by reading it
in full, not by its filename resembling its siblings'.

Every line above was read from that package's own `LICENSE` file in `node_modules` on 2026-08-31. The
`@kepler.gl/*` packages published to npm do not ship a `LICENSE` file individually; their notice is
confirmed instead by the `// SPDX-License-Identifier: MIT` / `// Copyright contributors to the
kepler.gl project` header carried in their own compiled output, and by `node_modules/kepler.gl/LICENSE`
for the project as a whole. Re-read them if the versions have moved — several of these differ from
what one would guess (kepler and deck.gl both attribute to contributors rather than to a company, and
within the loaders.gl/math.gl/probe.gl family the copyright line is not even uniform: math.gl and
mjolnir.js still say "Uber Technologies, Inc.", loaders.gl says "vis.gl contributors" in lower case,
and probe.gl / react-map-gl / @vis.gl/react-maplibre say "Vis.gl contributors" with a capital V — each
was read from its own file rather than assumed from its neighbours).

`mapbox-gl` is the only package name in this table with two unrelated copies historically in the
dependency tree: a top-level 3.28.1 under Mapbox's proprietary Terms of Service, and this 1.13.1
BSD-3-Clause copy nested under `@kepler.gl/utils`. The 3.28.1 copy is excluded from the build (see
`webpack.config.ts`); only the 1.13.1 copy above ships, in `dist/32.js`.

The full text of the MIT and Apache-2.0 licences is in `LICENSE.txt` alongside this file, along with
whatever smaller packages' notices survived terser's banner extraction — but that extraction is a
coincidence of authoring style (only packages that wrote their notice as a `/*!` or `@license`
comment show up there), not a completeness guarantee, and it does not cover everything absent from
the table above. A row above was earned by one of three things: real weight in the compiled bundle
(measured as source-file count in `dist/*.js.map` — the threshold that pulled in `lodash`, `d3-*`,
and the loaders.gl/math.gl/probe.gl/mjolnir.js/react-map-gl family even though most of their
copyright lines are unsurprising), an Apache-2.0 `NOTICE`-file obligation (the next section), or a
copyright line a reader would not have guessed from the package name alone. Beneath that line is a
long tail of smaller, single-author or single-foundation MIT/BSD/ISC utility and UI packages that are
genuinely bundled but not individually named here or in `LICENSE.txt` — `@babel/runtime`,
`@popperjs/core`, `react-color`, `react-virtualized`, the date/time-picker family, and dozens more.
That is a recorded scope decision, not an oversight: this document exists to carry the notices for
the code that dominates the bundle, not to reproduce `package-lock.json` in prose.

## Apache NOTICE files

Apache-2.0 §4(d) requires an included `NOTICE` file's content to be reproduced in derivative
distributions. Of the Apache-2.0-licensed packages that ship in this bundle, two carry a `NOTICE`
file; the rest do not (checked directly in `node_modules/<pkg>/`, package by package, on 2026-08-31):

**apache-arrow** (21.2.0), `node_modules/apache-arrow/NOTICE.txt`:

```
Apache Arrow JavaScript
Copyright 2017-2025 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (http://www.apache.org/).
```

**h3-js** (4.5.0), `node_modules/h3-js/NOTICE`:

```
Copyright 2017-2021 Uber Technologies, Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

`@flowmap.gl/data`, `@flowmap.gl/layers`, `long` and `a5-js` are also Apache-2.0 and bundled, but none
of the four ships a `NOTICE` file (`long`'s own `@license` banner is carried verbatim in `LICENSE.txt`
regardless). `chroma-js` is dual BSD-3-Clause/Apache-2.0 for the small portion of it derived from
colorbrewer2.org; that portion's Apache notice is already reproduced verbatim inside `LICENSE.txt`'s
chroma.js banner, so it is not repeated here. `parquet-wasm` and `s2-geometry` are each licensed
"MIT OR Apache-2.0" / "MIT or Apache-2 or ISC" — used here under the MIT branch, so the Apache
NOTICE obligation does not attach.

## Vendored assets

These are copied from the kepler.gl repository (MIT, Copyright contributors to the kepler.gl project)
and served from the plugin's own asset path so that no install has to call an external CDN:

- `icons/svg-icons.json` — kepler.gl's icon library.
- `images/effects/*.png` — 18 post-processing effect preview thumbnails.
- `raster/colormaps/*.png` — 71 colour ramps for `RasterTileLayer`. These originate from
  matplotlib (Copyright (c) 2012-2024 Matplotlib Development Team, matplotlib licence, a
  BSD-style licence) by way of kepler.gl.

## Sample data

Sample datasets under `testdata/` are for the development benches and are not part of the published
archive.
