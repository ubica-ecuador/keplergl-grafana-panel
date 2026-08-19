# Developing the plugin

Everything here assumes a clone of
[ubica-ecuador/keplergl-grafana-panel](https://github.com/ubica-ecuador/keplergl-grafana-panel),
Node 22 or later, and Docker.

```bash
npm install
npm run dev      # webpack in watch mode, building into dist/
npm run server   # Grafana 12.0.10 on :3000, plus a strict-CSP one on :3001
```

`dist/` is bind-mounted into the containers, so a watch build reloads the panel without restarting
anything.

::: danger Do not `rm -rf dist` while the containers are running
It is bind-mounted, and deleting it leaves the containers serving a stale inode — the panel silently
stops updating and nothing explains why. `npm run build` cleans it correctly.
:::

## The three benches

| Command                  | Port    | What it is                                       |
| ------------------------ | ------- | ------------------------------------------------ |
| `npm run server`         | `:3000` | Plain Grafana, no third-party data sources       |
|                          | `:3001` | The same, with `content_security_policy = true`  |
| `npm run server:sources` | `:3002` | Ubuntu-based, with DuckDB and Infinity installed |

**`:3000` is deliberately bare.** It is pinned to the floor of the supported version range and has
nothing installed beyond this panel, because that is the plainest install we ship to. If something
works there, it works.

**`:3001` exists because CSP breaks base maps and nothing else.** MapLibre fetches styles, sprites,
glyphs and tiles over XHR, so they all fall under `connect-src`. A change that quietly adds an
outbound request shows up here as a blank map.

**`:3002` is a separate service rather than a flag**, because the DuckDB data source is linked
against glibc and the default image is Alpine — the bench runs the `-ubuntu` tag. Both data sources
install declaratively through `GF_INSTALL_PLUGINS`, so the first start needs outbound internet and
pulls about 140 MB into a named volume. That cost is paid once.

## Tests

```bash
npm run typecheck
npm run lint
npm run test:ci   # jest
npm run e2e       # playwright, against the running Grafana
```

If you have changed your dev Grafana's admin password, pass it through:
`GRAFANA_ADMIN_PASSWORD=… npm run e2e`.

### Browser verification

Unit tests prove the pure functions; they cannot prove that anything reached a map. Two scripts
drive a real browser and report what actually rendered:

```bash
npm run verify:spike     # :3000, the provisioned dashboard
npm run verify:sources   # :3002, one line per panel of the sources bench
```

Reach for these when a change breaks rendering without breaking a test — which is the failure mode
this codebase has most of.

## Provisioned dashboards

`provisioning/dashboards/` is mounted into the dev Grafana, so these appear on a plain
`npm run server`. Each exercises a different part of the panel:

| Dashboard              | Exercises                                                  |
| ---------------------- | ---------------------------------------------------------- |
| `dashboard`            | trips and EWKB geometry                                    |
| `timesync`, `timevars` | the four time-coupling modes                               |
| `varsync`              | cross-filtering into variables                             |
| `flows`                | origin–destination                                         |
| `layers`               | **every layer type the panel can build**, thirteen of them |

`provisioning-sources/dashboards/` is the same idea for the `:3002` bench: the file formats
(GeoParquet, GeoJSON, CSV) and a global seismicity dashboard reading remote GeoParquet over HTTPS.

### The layer gallery

`layers.json` is the widest of them, and three things about it are deliberate:

**Open at most two rows at a time.** Each map holds two WebGL contexts — MapLibre's and deck.gl's —
and browsers cap the total near sixteen, so thirteen maps at once blank the oldest. The rows are
collapsed for that reason, and collapsing one releases its contexts.

**It does not follow the Grafana theme.** Pinning a layer type needs a saved map configuration, and a
saved config names its own base map, which wins over the panel option.

**Six layer types are missing.** `vectorTile`, `rasterTile`, `wms`, `tile3d`, `bitmap` and `3D` are
configured with a URL rather than with data, so no query can drive them — see
[Layers a query cannot drive](./layers/url-configured).

These dashboards set no layers where they can avoid it, so what renders is what autodetection alone
produces. That makes the gallery a regression test you scroll: a layer type that stops rendering
after a kepler.gl bump is a blank map on a page.

## Test fixtures

`testdata/` holds real GeoParquet with WKB geometry and EPSG:4326 metadata, the same features as
GeoJSON, and CSVs. A `sources-data` container serves them over HTTP so Infinity exercises a genuine
URL fetch rather than inline data; DuckDB reads the parquet off the same directory, mounted at
`/testdata`.

Regenerate with `python3 testdata/make-testdata.py` (needs geopandas) **only** if the sample data
itself must change.

## This documentation site

It lives in `docs/site` as **its own npm package**, with its own lockfile. VitePress pulls in Vite,
Vue and Shiki, and none of that belongs in the dependency tree CI installs before typecheck, lint,
build and e2e.

```bash
npm --prefix docs/site install   # once
npm run docs:dev                 # http://localhost:5173
npm run docs:build               # fails on a broken internal link
npm run docs:preview
npm run docs:linkcheck           # outbound links, non-blocking
```

`docs:linkcheck` rebuilds with `DOCS_BASE=/` first, because the checker serves `dist` as the web root
and every link would otherwise 404 against the deployed prefix. It therefore leaves `dist` built for
the **root** path — run `npm run docs:build` again before serving locally.

It also catches something VitePress does not: **raw HTML `href`s are not rewritten.** VitePress
appends `.html` to markdown links but leaves `<a href="…">` alone, so a hand-written anchor inside an
HTML block needs the extension spelled out.

### Publishing

`.github/workflows/docs.yml` builds and deploys to GitHub Pages on every push to `main` that touches
`docs/site/**`. It requires Pages to be enabled on the repository, with **Settings → Pages → Source:
GitHub Actions**; without that the deploy job fails on permissions rather than saying anything
useful.

The base path comes from the repository name, so renaming the repository cannot silently break every
asset URL.

### Screenshots

```bash
npm run server && npm run server:sources   # both benches up
npm run docs:shots                         # all of them
npm run docs:shots -- layer-point trip     # just the matching ones
```

Images live in `docs/site/public/img/` and are **committed**, not generated in CI — building them
needs Docker, a running Grafana and outbound access to every base map and dataset.

Four things the script has to honour, each learned the hard way:

- **One panel per capture**, through Grafana's single-panel view (`?viewPanel=panel-<id>`), which
  works even for a panel inside a collapsed row. Capturing a whole dashboard of maps would exceed the
  WebGL context budget.
- **A Trip layer draws nothing until its clock runs.** Trajectory shots play the animation first, or
  photograph an empty map.
- **kepler overlays its side panel and playback widget** on a full-width map rather than sitting
  beside them, so hiding them with CSS reveals the map with no relayout.
- **JPEG at quality 82**, budget 200 KB per image. The two screenshots in `src/img/` weigh 875 KB and
  137 KB; twenty PNGs at that weight would put tens of megabytes in the repository.

A **velocity-field** panel is not yet captured, and would need care: its subtree re-traces on every
settle and never goes quiet, so Playwright's auto-waiting times out. Read the rect with
`page.evaluate`, clip a page screenshot to it, and pause the animation first.

## Writing conventions

- **British English**, matching the rest of the project.
- **Do not re-document kepler.gl or deck.gl.** Orient the reader, link out, and own the _deltas_ —
  see [Differences from stock kepler.gl](./reference/differences-from-kepler).
- **Qualify every outbound link with the version it was true of.** kepler's public docs describe the
  3.2 stable line; this plugin ships a 3.3.0 pre-release that registers more layer types.
- **Check claims against the installed packages**, not against upstream prose or memory. That rule
  has caught real errors: the "high-precision rendering" switch kepler documents is not wired to
  anything in the version we ship, and kepler's Line layer is deck.gl's `ArcLayer` with the height
  forced to zero.

## Before opening a pull request

```bash
npm run typecheck && npm run lint && npm run test:ci && npm run e2e
npm run docs:build   # if you touched docs/site
```

CI runs the same. Any change to `src/plugin.json` needs a **Grafana restart** to take effect; the
plugin id and type must not change.
