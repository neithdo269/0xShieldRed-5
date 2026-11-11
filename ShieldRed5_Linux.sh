#!/usr/bin/env bash
# ShieldRed 5 Linux installer entrypoint

set -u

OS_NAME="$(uname -s 2>/dev/null || echo Unknown)"
if [ "$OS_NAME" = "Darwin" ]; then
    echo "Detected macOS. Please run: sudo bash ./ShieldRed5_macOS.sh ..." >&2
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
cd "$SCRIPT_DIR" || exit 1

export PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"

ARCH="$(uname -m 2>/dev/null || echo unknown)"
case "$ARCH" in
    aarch64|arm64) TOOLDIR=aarch64 ;;
    x86_64|amd64)  TOOLDIR=x86_64 ;;
    mips64*)       TOOLDIR=mips64el ;;
    *)             TOOLDIR=i386 ;;
esac
export TOOLDIR

if [ -d "./tool/$TOOLDIR" ]; then
    export PATH="$SCRIPT_DIR/tool/$TOOLDIR:$PATH"
fi

curver="1.1.2"
if [ -f ./shieldred5/version ]; then
    curver="$(head -n1 ./shieldred5/version | tr -d '\r\n')"
fi

if [ -f ./tool/shieldred5_lib.sh ]; then
    . ./tool/shieldred5_lib.sh
    sr5_init_log "$SCRIPT_DIR"
fi

case "${1:-}" in
    -V|--version)
        echo "ShieldRed 5 $curver ($TOOLDIR)"
        exit 0
        ;;
    --doctor|--check)
        sr5_check_deps
        exit $?
        ;;
    --install-deps)
        non_int=0
        for arg in "$@"; do
            [ "$arg" = "-y" ] || [ "$arg" = "--yes" ] && non_int=1
        done
        sr5_install_deps "$non_int"
        exit $?
        ;;
esac

echo ""
echo "**********************************************"
echo "      ShieldRed 5: $curver  ($TOOLDIR)"
echo "**********************************************"
echo ""

if ! [ -f ./boot/boot.img ] || ! [ -f ./shieldred5/shieldred5.disk.img.xz ]; then
    if [ -d ./bin ]; then
        echo "Error: current directory contains binaries/archives not extracted properly." >&2
    fi
    echo "Please run ShieldRed5_Linux.sh from the extracted ShieldRed 5 root directory." >&2
    exit 1
fi

case "${1:-}" in
    -h|--help|"")
        exec bash ./tool/ShieldRed5Worker.sh --help
        ;;
esac

if ! command -v python3 >/dev/null 2>&1 && ! [ -x "./tool/$TOOLDIR/vtoycli" ]; then
    echo "Error: python3 (or native vtoycli) is required to run ShieldRed 5 on Linux." >&2
    sr5_print_missing_hint
    exit 1
fi

sr5_log "############# ShieldRed5_Linux $* [$TOOLDIR] ################"

# Normalize executable flags if any optional native Linux helper tools are bundled
if [ -d "./tool/$TOOLDIR" ] && [ -w "./tool/$TOOLDIR" ]; then
    chmod +x ./tool/$TOOLDIR/* 2>/dev/null || true
    for xzbin in ./tool/"$TOOLDIR"/*.xz; do
        [ -f "$xzbin" ] || continue
        out="${xzbin%.xz}"
        if ! [ -f "$out" ]; then
            xz -dc "$xzbin" > "$out" 2>/dev/null || true
            chmod +x "$out" 2>/dev/null || true
        fi
    done
fi

if [ -w ./tool ]; then
    chmod +x ./tool/ShieldRed5Worker.sh ./tool/shieldred5_lib.sh ./tool/shieldred5_helper.py 2>/dev/null || true
fi

exec bash ./tool/ShieldRed5Worker.sh "$@"
