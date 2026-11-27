# Contributing to Kepler Geospatial Maps for Grafana

Bugs and questions are welcome as [GitHub issues](https://github.com/ubica-ecuador/keplergl-grafana-panel/issues).
This page is how to build, test and run the plugin from a clone; the plugin's own README is what
the Grafana catalog shows its users.

## Building and testing

```bash
npm install
npm run dev             # watch build
npm run server          # Grafana 12.0.10 on :3000, plus a strict-CSP one on :3001
npm run server:sources  # a bench on :3002 with DuckDB and Infinity installed
npm run test:ci         # unit tests
npm run e2e             # end-to-end against the running Grafana
```

Requires Node 22+. `dist/` is bind-mounted into the containers, so do **not** `rm -rf dist` while
they are running — that leaves them serving a stale inode. `npm run build` cleans it correctly.

Three of those benches sit at **12.0.10**, the floor of the supported range, which is what catches
accidental use of a newer API. A fourth covers the other end — `docker compose up --build grafana-13`
runs **Grafana 13** on `:3003`, where React 18 becomes React 19, and the suite is expected to pass
there too:

```bash
GRAFANA_URL=http://localhost:3003 npx playwright test --workers=1
```

To publish a bench rather than run one locally, copy `docker-compose.override.example.yml` to
`docker-compose.override.yml` and edit it. Compose picks that name up automatically; it is
gitignored because it names an external network and a public hostname, so it must not reach anyone
else's checkout.

The documentation site lives in `docs/site` as its own npm package:

```bash
npm --prefix docs/site install
npm run docs:dev
```

The [contributing guide](https://docs.ubica.dev/contributing.html)
covers the three benches, the provisioned dashboards, the browser verification scripts and how the
documentation screenshots are regenerated.
