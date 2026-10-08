# States, provinces and municipalities

A query that names states, provinces, counties, cantons or municipalities is drawn on their real boundaries, with
no coordinates and no geometry in the query. The Plus panel reads the names or the ISO 3166-2 codes, finds each
unit in boundary files that ship with the plugin, and fills it by its value.

![Brazilian states placed by name and drawn as a choropleth: São Paulo, Minas Gerais and Rio de Janeiro filled in three colours](/img/plus/regions-br.jpg)

Two levels are known:

- **States and provinces** (first-level subdivisions, ADM1): in 240 countries and territories, every one that has
  them.
- **Counties, districts, cantons and municipalities** (second-level subdivisions, ADM2): in 179 countries.

This page extends [Places without coordinates](/plus/data/places), which explains how a column is detected, the
80 % check and the Places options. Only what is particular to subdivisions is covered here.

## Column names that are detected

| Level             | Column names                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State / province  | `state`, `state_code`, `province`, `provincia`, `subdivision`, `iso_3166_2`, `departamento`, `geoip_subdivision_1_name`, `geoip_subdivision_1_iso_code` |
| County / district | `county`, `district`, `municipality`, `municipio`, `canton`, `comuna`, `geoip_subdivision_2_name`                                                       |

Names are matched as on the Places page: exactly, ignoring case, reading a dot as an underscore. When a query has a
county column and a state column, the county is placed and the state helps find it. When it has a state column and
a country column, the state is placed and the country narrows its names.

## Codes and names

### States and provinces

A state or province can be given as:

- its **ISO 3166-2 code**: `EC-A`, `US-CA`, `BR-SP`. Case does not matter, and an underscore works as the
  hyphen: `ec-a` and `US_CA` are read the same. A code always means its own unit, whatever the row's country.
- its **name**, in any of the spellings Natural Earth records: the local name, the English, Spanish, French,
  Portuguese, German, Italian and Dutch names, and the alternative names. `São Paulo`, `Sao Paulo` and
  `San Paolo` are all São Paulo.
- its **postal abbreviation**, such as `CA` or `TX`, but only when the row's country is known (see
  [The row's country](#the-row-s-country)). Two letters on their own could name a unit in too many countries.

About 4,300 of the 4,577 known states and provinces have an ISO 3166-2 code; the rest are found by name only.

### Counties and municipalities

A county, canton or municipality is given by its **name**, as the boundary data spells it, which is usually the
local spelling: `Cuenca`, `Los Angeles`, `Harris`. It always needs the row's country, and sometimes its state.

### How names are compared

Before two names are compared, both are simplified:

- accents are dropped and case is ignored: `Bolívar` and `BOLIVAR` match;
- any run of spaces, punctuation or symbols counts as one space: `Santo Domingo de los Tsáchilas` and
  `Santo-Domingo de los Tsachilas` match;
- one leading word for the kind of unit is dropped: `Provincia del Azuay` matches `Azuay`. The words are
  `Provincia de`, `Provincia del`, `Provincia`, `Departamento de`, `Departamento del`, `Departamento`, `Estado de`,
  `Estado do`, `Estado`, `State of`, `Province of`, `Región de`, `Región`, `Cantón`, `Municipio de`, `Municipio`,
  `Distrito de`, `Distrito` and `Comuna de`;
- one trailing word for the kind of unit is dropped: `County`, `Parish`, `Borough`, `Province`, `District`,
  `Municipality` or `Department`. So `Harris County` matches `Harris`.

Nothing else is guessed: there is no spelling correction and no partial match. A name that is not in the data is
left off the map.

## The row's country

Many subdivision names exist in more than one country: `Córdoba` is a province of Argentina, a department of
Colombia and a province of Spain. Plus never picks one of several namesakes. Each row takes its country from, in
this order:

1. a **country column** in the same query: one of the country column names on the
   [Places page](/plus/data/places#what-is-recognised) (`country`, `country_code`…), with at least 80 % of its
   values recognised as countries. Each row uses its own cell, so one query can hold several countries.
2. the **Country** option in the query's Places block, when the query has no country column.
3. for states and provinces only, the unit itself: an ISO 3166-2 code, or a name that exists in one country only,
   gives its own country.

A row whose country cell names no known country is not placed.

### Districts need a country, and sometimes a state

A county or municipality is only ever looked up inside its row's country. With no country column and no
**Country** chosen, its rows are counted as needing a country in the status line, and not drawn.

Inside one country the same district name can repeat: Ecuador has more than one canton called `Bolívar`, and many
US states have a county called `Washington`. The state settles it, taken from:

1. a **state column** in the same query (any of the state column names above), read per row: an ISO 3166-2 code,
   a name or, as the country is known, a postal abbreviation;
2. the **State** option in the query's Places block.

A district that still matches more than one unit is counted as ambiguous, and not drawn.

### The Country and State options

The query's block under **Places** shows these two options when its column is placed as a state or a district:

| Option      | Choices                                                         | Shown                                                                             |
| ----------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Country** | **From the rows** (the default), or any country with boundaries | for states and districts, when the query has no country column                    |
| **State**   | **Any** (the default), or a state or province of that country   | for districts, when the query has no state column and its rows are in one country |

The State list follows the country: the one chosen under **Country**, or the only country the query's country
column holds.

## Choropleth or bubbles

States and districts are drawn as a **choropleth** by default: each unit is filled by its value, the number of rows
or the sum or average of a numeric column (**Colour by**). Rows that name the same unit are combined into one.

Set **Draw as** to **Bubbles** to draw a point inside each unit instead, sized by its value. The point is an
interior point of the unit's shape, so it lands inside even a crescent-shaped unit.

![Three provinces of Ecuador drawn as a choropleth: Pichincha, Guayas and Azuay, each filled in its own colour](/img/plus/regions-ec.jpg)

The tooltip names the unit and where it is: `Azuay, Ecuador` for a province, `Cuenca, Azuay` for a canton. The
placed dataset has `admin_code`, `admin_name` and `country_code` columns next to the query's own, which you can use
in kepler's tooltip, filters and labels. For a state with an ISO 3166-2 code, `admin_code` is that code.

States and districts are not drawn as flows, and cannot be the ends of [network links](/plus/data/network-links).

## See it in the layer tour

The **Regions** map of the [layer tour](/plus/start/templates), installed with the app, places Ecuador's 24 provinces by name, from
a query with a `country` column of `EC` and a `province` column, fed by Grafana's TestData data source, so it draws
with no setup.

Replace the query with your own and keep the column names, or use the Places options to say what each column is.

## When a unit does not land

Read the query's status line in the **Places** options first. A placed query reads like
`A: province → state / province · 22/24 rows placed · choropleth by sum of sales · country from country`, and
anything that kept rows off the map is added to it.

| The status line says                               | What to do                                                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `… need a country (pick one in Places)`            | The rows are districts with no country. Add a country column to the query, or choose **Country**.                                                           |
| `… ambiguous`                                      | A state name exists in several countries. Add a country column or choose **Country**.                                                                       |
| `… ambiguous (add a state column or pick a State)` | A district name repeats inside the country. Add a state column, or choose **State** if every row is in one state.                                           |
| `no districts for` _country_                       | That country has no second-level boundaries in the plugin. Aggregate the query to states instead.                                                           |
| `Shapes for` _country_ `unavailable`               | The country's boundary file could not be downloaded from your Grafana server within 15 seconds. Reload the page; a failure is remembered until then.        |
| `A: province: 40% recognised, not placed`          | Fewer than 80 % of the first 50 values are known state names or codes. Check the spelling, or set **Kind** to **State / province** to place those that fit. |
| `n/m rows placed` and nothing else                 | The other rows are empty, or name units that are not in the data. Compare them with [How names are compared](#how-names-are-compared).                      |

Some common causes:

- **A column of postal abbreviations is not placed.** `CA` or `TX` only count once the row's country is known,
  which the 80 % check cannot assume. Set **Kind** to **State / province**: the column is then placed without the
  check, with the country from a country column or **Country**.
- **A column called `state` says `not placed (no place column)`.** A column named just `state` is more often an
  alert state than a place, so a failed check is not reported for it. Choose it under **Column** to see how much of
  it was recognised.
- **A district name differs from the official one.** County and municipality names follow the boundary data, often
  in the local language and with its own spelling. Look the unit up on [geoBoundaries](https://www.geoboundaries.org)
  and match its name in the query.
- **Boundaries are a little off the base map.** The shapes are simplified to keep the files small, and boundaries
  change over time. The data is as current as the plugin version installed.

## Where the boundaries come from

| Level                       | Source                                                                                                        | Licence                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------- |
| States and provinces        | [Natural Earth](https://www.naturalearthdata.com) Admin 1 states and provinces at 1:10 million, version 5.1.2 | public domain              |
| Counties and municipalities | [geoBoundaries](https://www.geoboundaries.org) gbOpen ADM2 (Runfola et al.), simplified edition               | each country's own licence |

geoBoundaries collects each country's boundaries from a different publisher, under that publisher's licence: public
domain or CC0 for some countries, CC BY, CC BY-SA, ODbL or a national open-data licence for others. The plugin's
`THIRD-PARTY-LICENSES.md` lists the licence and source of every country's file, and a file derived from ODbL or
CC BY-SA data is made available under that same licence. Unlike the DB-IP credit for IP addresses, the panel draws
no boundary credit on the map: if you publish maps of counties or municipalities, check the licences of the
countries you show.

The boundaries ship with the plugin, one file per country, and are served by your Grafana server like the panel's
own files. A file is downloaded only when a query's rows need that country, once per page. Each holds the country's
states and, where there are any, its districts, simplified and compressed: from under 1 KB for a small territory to
about 60 KB for Ecuador, 340 KB for the United States and 690 KB for Brazil. The index of state names and codes is
part of the panel's code, so detecting a state column needs no download. No request goes to Natural Earth,
geoBoundaries or any other third party, so subdivisions work on a Grafana server with no internet access.
