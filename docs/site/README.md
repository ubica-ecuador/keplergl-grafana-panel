# Documentation site

The plugin's documentation, built with [VitePress](https://vitepress.dev) and published to GitHub
Pages by [`.github/workflows/docs.yml`](../../.github/workflows/docs.yml).

## Why it is a separate npm package

VitePress pulls in Vite, Vue and Shiki. None of that belongs in the plugin's dependency tree,
which CI installs with `npm ci` before `typecheck`, `lint`, `build` and the end-to-end run. Keeping
the site in its own package with its own lockfile leaves the plugin's toolchain — and the
`.config/` directory managed by `@grafana/create-plugin` — completely untouched.

The cost is one extra install. From the repository root:

```bash
npm --prefix docs/site install   # once
npm run docs:dev                 # http://localhost:5173
npm run docs:build               # builds into .vitepress/dist
npm run docs:preview             # serves the built output
npm run docs:linkcheck           # checks outbound links in the built output
```

`docs:linkcheck` is deliberately not part of the build. VitePress already fails the build on a
broken _internal_ link; outbound links are checked separately and non-blocking, because a third
party's outage must not stop us publishing.

## The base path

A project Pages site is served from `/<repo>/`, so every asset URL carries that prefix.
`.vitepress/config.ts` reads it from `DOCS_BASE`, defaulting to `/kepler-grafana/`, and the
workflow passes the repository's actual name. Renaming the repository therefore cannot silently
break every image on the site.

To check a build under a different prefix:

```bash
DOCS_BASE=/some-other-name/ npm run docs:build
```

## Screenshots

Images live in `public/img/` and are **committed**, not generated in CI — building them would mean
Docker, a running Grafana and outbound access to every dataset the tutorials use. They are
regenerated locally against the dev benches; see the Contributing page of the site itself.

## Writing conventions

- **British English**, matching the plugin's README.
- **Do not re-document kepler.gl or deck.gl.** Their own documentation is maintained and ours would
  go stale on every version bump. Orient the reader, link out, and own the _deltas_ — the places
  where this panel departs from stock kepler. See `reference/differences-from-kepler.md`.
- **Qualify every outbound link with the version it was true of.** kepler.gl's public docs describe
  the 3.2 stable line; this plugin ships a 3.3.0 pre-release that registers more layer types than
  those docs list. The pinned versions live in `VERSIONS` in `.vitepress/config.ts`.
- **Check claims against the installed packages**, not against upstream prose or memory.
