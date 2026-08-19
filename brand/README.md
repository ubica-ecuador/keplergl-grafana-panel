# Brand mark

The plugin's own mark. It replaces the earlier icon, which was a rebuild of
kepler.gl's two rotated squares — that mark belongs to kepler.gl and is not
ours to ship as the identity of a third-party plugin.

## The files

| File | Use |
|---|---|
| `logo-large.svg` | Full mark, 512×512, with the isometric base grid. Catalog page, README, headers. |
| `logo-small.svg` | No base grid, tight crop. Icons from 16 to 48 px. |
| `logo-mono-white.svg` | White on transparent. Dark slides, dark print. |
| `logo-mono-black.svg` | Black on transparent. Light backgrounds, printed docs. |

This directory is the source of truth. It is not built or published; the two
variants that ship are copied to where each consumer needs them:

| Copy | Consumer |
|---|---|
| `src/img/logo-large.svg` | `plugin.json` → `info.logos.large`, the plugin catalog page |
| `src/img/logo-small.svg` | `plugin.json` → `info.logos.small`, the panel-type picker |
| `docs/site/public/logo.svg` (the small variant) | Docs site favicon and nav bar |
| `docs/site/public/logo-large.svg` | Docs site home hero |

Edit the file here first, then re-copy. The monochrome variants ship nowhere
yet; they exist so a dark deck or a printed page has something to use.

## Palette

Grafana's own orange ramp:

- `#F46800` — primary orange (tall column)
- `#FF9830` — mid orange (middle column)
- `#FFB357` — light orange (short column, base grid)

Derived shades for the side faces: `#C25400` / `#9B4300`, `#D97A22` / `#B3611A`,
`#D98A3C` / `#B36F2C`.

## Concept

Three hexagonal cells extruded to different heights over an isometric grid: the
3D hexbin layer that identifies kepler.gl, read at the same time as a bar chart
— Grafana's native language. Height encodes aggregation; the grid anchors the
mark to the geographic plane.

## Clear space

Leave a margin of at least half a hex cell's width — 33 units of the 512 viewBox,
about 6.5% of the side — around the mark.

## Reducing

Below 24 px always use `logo-small.svg`: the base grid turns into noise at that
size. If a channel needs PNG rather than SVG:

```bash
rsvg-convert -w 48 -h 48 logo-small.svg -o logo-48.png
rsvg-convert -w 512 -h 512 logo-large.svg -o logo-512.png
```
