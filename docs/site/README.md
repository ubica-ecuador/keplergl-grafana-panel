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

It also catches something VitePress does not: **raw HTML `href`s are not rewritten**. VitePress
appends `.html` to markdown links but leaves `<a href="…">` alone, so a hand-written anchor in an
HTML block needs the extension spelled out — `./points-and-aggregation.html#point`.

Note that `docs:linkcheck` rebuilds with `DOCS_BASE=/` first, because linkinator serves `dist` as
the web root and every link would otherwise 404 against the deployed prefix. It therefore leaves
`dist` built for the **root** path — run `npm run docs:build` again before serving it locally. CI is
unaffected: the workflow always builds fresh with the repository's own base.

## The domain and the base path

The site is published at **`docs.ubica.dev`**, its own domain. Two things make that work, and
**a `CNAME` file in the built output is not one of them** — GitHub's documentation is explicit
that when a site is published from an Actions workflow, as this one is, "any existing CNAME file
is ignored and is not required":

- The domain is set in **Settings → Pages**, which is the only place it lives.
- DNS carries a `CNAME` record from `docs` to `ubica-ecuador.github.io`.

Owning the domain means the published URLs survive a rename of the repository or a move to
another organisation: only the DNS record would change. GitHub redirects the default
`ubica-ecuador.github.io/keplergl-grafana-panel/` here with a 301.

Because the site is served from the root of that domain, asset URLs carry no prefix.
`.vitepress/config.ts` reads the prefix from `DOCS_BASE`, defaulting to `/`, and the workflow
passes it explicitly. A project Pages site _without_ a custom domain is served from `/<repo>/`
instead, which is what GitHub's default domain still redirects from:

```bash
DOCS_BASE=/keplergl-grafana-panel/ npm run docs:build
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
