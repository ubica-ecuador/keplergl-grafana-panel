# Active alerts and service health

The Plus panel can draw the alerts that are firing or pending on the same map as your data, each one at the place
its labels name: red while it fires, amber while it is pending. A Viewer sees only the alerts of the rules they are
allowed to read, as in Grafana's own alert list.

The same page covers **health-coloured probes**: points that turn green or red by how many of their checks fail,
which the Service health templates use for Synthetic Monitoring.

## Switch it on

Open the panel's options and find the **Active alerts** category. Turn on **Show active alerts**; the other options
appear once it is on.

| Option                 | What it does                                                                                                         | Default            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **Show active alerts** | adds the **Active alerts** layer to the map                                                                          | off                |
| **States**             | **Firing**, **Pending**, or both                                                                                     | both               |
| **Label filter**       | Grafana matchers that every alert shown must satisfy; see [The label filter](#the-label-filter)                      | empty: every alert |
| **Folders**            | the folders of Grafana-managed rules to read; the list holds the folders you can see that have rules                 | empty: all folders |
| **Data sources**       | **Grafana-managed** and each data source whose rules are read; see [Where alerts come from](#where-alerts-come-from) | all                |
| **Place label**        | **Auto**, or one label that places every alert; see [How an alert is placed](#how-an-alert-is-placed)                | Auto               |

Under the options, a status line sums up the last read:

> 12 alerts · 9 placed by region, 1 by coordinates · 2 without a place (labels: instance, job, severity)

## Where alerts come from

Plus reads the active instances of alert rules from two kinds of source:

- **Grafana-managed rules**, the rules created in Grafana Alerting.
- **Data source-managed rules**, read from the ruler of each Prometheus or Loki data source. Mimir and Cortex are
  added to Grafana as Prometheus data sources, so their rules are read too. A data source whose **Manage alerts via
  Alerting UI** setting is off is left out.

Each source is read through Grafana's rules API, in the viewer's own session. Nothing is read from Alertmanager.

### What counts as active

| Instance state in Grafana         | On the map         |
| --------------------------------- | ------------------ |
| Alerting or Firing                | **firing**, red    |
| No Data, Error                    | **firing**, red    |
| Pending                           | **pending**, amber |
| Normal, Recovering and the others | not shown          |

Grafana counts No Data and Error as alerting, and so does the map. Recording rules are never shown.

### Only what the viewer can read

The rules API answers with the rules the person looking at the dashboard is allowed to read: the Grafana-managed
rules in folders they can open, and the data source rules their role lets them see. A Viewer never sees the alerts
of a folder they cannot open, even on a dashboard shared with them. Two people looking at the same map can
therefore see different alerts.

Plus does not read Grafana's alerts endpoint or Alertmanager's, because those do not filter by folder permission.

### When alerts are read

While **Show active alerts** is on, the alerts are read:

- when the panel loads, and again whenever an option in **Active alerts** changes;
- every 60 seconds;
- after each refresh of the panel's queries, but not more often than once every 10 seconds, so a dashboard that
  refreshes every few seconds does not read the rules on every refresh.

A streaming panel's pushes do not trigger a read; it relies on the 60-second timer. With the switch off, nothing is
read.

Each source has 15 seconds to answer. A source that fails or times out is named in the map's corner, and the
others are still drawn:

> Alerts from Mimir could not be read (403)

## How an alert is placed

Each alert instance is placed by its own labels, so a rule needs no change as long as its labels name a place. With
**Place label** on **Auto**, the first of these that gives a position wins:

1. **Coordinates**: a `latitude` or `lat` label and a `longitude`, `lng` or `lon` label, both numbers within range.
2. A **`geohash`** label, placed at the centre of its cell.
3. A label whose name [Places](/plus/data/places#what-is-recognised) detects, tried in this order: geohash, cloud
   region or zone (`region`, `zone`, `location`, `load_zone`…), airport or point of presence (`iata`, `pop`,
   `colo`…), country (`country`, `country_code`…), IP address (`ip`, `client_ip`…).
4. A label that usually names your own sites, when its value is something Plus knows:

   | Label                                  | Read as                                 |
   | -------------------------------------- | --------------------------------------- |
   | `site`, `datacenter`, `dc`, `location` | a cloud region, an airport, or an IP    |
   | `cluster`                              | a cloud region or an IP                 |
   | `instance`                             | an IP address, with or without its port |

   These labels are never read as countries, so `site="IN"` is not taken for India. And they are read as an airport
   only when the value looks like one: an upper-case code such as `MIA`, or three letters and one or two digits such
   as `ams1`. A cluster called `prd` or `stg` is not taken for an airport. An IP is placed in its country, and a
   private address, as most `instance` values are, is not placed at all.

States, provinces and counties do not place alerts.

To place every alert by one label, choose it under **Place label**; the list offers the labels of the alerts in the
last read. That label is then read as the kind its name suggests, or else as the first that fits of cloud region,
country, IP, airport and geohash. Coordinate labels are not used while a label is chosen.

Alerts that cannot be placed are not drawn. They are counted in the map's corner, with up to five of their label
names, so you can see which label to add a place to:

> 2 alerts without a place (labels: instance, job, severity)

An alert placed by an IP address uses the same lookup as Places, and the map then shows the DB-IP credit in its
corner.

## What the layer shows

Each placed alert is a point in the **Active alerts** layer, red when firing and amber when pending. The layer is
kept above the map's other layers, so an alert is never hidden under a choropleth or a line. Several alerts at the
same place draw on top of each other.

The tooltip shows, in this order: `alertname`, `state`, `severity`, `since` (when the instance became active),
`folder` (the folder of a Grafana-managed rule, the namespace of a data source rule), `place` and `rule_url`, a link
to the rule in Grafana. Every label of the alert is also a column of the dataset, available to kepler's tooltip,
filters and colours; a label named like one of the columns above gets a `label_` prefix.

The map draws at most **5,000 alerts**: firing before pending, then by `severity` (`critical`, `high`, `warning`,
`info`, then any other), then the newest. When more pass the filter, the corner says
`5,000 of 7,250 alerts shown`.

## The label filter

**Label filter** takes the same matchers as Grafana's alert list, separated by commas:

| Matcher                       | Keeps an alert whose label              |
| ----------------------------- | --------------------------------------- |
| `team=sre`                    | equals the value                        |
| `team!=sre`                   | does not equal it (or is missing)       |
| `severity=~critical\|warning` | matches the regular expression, in full |
| `env!~dev.*`                  | does not match it                       |

`alertname` and `severity` can be matched like any other label. A value may be put in double quotes, which lets it
contain a comma: `site="Lima, PE"`. An alert must satisfy every matcher.

The filter is checked and applied when you leave the field. A filter that cannot be read is marked with its error
under the field, and is ignored until it is fixed: the map keeps showing every alert rather than none.

The **States**, **Folders** and **Data sources** options filter too. **Folders** applies to Grafana-managed rules
only; data source rules are kept whatever folders are chosen.

## Health-coloured probes

A query placed as points by [Places](/plus/data/places) whose **first numeric column is named `failing`** is drawn
as health points: **green** while the value is 0 and **red** above it, and sized by the value, so the probes that
fail the most checks are the largest. `failing` should count failing checks, so 0 means healthy.

Any query can use this by naming its column `failing`, with a Grafana transformation or an alias in the query. Once
you change the layer's colour or size in kepler, your choice is kept.

## The Service health templates

Two template dashboards put probes and alerts together. Both read
[Synthetic Monitoring](https://grafana.com/docs/grafana-cloud/testing/synthetic-monitoring/), Grafana Cloud's
service for running checks from probe locations around the world. To use them you need:

- Synthetic Monitoring set up, with at least one check running;
- its Prometheus data source, chosen in the dashboard's **Data source** variable. The templates read the
  `probe_success` and `sm_check_info` metrics that Synthetic Monitoring writes there;
- for alerts on the map, alert rules whose labels place them, as described above.

The **job** and **probe** variables narrow the dashboard to some checks or some probes. Each probe is placed by the
`geohash` label that Synthetic Monitoring sets on `sm_check_info`.

### Service health map

The live view, refreshed every minute over the last hour:

- **Where is it failing?**: the probes as health points, sized by how many of their checks fail now, with
  **Show active alerts** on;
- **Active alerts**: Grafana's alert list, firing and pending;
- **Failing probes**: a table of the checks failing now.

Its map query counts, for each probe, the checks whose last result failed, and a transformation names that count
`failing`.

### Service health history

The same probes over the dashboard's time range, sampled every 5 minutes: one point per probe and sample, green while
its checks pass and red when they fail. Press play on kepler's time filter to replay them. A **Reachability by
probe** chart sits under the map. This dashboard does not show active alerts, which are only ever the current
ones.

See [Template dashboards](/plus/start/templates).

## When no alerts are shown

Work through these in order:

1. **Read the status line** under **Active alerts**. `No active alerts` means the rules that were read have no
   firing or pending instance that passes **States**, **Label filter** and **Folders**.
2. **Check the corner of the map** for `Alerts from … could not be read`. A `403` means the viewer may not read
   that source's rules; a timeout, that the ruler did not answer within 15 seconds.
3. **Check that the rule is visible to you.** Open **Alerting → Alert rules** as the same user. A rule you cannot
   see there is not read by the map either. A Prometheus or Loki data source with **Manage alerts via Alerting UI**
   off is not read.
4. **Look for `without a place`.** The alerts were read but no label placed them. Add a `region`, `site`,
   `geohash` or `latitude` and `longitude` label to the rule, or choose a **Place label** whose values Plus knows.
   A site name of your own, such as `lab-west`, is not a place; put a cloud region, an airport code or coordinates
   next to it.
5. **Check the filter.** A matcher with a typo keeps nothing. Clear **Label filter** and **Folders** to see whether
   the alert comes back.
6. **Wait for the next read.** A new alert appears within a minute, or sooner when the dashboard refreshes.
