# Map configuration

Everything you set in kepler's own panel — layers, colours, filters, interactions, the base map —
lives in kepler's store, not in Grafana's. It survives a query refresh. It does **not** survive a
page reload until you capture it.

## Saving

**Map configuration → Save current map** in the panel options takes a snapshot of the current map
and writes it into the panel's options, which means into the dashboard JSON. Save the dashboard and
it comes back on the next load.

### Why saving is explicit

Two reasons, both about the dashboard JSON.

A kepler configuration is a **sizeable blob** — layers, visual channels, colour ranges, filters,
interaction config, the map style. Rewriting it on every pan would churn the dashboard for nothing,
leave every dashboard permanently "unsaved", and make version control on dashboards-as-code useless:
every diff would be a wall of coordinates.

And the layer configuration is a **deliberate act**. You style a map once and then look at it for
months; automatic capture would mean an accidental colour change during a demo becomes the
dashboard's new state.

### What a save captures

Whatever kepler's own export produces: the layer list with all their styling, filters, the
interaction configuration, split-map state, and the base map. It does not capture your data —
that comes from the queries, every time.

**With one exception: tilesets.** A layer you added through kepler's own **Add Data → Tileset** —
vector tile, raster tile, WMS, 3D tiles, bitmap — has no query behind it, so nothing would rebuild
it on the next load. The save writes its **descriptor** instead: the name, the field list, and the
URLs. No rows, so it stays a few lines of JSON. See
[Layers configured with a URL](../../layers/url-configured).

A CSV or GeoJSON you drop into **Add Data** is _not_ saved. Persisting it would mean putting every
row of the file in the dashboard JSON. Load such data through a query instead — see
[How a query becomes a map](../data/how-a-query-becomes-a-map).

If you hit save before the map has finished mounting, nothing is captured. Give it a moment and
try again.

## What a saved configuration overrides

::: warning A saved configuration wins over the panel options
It names its own base map, so **Base map** in the options stops taking effect. It carries its own
styling, so **Follow dashboard theme** appears to do nothing.

If a panel is ignoring an option you just changed, this is almost always why. Re-save the map to
take a new snapshot, or clear the configuration to hand control back to the options.
:::

## Importing

**Map configuration → Import configuration** accepts a pasted JSON configuration. It is how you
bring a map across from somewhere else — including from the tools this plugin is an alternative to.

### Both shapes are accepted

| Shape                        | Produced by                         |
| ---------------------------- | ----------------------------------- |
| `{ version, config }`        | kepler's saved config               |
| `{ datasets, config, info }` | kepler's **Export map**, and Dekart |

From the second, the `config` half is kept along with any **tileset descriptors** among its
datasets — so a map built over someone's vector tiles arrives with those tiles. Everything else in
`datasets` is dropped: the data comes from your panel's own queries, and importing a map does not
import someone else's rows.

### Configurations from older kepler releases

They work. A `v1`-era saved config from an older kepler is migrated by kepler's own schema on the
way in, which matters because Dekart is still on kepler 3.2.6 and Foursquare Studio exports from
whatever version it happens to run.

This is pinned by a characterisation test in the plugin's suite, so a regression in kepler's
migration path shows up as a failing build rather than as a broken paste in somebody's dashboard.

### What can go wrong

A pasted configuration references datasets by id. The panel's dataset ids are derived from your
query `refId`s — `A`, `B`, `C` — so a configuration exported from a map whose datasets were called
something else will parse but attach its layers to nothing.

The practical fix is to import the configuration, then re-point each layer at your dataset in
kepler's layer panel, then save. Once saved, the ids match and it is stable.

Invalid JSON is rejected rather than throwing: a typo in the textarea cannot take the panel down.

## Coming from the Foursquare Studio panel

See [Migrating from the Foursquare panel](../migrating-from-the-foursquare-panel), which covers the
column conventions as well as the configuration.

## Dashboards as code

A saved configuration is ordinary panel JSON, so it provisions like anything else. The plugin's own
dev dashboards under `provisioning/dashboards/` are hand-written files that include one, which is
how the layer gallery pins a specific layer type per panel.

Two practical notes for that workflow: the blob is large, so keep it at the end of the options
object where it does not obscure the rest of the diff, and remember that it pins the base map, so a
provisioned dashboard will not follow the viewer's theme.
