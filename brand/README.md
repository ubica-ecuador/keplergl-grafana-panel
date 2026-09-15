# Brand mark

The plugin's own mark. It replaces the earlier icon, which was a rebuild of
kepler.gl's two rotated squares — that mark belongs to kepler.gl and is not
ours to ship as the identity of a third-party plugin.

## The files

| File | Use |
|---|---|
| `logo-large.svg` | Full mark on a transparent background. Catalog page, README, headers. |
| `logo-small.svg` | Identical to `logo-large.svg`. Icons and favicon. |
| `logo-mono-white.svg` | White on transparent. Dark slides, dark print. **Still the previous hex-prism mark.** |
| `logo-mono-black.svg` | Black on transparent. Light backgrounds, printed docs. **Still the previous hex-prism mark.** |

The two colour files are byte-identical: one vector drawing, tightly cropped
(`viewBox="19.7 19.9 140.6 140.6"`), that scales to any size. Both names are
kept because `plugin.json` asks for a small and a large logo. The file carries a
C2PA provenance manifest in its `<metadata>` whose hash covers the bytes, so
copy it as is — editing any attribute, even `width`, breaks the signature.

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

Grafana's orange ramp, no background:

- `#F46800` — base layer (solid)
- `#FF9830` — middle layer (60% fill, solid outline)
- `#FBCA0A` — top layer (55% fill, solid outline), track and pin
- `#111217` — the halo around the track, the pin's outline and hole, and the
  pin's shadow at 45%

## Concept

Three isometric map layers stacked on top of each other, with a track rising
through them up to a location pin: kepler.gl's layered map, crossed by a
trajectory in time.

## Backgrounds

The mark is transparent and made for Grafana's dark theme. The `#111217` halo
cuts the track out of the layers it crosses. On a dark background it disappears;
on a white one it shows as a dark outline, which still reads fine.

## Reducing

It is a single vector drawing, so it works at any size. If a channel needs PNG
rather than SVG:

```bash
rsvg-convert -w 48 -h 48 logo-small.svg -o logo-48.png
rsvg-convert -w 512 -h 512 logo-large.svg -o logo-512.png
```

## Banner

The wide strip at the top of the README, under the docs home hero, and first in
the catalog screenshots. It carries the logo's idea at full size: three map
slices of South America stacked in the logo's ramp, one per family of sources the
panel reads, crossed at Cuenca by the track and pin, standing on a Grafana time bar.

| Slice | Label | Captured from |
|---|---|---|
| top, `#FBCA0A` | Vector formats | HydroSHEDS rivers and flow field (`adwxgg7`, panel 3) |
| middle, `#FF9830` | Aggregations | CAMS fire cells as a heatmap (`fire-emissions-tabs`, panel 1) |
| bottom, `#F46800` | Cloud-native raster | GFS 2 m temperature from Zarr (`gfs-forecast`, panel 2) |

The flow field is on top because it is the one slice that has to be seen whole;
the lower two show only what the slice above leaves open.

### The files

| File | Role |
|---|---|
| `banner/capture.mjs` | Screenshots one panel with a forced viewport. Rewrites the dashboard JSON in flight, saves nothing. |
| `banner/crop.py` | Cuts the square textures out of the captures into `banner/slices/`. |
| `banner/banner.html` | The layout: text, isometric stack, time bar. Places Cuenca on every slice from the capture viewport. |
| `banner/render.mjs` | Renders the page to `banner/banner@2x.png`, 2468x900. |

### Regenerating

All three captures must share one viewport, or the slices stop lining up. The
flow field needs `HEADED=1`: software WebGL never settles a frame while it
animates, and the headless screenshot hangs.

```bash
RAW=$(mktemp -d)
HEADED=1 node brand/banner/capture.mjs https://grafana.ubica.ec adwxgg7 3 $RAW/raw-flow.png -6 -62 3.6 "" 35000
node brand/banner/capture.mjs https://grafana.ubica.ec fire-emissions-tabs 1 $RAW/raw-fires.png -6 -62 3.6 "" 40000
node brand/banner/capture.mjs http://localhost:3002 gfs-forecast 2 $RAW/raw-gfs.png -6 -62 3.6 admin:admin 45000
python3 brand/banner/crop.py $RAW
node brand/banner/render.mjs
```

`crop.py` holds each canvas centre as a constant. A dashboard that gains or loses
a row of variables moves its canvas, so check the crops after re-capturing.

Then copy it out — PNG for GitHub and the plugin package, JPEG for the docs site:

```bash
python3 -c "
from PIL import Image
im = Image.open('brand/banner/banner@2x.png').convert('RGB')
im.save('src/img/banner.png', optimize=True)
im.save('docs/site/public/img/banner.jpg', quality=88, optimize=True, progressive=True)
"
```

The previous banner, the Amazon flow field on its own, ships on as
`src/img/screenshot-flow-field.png`.
