export const baseAssistantSkill = `# Kepler map configuration
The map is stored in the panel option 'mapConfig' ('config.mapStyle', 'config.visState',
'config.mapState'). Edit that JSON on the panel.
Base map: set 'config.mapStyle.styleType'. Free ids: no_map, dark-matter, positron, voyager,
grafana-satellite, grafana-satellite-terrain, grafana-topographic-terrain. Colour ramp:
'layer.config.visConfig.colorRange'. Filters: 'config.visState.filters'.
Cross-filter: this panel filters other panels via 'clickArea' (click a point for a circular
area) and can publish the viewport to dashboard variables ('viewportVariables'); it does not
support drawing a rectangle.
Data layers draw from the panel's Grafana queries: to add a layer that needs data, add a
query (refId) returning the columns, then a layer in 'config.visState.layers' whose dataId is
that query's dataset. The dataset id is grafana-<refId> (e.g., query B → grafana-B).`;
