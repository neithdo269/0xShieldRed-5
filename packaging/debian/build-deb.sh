#!/usr/bin/env bash
# Build a Debian/Ubuntu/Mint .deb package from the ShieldRed 5 tree

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
VER="$(head -n1 "$ROOT_DIR/shieldred5/version" | tr -d '\r\n')"
OUT_DIR="${1:-$ROOT_DIR/dist}"
STAGE="$(mktemp -d)"

trap 'rm -rf "$STAGE"' EXIT

command -v dpkg-deb >/dev/null 2>&1 || {
    echo "Error: dpkg-deb is required (install dpkg)." >&2
    exit 1
}

bash "$ROOT_DIR/install.sh" --prefix /usr --destdir "$STAGE"
mkdir -p "$STAGE/DEBIAN"
sed "s/^Version:.*/Version: ${VER}/" "$SCRIPT_DIR/control" > "$STAGE/DEBIAN/control"

mkdir -p "$OUT_DIR"
OUT_DEB="$OUT_DIR/shieldred5_${VER}_all.deb"
dpkg-deb --build --root-owner-group "$STAGE" "$OUT_DEB"
echo "Built Debian package: $OUT_DEB"

