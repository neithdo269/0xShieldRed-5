#!/usr/bin/env bash
# ShieldRed 5 system-wide installer for Linux and macOS

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PREFIX="/usr/local"
BINDIR=""
LIBDIR=""
DOCDIR=""
DESTDIR=""
INSTALL_DEPS=0
NON_INTERACTIVE=0

usage() {
    cat <<'EOF'
Usage: sudo bash ./install.sh [OPTIONS]

Options:
  --prefix DIR       Install prefix (default: /usr/local)
  --bindir DIR       Binary wrapper directory (default: <prefix>/bin)
  --libdir DIR       Payload directory (default: <prefix>/lib/shieldred5)
  --docdir DIR       Documentation directory (default: <prefix>/share/doc/shieldred5)
  --destdir DIR      Staging root directory for distro packaging (default: empty)
  --install-deps     On Linux, auto-install required distro packages first
  -y, --yes          Skip interactive confirmation prompts
  -h, --help         Show this help message
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --prefix)
            [ $# -ge 2 ] || { echo "Error: --prefix requires a directory" >&2; exit 1; }
            PREFIX="$2"; shift ;;
        --bindir)
            [ $# -ge 2 ] || { echo "Error: --bindir requires a directory" >&2; exit 1; }
            BINDIR="$2"; shift ;;
        --libdir)
            [ $# -ge 2 ] || { echo "Error: --libdir requires a directory" >&2; exit 1; }
            LIBDIR="$2"; shift ;;
        --docdir)
            [ $# -ge 2 ] || { echo "Error: --docdir requires a directory" >&2; exit 1; }
            DOCDIR="$2"; shift ;;
        --destdir)
            [ $# -ge 2 ] || { echo "Error: --destdir requires a directory" >&2; exit 1; }
            DESTDIR="$2"; shift ;;
        --install-deps)
            INSTALL_DEPS=1 ;;
        -y|--yes)
            NON_INTERACTIVE=1 ;;
        -h|--help)
            usage; exit 0 ;;
        *)
            echo "Error: Unknown option: $1" >&2
            usage; exit 1 ;;
    esac
    shift
done

[ -n "$BINDIR" ] || BINDIR="${PREFIX}/bin"
[ -n "$LIBDIR" ] || LIBDIR="${PREFIX}/lib/shieldred5"
[ -n "$DOCDIR" ] || DOCDIR="${PREFIX}/share/doc/shieldred5"

if [ ! -f "$SCRIPT_DIR/boot/boot.img" ] || [ ! -f "$SCRIPT_DIR/shieldred5/shieldred5.disk.img.xz" ]; then
    echo "Error: Run install.sh from the extracted ShieldRed 5 root directory." >&2
    exit 1
fi

if [ "$INSTALL_DEPS" -eq 1 ] && [ "$(uname -s)" = "Linux" ]; then
    . "$SCRIPT_DIR/tool/shieldred5_lib.sh"
    sr5_install_deps "$NON_INTERACTIVE"
fi

if [ -z "$DESTDIR" ] && [ ! -w "$(dirname "${BINDIR}")" ] && [ "$(id -u)" -ne 0 ]; then
    echo "Error: Root privileges required to install into $PREFIX. Re-run with sudo or pass --prefix ~/.local." >&2
    exit 1
fi

STAGE_LIB="${DESTDIR}${LIBDIR}"
STAGE_BIN="${DESTDIR}${BINDIR}"
STAGE_DOC="${DESTDIR}${DOCDIR}"

rm -rf "$STAGE_LIB"
mkdir -p "$STAGE_LIB" "$STAGE_BIN" "$STAGE_DOC"

cp -R "$SCRIPT_DIR/boot" "$STAGE_LIB/"
cp -R "$SCRIPT_DIR/plugin" "$STAGE_LIB/"
cp -R "$SCRIPT_DIR/shieldred5" "$STAGE_LIB/"
cp -R "$SCRIPT_DIR/tool" "$STAGE_LIB/"
cp "$SCRIPT_DIR/ShieldRed5_Linux.sh" "$STAGE_LIB/"
cp "$SCRIPT_DIR/ShieldRed5_macOS.sh" "$STAGE_LIB/"
cp "$SCRIPT_DIR/README.txt" "$STAGE_DOC/README.txt"

if [ -d "$SCRIPT_DIR/bin" ]; then
    cp -R "$SCRIPT_DIR/bin" "$STAGE_LIB/"
    [ -f "$SCRIPT_DIR/package.json" ] && cp "$SCRIPT_DIR/package.json" "$STAGE_LIB/"
fi

chmod 0755 \
    "$STAGE_LIB/ShieldRed5_Linux.sh" \
    "$STAGE_LIB/ShieldRed5_macOS.sh" \
    "$STAGE_LIB/tool/ShieldRed5Worker.sh" \
    "$STAGE_LIB/tool/shieldred5_lib.sh" \
    "$STAGE_LIB/tool/shieldred5_helper.py" \
    "$STAGE_LIB/tool/shieldred5_macos.py"

if [ -d "$STAGE_LIB/bin" ]; then
    chmod 0755 "$STAGE_LIB"/bin/*.js 2>/dev/null || true
fi

cat > "$STAGE_BIN/shieldred5" <<EOF
#!/usr/bin/env bash
set -u
SHIELDRED5_HOME="$LIBDIR"
if [ "\${1:-}" = "--plugson" ] || [ "\${1:-}" = "--distro-cmd" ] || [ "\${1:-}" = "--linux-deps" ]; then
    if command -v node >/dev/null 2>&1 && [ -f "\$SHIELDRED5_HOME/bin/shieldred5.js" ]; then
        exec node "\$SHIELDRED5_HOME/bin/shieldred5.js" "\$@"
    fi
    echo "Error: Node.js (>=18) is required for \$1." >&2
    exit 1
fi
if [ "\$(uname -s 2>/dev/null || echo Unknown)" = "Darwin" ]; then
    exec bash "\$SHIELDRED5_HOME/ShieldRed5_macOS.sh" "\$@"
fi
exec bash "\$SHIELDRED5_HOME/ShieldRed5_Linux.sh" "\$@"
EOF
chmod 0755 "$STAGE_BIN/shieldred5"

cat > "$STAGE_BIN/shieldred5-plugson" <<EOF
#!/usr/bin/env bash
set -u
SHIELDRED5_HOME="$LIBDIR"
if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js (>=18) is required to run shieldred5-plugson." >&2
    exit 1
fi
exec node "\$SHIELDRED5_HOME/bin/shieldred5-plugson.js" "\$@"
EOF
chmod 0755 "$STAGE_BIN/shieldred5-plugson"

echo "ShieldRed 5 installed to ${STAGE_LIB}"
echo "Commands installed in ${STAGE_BIN}/shieldred5 and ${STAGE_BIN}/shieldred5-plugson"
echo "Documentation: ${STAGE_DOC}/README.txt"

