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
| @hubble.gl/react | 2.0.0-alpha.4 | MIT | Copyright (c) 2021 Uber Technologies, Inc.; Copyright Vis.gl contributors. |
| react-palm | 3.3.11 | MIT | Copyright (c) 2019 Brian Ford |
| styled-components | 6.4.3 | MIT | Copyright (c) 2016-present Glen Maddern and Maximilian Stoiber |

Every line above was read from that package's own `LICENSE` file in `node_modules` on 2026-08-31. The
`@kepler.gl/*` packages published to npm do not ship a `LICENSE` file individually; their notice is
confirmed instead by the `// SPDX-License-Identifier: MIT` / `// Copyright contributors to the
kepler.gl project` header carried in their own compiled output, and by `node_modules/kepler.gl/LICENSE`
for the project as a whole. Re-read them if the versions have moved — several of these differ from
what one would guess (kepler and deck.gl both attribute to contributors rather than to a company).

The full text of the MIT and Apache-2.0 licences, and the notices of every smaller package whose
build carries a licence banner, are in `LICENSE.txt` alongside this file.

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
