#!/usr/bin/env bash
# ShieldRed 5 system-wide uninstaller for Linux and macOS

set -euo pipefail

PREFIX="/usr/local"
BINDIR=""
LIBDIR=""
DOCDIR=""
DESTDIR=""

usage() {
    cat <<'EOF'
Usage: sudo bash ./uninstall.sh [OPTIONS]

Options:
  --prefix DIR   Install prefix (default: /usr/local)
  --bindir DIR   Binary wrapper directory (default: <prefix>/bin)
  --libdir DIR   Payload directory (default: <prefix>/lib/shieldred5)
  --docdir DIR   Documentation directory (default: <prefix>/share/doc/shieldred5)
  --destdir DIR  Staging root directory (default: empty)
  -h, --help     Show this help message
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --prefix) PREFIX="$2"; shift ;;
        --bindir) BINDIR="$2"; shift ;;
        --libdir) LIBDIR="$2"; shift ;;
        --docdir) DOCDIR="$2"; shift ;;
        --destdir) DESTDIR="$2"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Error: Unknown option: $1" >&2; usage; exit 1 ;;
    esac
    shift
done

[ -n "$BINDIR" ] || BINDIR="${PREFIX}/bin"
[ -n "$LIBDIR" ] || LIBDIR="${PREFIX}/lib/shieldred5"
[ -n "$DOCDIR" ] || DOCDIR="${PREFIX}/share/doc/shieldred5"

rm -f "${DESTDIR}${BINDIR}/shieldred5" "${DESTDIR}${BINDIR}/shieldred5-plugson"
rm -rf "${DESTDIR}${LIBDIR}" "${DESTDIR}${DOCDIR}"

echo "ShieldRed 5 uninstalled from ${DESTDIR}${PREFIX}."

