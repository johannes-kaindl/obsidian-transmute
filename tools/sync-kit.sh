#!/usr/bin/env bash
# Kopiert Kit-Module aus dem Nachbar-Repo nach src/vendor/kit/.
# Vendored Code wird NIE von Hand editiert — Aenderungen gehoeren ins Kit, dann erneut syncen.
set -euo pipefail

KIT="${KIT_DIR:-../obsidian-kit}"
DEST="src/vendor/kit"
MODULES=(endpoint endpoint_config endpoint_diagnostics settings i18n think-splitter reasoning timeout)

[ -d "$KIT/src/pure" ] || { echo "Kit nicht gefunden unter $KIT (KIT_DIR setzen)" >&2; exit 1; }
mkdir -p "$DEST"

for m in "${MODULES[@]}"; do
  src="$KIT/src/pure/$m.ts"
  [ -f "$src" ] || { echo "fehlt: $src" >&2; exit 1; }
  { echo "// vendored from obsidian-kit, src/pure/$m.ts — nicht von Hand editieren."; cat "$src"; } > "$DEST/$m.ts"
  echo "vendored: $m"
done

version=$(node -p "require('$KIT/package.json').version")
sha=$(git -C "$KIT" rev-parse --short HEAD)
cat > "$DEST/VENDOR.json" <<EOF
{
  "source": "obsidian-kit",
  "version": "$version",
  "sha": "$sha",
  "vendored": "${MODULES[*]}",
  "note": "Verbatim snapshot. Never hand-edit — change the kit, then re-run tools/sync-kit.sh."
}
EOF
echo "VENDOR.json geschrieben (v$version, $sha)"
