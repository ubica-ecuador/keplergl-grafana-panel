# Theme

**Follow dashboard theme** is on by default and makes the panel look like the dashboard around it
rather than like a slab of kepler's own grey.

## What it changes

Two things: kepler's UI chrome, and the base map.

### The UI

A subset of kepler's theme is overridden from the Grafana theme — the surfaces that would visibly
clash with the dashboard:

| kepler surface          | Taken from Grafana                                               |
| ----------------------- | ---------------------------------------------------------------- |
| Side panel background   | `background.primary`                                             |
| Side panel header       | `background.canvas`                                              |
| Sub-panel backgrounds   | `background.secondary`, `action.hover`                           |
| Inputs                  | `components.input.background`, `action.hover`, `action.selected` |
| Primary buttons         | `primary.main` / `primary.shade`                                 |
| Secondary buttons       | `secondary.main` / `secondary.shade`                             |
| Text, headings, subtext | `text.primary`, `text.maxContrast`, `text.secondary`             |
| Borders                 | `border.weak`                                                    |
| Active/selected accents | `primary.main`                                                   |

kepler's theme object is much larger than that. Spacing, typography scale and component internals
are left alone deliberately — the goal is a panel that belongs in the dashboard, not a
reimplementation of kepler's design system in Grafana's tokens.

### The base map

When **Base map** is set to _Match theme_ — the default — the theme also decides which Carto style
is used: **Dark Matter** in dark mode, **Positron** in light.

Pick any other base map explicitly and that choice stands in both themes. A satellite map does not
become a light satellite map.

## Turning it off

Switch **Follow dashboard theme** off and kepler keeps its own dark styling regardless of what
Grafana is doing.

Two reasons you might:

- **A dashboard shown on a wall or a projector**, where kepler's own high-contrast dark UI reads
  better than a themed light one.
- **Screenshots for documentation or a report** that should look like kepler.gl rather than like
  your Grafana instance.

Note that the base map still follows the **Base map** option; turning the theme off does not force a
dark base map, it only stops the _Match theme_ choice from tracking Grafana.

## Light mode and imagery

Satellite imagery is neither light nor dark, and kepler is told so explicitly — its colour mode for
those styles is _none_, so it does not try to pick label colours as though the base map were one or
the other. The topographic style is declared light, because it is.

This matters for the automatic contrast kepler applies to layer labels: get it wrong and white text
lands on white ice.

## Saved configurations override this too

As with the base map, a saved map configuration carries styling decisions and applies them on load.
If a dashboard stubbornly ignores the theme, check whether it has a saved configuration before
looking anywhere else — see [Map configuration](./map-configuration).
