#!/usr/bin/env bash
# Packages the built plugin in ./$PLUGIN_ID as the `edge` pre-release: main at
# one commit, not a release. Run by the `edge` job in .github/workflows/ci.yml.
#
#   PLUGIN_ID=ubica-keplergl-panel VERSION=1.0.1 GITHUB_SHA=<sha> scripts/package-edge.sh
#
# Writes $PLUGIN_ID-edge.zip and $PLUGIN_ID-edge.zip.sha256 next to the folder,
# and prints the version it stamped.
set -euo pipefail
: "${PLUGIN_ID:?}" "${VERSION:?}" "${GITHUB_SHA:?}"

edge_version="${VERSION}-edge.${GITHUB_SHA::7}"

# The version names the commit, so Grafana's plugin page says what runs.
jq --arg v "$edge_version" '.info.version = $v' "${PLUGIN_ID}/plugin.json" > "${PLUGIN_ID}.plugin.json"
mv "${PLUGIN_ID}.plugin.json" "${PLUGIN_ID}/plugin.json"

# A signature does not survive that edit. Without MANIFEST.txt the panel loads
# as unsigned, which an install running edge allows already.
rm -f "${PLUGIN_ID}/MANIFEST.txt"

rm -f "${PLUGIN_ID}-edge.zip"
zip -qr "${PLUGIN_ID}-edge.zip" "${PLUGIN_ID}"
sha256sum "${PLUGIN_ID}-edge.zip" > "${PLUGIN_ID}-edge.zip.sha256"

echo "$edge_version"
