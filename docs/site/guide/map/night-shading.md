# Night shading

**Map → Night shading** shades the side of the Earth in darkness, at the end of the dashboard's time
range or at its start. **Show the sun** adds the point on Earth the sun stands over.

It needs no query. The panel works out the sun's position for that moment and draws the night as a
polygon of its own, a dataset called **Night** (and **Sun**), which moves when the time range
does — with the dashboard's auto-refresh, the terminator creeps west as you watch.

The sun's position comes from NOAA's general solar position formulas, good to about a quarter of a
degree. The night reaches to Web Mercator's limit, short of the pole, and repeats for every copy of
the world a zoomed-out map shows side by side.

Its colour and opacity are the Night layer's, in kepler's side panel; save the map to keep them.
The Night dataset has no time column, so a time filter on the map never hides it.

A Geomap **Night / Day** layer becomes this option when the panel is switched; see
[Coming from Geomap](../coming-from-geomap).
