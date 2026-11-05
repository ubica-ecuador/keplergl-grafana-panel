# Live data

A query can stream: instead of answering once, it keeps sending rows as they happen. Grafana does
this through **Grafana Live**, its websocket, and the map draws whatever arrives: vehicles that move
as they report, sensors that update, events as they come in. No dashboard refresh is involved.

Two common sources:

- **Grafana Live push.** Anything that can make an HTTP request posts rows to Grafana in InfluxDB line
  protocol, and the built-in **-- Grafana --** datasource reads them with the *Live measurements*
  query type.
- **MQTT**, through Grafana's [MQTT datasource](https://grafana.com/grafana/plugins/grafana-mqtt-datasource/):
  the datasource subscribes to a topic and streams every message.

Any other datasource that streams works the same way.

## What the map does with a stream

| While a query streams                  | What the map does                                                                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| new rows arrive with every message     | it updates at most once per **Live update interval** (1 s by default), with the newest rows; a hidden tab takes no updates and catches up when shown                                                                         |
| the data's last instant moves forward  | the trip playhead goes to it, and a time window that is not driven by the dashboard range slides to end there, with the same width (a window over the whole data keeps covering it)                                          |
| you move the playhead or the window    | it stays where you put it; bring it back to the end and it follows again                                                                                                                                                     |
| a series comes with labels (tags)      | each label becomes a column and each series a row per instant, so `bus,id=b07 latitude=…,longitude=…` reads as `time, id, latitude, longitude`                                                                            |

With *Time range sync* on **Dashboard drives map** (the default) the window follows the dashboard
range, which Grafana moves along with the stream; the map only moves the trip playhead.

Each update rebuilds the query's dataset in the map. At one update a second that costs little; a
datasource that sends several messages a second is the reason the interval exists.

## Grafana Live push

Post line protocol to `/api/live/push/<stream>` with a token that can edit (a service account with
the *Editor* role):

```bash
curl -X POST "$GRAFANA/api/live/push/fleet" \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary 'bus id="b07",latitude=-0.1807,longitude=-78.4678,speed=31.5,heading=90'
```

Each measurement is a channel, `stream/<stream>/<measurement>` — here `stream/fleet/bus`. In the
panel, pick the **-- Grafana --** datasource, *Live measurements*, and that channel.

The vehicle's id can be a field (`id="b07"`, a string) or a tag (`bus,id=b07 …`): the map reads both
as a column `id`. Grafana keeps about the last thousand rows of a channel in the browser, so a trail
is as long as a thousand rows allow: 50 seconds of 20 vehicles reporting every second.

## MQTT

Point the MQTT datasource at the broker (`tcp://`, `tls://`, `ws://`, or `wss://` as HSL below) and query a topic;
`+` and `#` wildcards work. Each message becomes a row. A JSON payload arrives as one column holding
the object: add the **Extract fields** transformation (source: that column, format: JSON) to turn its
keys into columns the map can place.

Helsinki's public transport (HSL) publishes every vehicle's position once a second, openly:

| Setting         | Value                                                                     |
| --------------- | ------------------------------------------------------------------------- |
| Broker          | `wss://mqtt.hsl.fi:443/`                                                  |
| Topic           | `/hfp/v2/journey/ongoing/vp/bus/#` (`tram`, `train`, `metro`, or `#`)     |
| Transformation  | Extract fields, source `VP`, format JSON, replace all fields              |
| Columns         | `lat`, `long`, `veh` (vehicle number), `oper` (operator), `spd`, `hdg`    |

A vehicle number is unique within its operator; for a trip per vehicle, map *Field mapping →
Trip ID* to `veh` (or to a column that joins `oper` and `veh`).

## Options

Under *Live data*:

| Option                        | Default | What it does                                                         |
| ----------------------------- | ------- | -------------------------------------------------------------------- |
| **Follow live data**          | on      | keeps the playhead and the window on the newest rows, as above       |
| **Live update interval (ms)** | 1000    | the least time between two updates of the map while a query streams |

---

Written against **kepler.gl 3.3.0-alpha.19**. See
[Differences from kepler.gl](../../reference/differences-from-kepler) for what changes inside a
Grafana panel.
