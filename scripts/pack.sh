#!/bin/sh
# Build the Chrome Web Store upload package.
#
# Two things the dashboard enforces:
#   - manifest.json must be at the zip root, not inside a folder;
#   - the manifest must not contain a "key" field.
# The key only pins the ID for unpacked development, so it stays in the repo
# manifest and is stripped from the upload package.
set -eu
cd "$(dirname "$0")/.."

VERSION=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])') \
  || { echo "error: cannot read manifest.json version" >&2; exit 1; }
OUT="dist/Nifty-$VERSION.zip"
OUT_ABS="$PWD/$OUT"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

cp -R manifest.json src icons "$STAGE"/
python3 - "$STAGE/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as fh:
    manifest = json.load(fh)
manifest.pop("key", None)
with open(path, "w") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY

mkdir -p dist
rm -f "$OUT"
(cd "$STAGE" && zip -q -r -X "$OUT_ABS" manifest.json src icons -x '*.DS_Store' '*/._*')
unzip -tq "$OUT" >/dev/null || { echo "error: $OUT is corrupt" >&2; exit 1; }
python3 - "$OUT" <<'PY'
import json, sys, zipfile
manifest = json.loads(zipfile.ZipFile(sys.argv[1]).read("manifest.json"))
if "key" in manifest:
    raise SystemExit("error: packaged manifest still contains key")
print("version", manifest["version"], "| key: none")
PY

printf '%s\n' "$OUT"
printf 'files: %s  size: %s\n' "$(unzip -Z1 "$OUT" | wc -l | tr -d ' ')" "$(du -h "$OUT" | cut -f1 | tr -d ' ')"
