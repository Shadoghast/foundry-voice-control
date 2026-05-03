#!/usr/bin/env bash
#
# Build a release zip of the Foundry Voice Control module suitable for
# attaching to a GitHub release.
#
# The zip contains the *contents* of module/ (not the module/ directory
# itself), so it extracts cleanly into <userData>/Data/modules/foundry-
# voice-control/. Dev artifacts (node_modules, package-lock.json, tests/,
# vitest config, etc.) are excluded.
#
# Usage:
#   ./scripts/build-release.sh           # → release/foundry-voice-control-<version>.zip
#   ./scripts/build-release.sh 0.2.0     # override version (otherwise read from module.json)
#
# Output:
#   release/foundry-voice-control-<version>.zip
#   release/module.json                   # standalone manifest copy for the GitHub release
#
# After building:
#   - Tag the release in git:        git tag v<version> && git push --tags
#   - Create a GitHub Release on that tag and attach BOTH artifacts.
#   - Foundry's manifest URL will be:
#       https://github.com/<user>/foundry-voice-control/releases/latest/download/module.json

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODULE_DIR="$PROJECT_ROOT/module"
RELEASE_DIR="$PROJECT_ROOT/release"

if [ ! -f "$MODULE_DIR/module.json" ]; then
  echo "ERROR: $MODULE_DIR/module.json not found." >&2
  exit 1
fi

# Read version from module.json (or from CLI arg).
if [ -n "${1:-}" ]; then
  VERSION="$1"
else
  VERSION="$(grep -m1 '"version"' "$MODULE_DIR/module.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
fi

if [ -z "$VERSION" ]; then
  echo "ERROR: could not determine version. Pass it as the first argument." >&2
  exit 1
fi

ZIP_NAME="foundry-voice-control-${VERSION}.zip"
ZIP_PATH="$RELEASE_DIR/$ZIP_NAME"

echo "Building Foundry Voice Control v$VERSION"
echo "  source:  $MODULE_DIR"
echo "  output:  $ZIP_PATH"

mkdir -p "$RELEASE_DIR"
rm -f "$ZIP_PATH" "$RELEASE_DIR/module.json"

# Build the zip. -r for recursive; -X drops extended attributes; the cd-and-zip
# pattern produces an archive whose entries are at the top level (module.json,
# scripts/, lang/, styles/) — that's what Foundry expects.
(
  cd "$MODULE_DIR"
  zip -rqX "$ZIP_PATH" \
    module.json \
    lang \
    styles \
    scripts \
    -x "node_modules/*" \
    -x "tests/*" \
    -x "package.json" \
    -x "package-lock.json" \
    -x "vitest.config.mjs" \
    -x "vitest.config.mjs.timestamp-*" \
    -x ".vitest/*" \
    -x ".gitignore" \
    -x ".DS_Store"
)

# Copy module.json next to the zip — GitHub serves it as the manifest URL.
cp "$MODULE_DIR/module.json" "$RELEASE_DIR/module.json"

ZIP_SIZE="$(du -h "$ZIP_PATH" | cut -f1)"
echo
echo "Built $ZIP_NAME ($ZIP_SIZE)"
echo "Manifest copy: $RELEASE_DIR/module.json"
echo
echo "Next steps:"
echo "  1. Update module.json's url / manifest / download fields if you haven't yet."
echo "  2. git tag v$VERSION && git push --tags"
echo "  3. Create a GitHub Release for v$VERSION."
echo "  4. Upload BOTH $ZIP_NAME and module.json as release assets."
echo "  5. Verify: curl -sSI https://github.com/<you>/foundry-voice-control/releases/latest/download/module.json | grep -i location"
