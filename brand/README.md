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
