---
layout: home

hero:
  name: Maps by Kepler.gl
  text: Interactive maps inside Grafana
  tagline: kepler.gl running in the panel — no external service, no account, no Mapbox token. Spatio-temporal data from any Grafana data source.
  image:
    src: /logo.svg
    alt: Maps by Kepler.gl
  actions:
    - theme: brand
      text: Quickstart
      link: /guide/quickstart
    - theme: alt
      text: What it is
      link: /guide/what-it-is
    - theme: alt
      text: Layer gallery
      link: /layers/

features:
  - title: Your query is the configuration
    details: Name a column recognisably and the panel builds the layer. lat/lng, time, trip id, geometry, H3, origin–destination pairs and velocity components are all detected, and every one is overridable per query.
    link: /guide/data/how-a-query-becomes-a-map
    linkText: How detection works
  - title: Geometry straight from the database
    details: GeoJSON, WKT, or raw WKB/EWKB hex — so a plain SELECT geom from PostGIS renders with no ST_AsGeoJSON around it.
    link: /guide/data/geometry
    linkText: Geometry
  - title: Trajectories and flows, built for you
    details: A query with a trip id and a time becomes an animated Trip layer. A flat origin–destination table becomes an animated flow map. Neither needs a layer configured by hand.
    link: /guide/data/trajectories
    linkText: Trajectories
  - title: Wired into the dashboard, both ways
    details: The time picker drives the map's timeline and optionally the other way round. Map filters, clicks, the viewport and drawn areas all publish to dashboard variables, so the map filters every other panel.
    link: /guide/dashboard/cross-filtering
    linkText: Cross-filtering
  - title: Base maps with no account
    details: Carto's three, Esri's satellite and topographic, and two of those with real elevation. Or point it at a style.json on your own network for an air-gapped install.
    link: /guide/map/basemaps-and-relief
    linkText: Base maps
  - title: All of kepler.gl, in the panel
    details: The full layer, filter, interaction and effects UI is live — this is kepler itself, not a reimplementation. We document the seams; kepler documents its own panel.
    link: /reference/differences-from-kepler
    linkText: What differs here
---
