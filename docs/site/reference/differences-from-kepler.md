# Differences from stock kepler.gl

The panel embeds the real kepler.gl and swaps out exactly **one** component. Everything else you see
is upstream. This page is the complete list of what is different, and why — it is the content
kepler's own documentation cannot cover.

## At startup

The panel calls kepler's official embedding hook once, before any component mounts, with three
settings:

### The Flow layer is enabled explicitly

```
enableFlowLayer: true
```

The Flow layer is why this plugin pins **kepler.gl 3.3.0-alpha.7** rather than the 3.2.6 stable
release: it exists nowhere else. Stating it explicitly rather than relying on the upstream default
means a change in that default cannot silently remove the feature the plugin is partly built around.

### Assets are served from the plugin, not a CDN

```
cdnUrl: <the plugin's own asset path>
```

By default kepler fetches its icon library at runtime from `studio-public-data.foursquare.com`. That
is wrong here on three counts: a plugin whose premise is escaping a hosted Foursquare dependency
should not call a Foursquare CDN; Grafana's strict Content-Security-Policy blocks the request under
`connect-src` and it surfaces as an unhandled "Failed to fetch"; and an air-gapped install has no
route to it at all.

So kepler's icon library is **vendored with the plugin** and served from Grafana. The path is read
from the runtime asset base rather than hardcoded, because Grafana can serve plugin assets from a
sub-path or from a CDN of its own.

The knock-on effect is covered under base maps below.

### No release banner

```
showReleaseBanner: false
```

A "new release" notice has no place inside a dashboard panel.

## The map control

kepler ships the entire effects feature but its stock map control never mounts the button, and
nothing in the core mounts the manager panel — both are wired by the host application. The panel
replaces `MapControlFactory` with one that adds the effects button and hosts the manager beside the
toolbar.

That is the **only** component injected. kepler's demo app also mounts a SQL data explorer and an AI
assistant; neither is included here.

Effect thumbnails are vendored along with the icons, so the picker needs no outbound request.

## Base maps

The panel **replaces** kepler's list of base map styles rather than adding to it.

Five of kepler's nine defaults are Mapbox styles — Satellite With Streets, Dark, Light, Muted Light,
Muted Night — and each is a `mapbox://` URL that cannot load without an account. Left in place they
sit in the picker as choices that blank the map when clicked.

What replaces them:

- kepler's three Carto styles, re-registered **from kepler's own definitions** rather than copied, so
  an upstream rename fails a test instead of producing an inert entry.
- kepler's "No Basemap" entry, re-added deliberately — replacing the list would otherwise drop it.
- Esri satellite and topographic, and two relief styles, as the plugin's own style documents.
- A self-hosted `style.json`, when configured.

Thumbnails are real tiles from each service rather than kepler's bundled images, because pointing
`cdnUrl` at the plugin left every base map thumbnail requesting a file the plugin does not ship.

Full detail on [Base maps and relief](../guide/map/basemaps-and-relief).

## The coordinate interaction is managed

When a **Coordinates** cross-filtering mapping is configured, the panel switches kepler's coordinate
interaction on — and switches it back on if the user turns it off, because the mapping is built on
kepler's pinned coordinate and would otherwise stop publishing silently.

Turning it off in kepler's menu is therefore not a way to disable the channel. Remove the mapping
instead. See [Interactions](../guide/kepler/interactions).

## Layers the panel builds that kepler does not

kepler auto-detects layers from column names, but not all of them:

| Layer              | Why the panel builds it                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| **Trip**           | kepler's own heuristic insists on a column literally named `id`                                 |
| **Flow**           | kepler does not auto-detect flows at all                                                        |
| **Velocity field** | not a layer type — the panel traces streamlines and hands kepler their geometry as a Trip layer |

See [How a query becomes a map](../guide/data/how-a-query-becomes-a-map).

## Refresh behaviour

On a query refresh the panel **replaces the data underneath the existing datasets** rather than
removing and re-adding them, so the layers, filters and styling you configured survive.

This is a deliberate departure from how such panels usually work — the Foursquare Studio panel does
remove-then-add on every refresh, and therefore discards the user's layer configuration each time
the query re-runs.

## Where upstream documentation is behind this plugin

kepler.gl's public documentation describes the **3.2 stable line**. This plugin bundles
**3.3.0-alpha.7**. Two consequences when you follow an outbound link:

- Upstream lists **fifteen** layer types. The bundled pre-release registers **nineteen** — the Flow
  layer among them, which upstream does not document at all.
- Some layer attributes exist in the UI without an upstream entry. `Trail Length` on Trip layers is
  the one you are most likely to want; it is deck.gl's `trailLength`, covered in
  [Under the hood](./under-the-hood).

See [Upstream documentation](./upstream-docs) for the pinned versions in one place.

## What is _not_ different

Worth stating plainly, because the list above can give the wrong impression. The layer types and
their attributes, colour palettes and scales, filters, the tooltip and brush interactions, map
settings, 3D and globe, split maps, playback, the draw tool, the legend, saving and exporting — all
of that is stock kepler.gl, behaving as its own documentation describes.
