#!/usr/bin/env bash
# A Grafana with this worktree's kepler panel and Chaski side by side, on :3011,
# for tests/explorerToMap.spec.ts. Separate from the shared :3000/:3002 benches.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
chaski="${CHASKI_DIST:-$HOME/dev/ubica/grafana-datasource/dist}"
test -f "$chaski/plugin.json" || { echo "Chaski dist not found at $chaski (set CHASKI_DIST)"; exit 1; }
docker rm -f kepler-chaski-e2e >/dev/null 2>&1 || true
docker run -d --name kepler-chaski-e2e -p 3011:3000 \
  -e GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=ubica-keplergl-panel,ubica-chaski-datasource \
  -v "$here/dist:/var/lib/grafana/plugins/ubica-keplergl-panel" \
  -v "$chaski:/var/lib/grafana/plugins/ubica-chaski-datasource" \
  -v "$here/provisioning-chaski/datasources:/etc/grafana/provisioning/datasources" \
  -v "$here/provisioning-chaski/dashboards:/etc/grafana/provisioning/dashboards" \
  "grafana/grafana-enterprise:${GRAFANA_VERSION:-12.0.10-ubuntu}" >/dev/null
for _ in $(seq 1 90); do curl -sf localhost:3011/api/health >/dev/null && exit 0; sleep 1; done
echo "Grafana did not come up on :3011"; exit 1
