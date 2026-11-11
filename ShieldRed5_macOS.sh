#!/usr/bin/env bash
# ShieldRed 5 macOS installer entrypoint

set -u

OS_NAME="$(uname -s 2>/dev/null || echo Unknown)"
if [ "$OS_NAME" = "Linux" ]; then
    echo "Detected Linux. Please run: sudo bash ./ShieldRed5_Linux.sh ..." >&2
    exit 1
fi

SOURCE="$0"
while [ -L "$SOURCE" ]; do
    DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
    TARGET="$(readlink "$SOURCE")"
    case "$TARGET" in
        /*) SOURCE="$TARGET" ;;
        *)  SOURCE="$DIR/$TARGET" ;;
    esac
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"

if ! [ -f "$SCRIPT_DIR/boot/boot.img" ] || ! [ -f "$SCRIPT_DIR/shieldred5/shieldred5.disk.img.xz" ]; then
    echo "Please run ShieldRed5_macOS.sh from the extracted ShieldRed 5 root directory." >&2
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required on macOS (Xcode Command Line Tools or python.org installer)." >&2
    exit 1
fi

if [ "$OS_NAME" = "Darwin" ] && ! command -v diskutil >/dev/null 2>&1; then
    echo "Error: diskutil not found in PATH." >&2
    exit 1
fi

curver="1.1.2"
if [ -f "$SCRIPT_DIR/shieldred5/version" ]; then
    curver="$(head -n1 "$SCRIPT_DIR/shieldred5/version" | tr -d '\r\n')"
fi

echo ""
echo "**********************************************"
echo "      ShieldRed 5: $curver  (macOS)"
echo "**********************************************"
echo ""

LOG_TARGET="/tmp/shieldred5.log"
case "$SCRIPT_DIR" in
    /usr/*|/opt/*|*/node_modules/*|/nix/store/*)
        mkdir -p "${HOME:-/tmp}/Library/Logs" 2>/dev/null || true
        if [ -w "${HOME:-/tmp}/Library/Logs" ]; then
            LOG_TARGET="${HOME:-/tmp}/Library/Logs/shieldred5.log"
        fi
        ;;
    *)
        if [ -w "$SCRIPT_DIR/log.txt" ] || { ! [ -e "$SCRIPT_DIR/log.txt" ] && [ -w "$SCRIPT_DIR" ]; }; then
            LOG_TARGET="$SCRIPT_DIR/log.txt"
        fi
        ;;
esac
echo "############# ShieldRed5_macOS $* ################" >> "$LOG_TARGET" 2>/dev/null || true

exec python3 "$SCRIPT_DIR/tool/shieldred5_macos.py" "$@"
