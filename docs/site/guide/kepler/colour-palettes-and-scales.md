# Colour palettes and scales

kepler's colour controls are unchanged in the panel. This page covers the two questions that come up
specifically in a Grafana dashboard.

## The controls, briefly

Every layer has a flat **colour**, or a **Color Based On** a column plus a **palette** and a
**scale**. The scale decides how values map to palette steps:

- **Quantile** — equal _counts_ per step. Every colour is equally common; outliers do not dominate.
- **Quantize** — equal _ranges_ per step. Colours are comparable between two maps of the same
  measure; a skewed distribution will look almost uniform.

The choice matters more than the palette. A quantile scale on earthquake magnitude will make a
magnitude-3 tremor look significant because a fifth of the data has to be in the top bucket;
a quantize scale on the same data leaves the top bucket almost empty, which is the honest picture.

## Colour does not follow the Grafana theme

**Follow dashboard theme** restyles kepler's _UI chrome_ and picks the base map — it does not touch
your layer colours. A layer coloured with a red-to-blue palette looks the same in light and dark
mode.

That is the right default: layer colour is data encoding, not decoration, and having it shift with a
viewer's theme preference would make two people reading the same dashboard see different maps.

The consequence is that a palette should be chosen to work on **both** base maps if the dashboard
follows the theme, or the base map should be pinned to a specific one. A pale palette that reads
beautifully on Positron can disappear entirely on Dark Matter.

## Grafana's own colour settings do nothing here

Standard panel options — field colour scheme, thresholds, value mappings — are not used by this
panel. The map's colours come from kepler's layer configuration and nowhere else.

If you need a threshold-based colour, express it in the query and colour by the resulting column:

```sql
SELECT lat AS latitude, lon AS longitude,
       CASE WHEN pm25 > 55 THEN 'unhealthy'
            WHEN pm25 > 35 THEN 'moderate'
            ELSE 'good' END AS band
FROM readings;
```

Then **Color Based On → band** with a categorical palette. This has the advantage of being visible
in the query rather than buried in a saved configuration blob.

## Custom palettes

kepler lets you build one and it is captured by **Save current map** like everything else. Worth
knowing if your organisation has brand colours: define it once, save the configuration, and copy
that panel as the starting point for new maps.

---

**Upstream:** [Color palettes](https://docs.kepler.gl/docs/user-guides/l-color-attributes) ·
[Layer attributes](https://docs.kepler.gl/docs/user-guides/d-layer-attributes)

Written against **kepler.gl 3.3.0-alpha.7**. See
[Upstream documentation](../../reference/upstream-docs).
