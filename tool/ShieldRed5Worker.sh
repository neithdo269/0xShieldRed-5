#!/usr/bin/env bash
# ShieldRed 5 Linux install / non-destructive / update worker (bug-fixed)

set -u
. ./tool/shieldred5_lib.sh
sr5_init_log "$PWD"

print_usage() {
    echo 'Usage:  ShieldRed5_Linux.sh CMD [ OPTION ] /dev/sdX'
    echo '  CMD:'
    echo '   -i             install ShieldRed 5 to sdX (fails if already installed)'
    echo '   -I             force install ShieldRed 5 to sdX (destroys existing data)'
    echo '   -u             upgrade ShieldRed 5 on sdX (preserves data partition)'
    echo '   -l             list ShieldRed 5 installation information on sdX'
    echo '   --doctor       check Linux distribution and required dependencies'
    echo '   --install-deps auto-install required dependencies via distro package manager'
    echo ''
    echo '  OPTION: (optional)'
    echo '   -r SIZE_MB     preserve some space (in MiB) at the bottom of the disk'
    echo '   -s/-S          enable/disable Secure Boot support (default: enabled)'
    echo '   -g             use GPT partition style (default: MBR; auto for >2TB)'
    echo '   -L LABEL       label of the 1st exFAT partition (default: "ShieldRed 5")'
    echo '   -y             skip interactive confirmation prompt'
    echo '   -V, --version  show ShieldRed 5 version'
    echo ''
}

MODE=""
FORCE=0
SECUREBOOT=""
VTGPT="NO"
RESERVE_MB=0
VTNEW_LABEL="ShieldRed 5"
NON_INTERACTIVE=0
RAW_DISK=""
WAIT_SEC=1

while [ $# -gt 0 ]; do
    case "$1" in
        -i) MODE="install" ;;
        -I) MODE="install"; FORCE=1 ;;
        -u) MODE="update" ;;
        -l) MODE="list" ;;
        --doctor|--check) sr5_check_deps; exit $? ;;
        --install-deps) MODE="install_deps" ;;
        -s) SECUREBOOT="YES" ;;
        -S) SECUREBOOT="NO" ;;
        -g) VTGPT="YES" ;;
        -y|--yes) NON_INTERACTIVE=1 ;;
        -r)
            [ $# -ge 2 ] || { vterr "-r requires a size argument in MiB"; exit 1; }
            shift
            RESERVE_MB="$1"
            ;;
        -L)
            [ $# -ge 2 ] || { vterr "-L requires a volume label argument"; exit 1; }
            shift
            VTNEW_LABEL="$1"
            ;;
        -V|--version)
            cur_v="$(head -n1 ./shieldred5/version | tr -d '\r\n')"
            echo "ShieldRed 5 ${cur_v:-1.1.2}"
            exit 0
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        -*)
            vterr "Unknown option: $1"
            print_usage
            exit 1
            ;;
        *)
            if [ -n "$RAW_DISK" ]; then
                vterr "Unexpected extra argument: $1"
                print_usage
                exit 1
            fi
            RAW_DISK="$1"
            ;;
    esac
    shift
done

if [ "$MODE" = "install_deps" ]; then
    sr5_install_deps "$NON_INTERACTIVE"
    exit $?
fi

if [ -z "$MODE" ] || [ -z "$RAW_DISK" ]; then
    print_usage
    exit 1
fi

if ! echo "$RESERVE_MB" | grep -Eq '^[0-9]+$'; then
    vterr "Invalid reserve size: $RESERVE_MB (must be non-negative integer MiB)"
    exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
    vterr "Root privileges required. Please run with sudo."
    exit 1
fi

DISK="$(readlink -f "$RAW_DISK" 2>/dev/null || python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$RAW_DISK")"
if ! [ -b "$DISK" ]; then
    vterr "$DISK is not a valid block device!"
    exit 1
fi

CUR_VER="$(head -n1 ./shieldred5/version | tr -d '\r\n')"
SHIELDRED5_SECTOR_NUM=65536

if [ "$MODE" = "list" ]; then
    if is_shieldred5_disk "$DISK"; then
        ver="$(get_disk_shieldred5_version "$DISK")"
        pstyle="MBR"
        is_disk_gpt "$DISK" && pstyle="GPT"
        sb="Disabled"
        is_disk_secure_boot "$DISK" && sb="Enabled"
        echo "ShieldRed 5 Version in Disk: ${ver:-unknown}"
        echo "Disk Partition Style       : $pstyle"
        echo "Secure Boot Support        : $sb"
        exit 0
    else
        vtwarn "$DISK does not contain a valid ShieldRed 5 installation."
        exit 1
    fi
fi

# Check whether updating
if [ "$MODE" = "update" ]; then
    if ! is_shieldred5_disk "$DISK"; then
        vtwarn "$DISK does not contain ShieldRed 5. Use -i or -I to install."
        exit 1
    fi

    old_ver="$(get_disk_shieldred5_version "$DISK")"
    old_sb="NO"
    is_disk_secure_boot "$DISK" && old_sb="YES"
    [ -z "$SECUREBOOT" ] && SECUREBOOT="$old_sb"
    echo "Upgrade operation is safe; data in partition 1 will be preserved."
    echo "Current version in disk: ${old_ver:-unknown}  -->  New version: $CUR_VER (Secure Boot: $SECUREBOOT)"

    if [ "$NON_INTERACTIVE" -eq 0 ]; then
        printf "Continue upgrading %s? (y/n) " "$DISK"
        read -r answer
        case "$answer" in
            y|Y|yes|YES) ;;
            *) echo "Aborted."; exit 0 ;;
        esac
    fi

    check_umount_disk "$DISK" || exit 1

    PART2="$(get_disk_part_name "$DISK" 2)"
    if is_disk_gpt "$DISK"; then
        PART1_TYPE="EE"
    else
        PART1_TYPE="MBR"
    fi
    PART2_START="$(python3 ./tool/shieldred5_helper.py part2-start "$DISK" 2>/dev/null)" || PART2_START=""

    if [ -z "$PART2_START" ] || [ "$PART2_START" -lt 2048 ]; then
        vterr "Invalid partition 2 start sector ($PART2_START) on $DISK"
        exit 1
    fi

    sr5_dd_sync if=./boot/boot.img of="$DISK" bs=1 count=440 || { vterr "Failed writing boot.img"; exit 1; }
    if [ "$PART1_TYPE" = "EE" ]; then
        sr5_dd_xz ./boot/core.img.xz "$DISK" 34 2014 || { vterr "Failed writing core.img"; exit 1; }
    else
        sr5_dd_xz ./boot/core.img.xz "$DISK" 1 2047 || { vterr "Failed writing core.img"; exit 1; }
    fi
    sr5_dd_xz ./shieldred5/shieldred5.disk.img.xz "$DISK" "$PART2_START" "$SHIELDRED5_SECTOR_NUM" || { vterr "Failed writing EFI image"; exit 1; }

    if [ "$SECUREBOOT" = "NO" ]; then
        sr5_cli partresize -s "$DISK" "$PART2_START" || { vterr "Failed disabling Secure Boot"; exit 1; }
    fi
    if [ "$PART1_TYPE" = "EE" ]; then
        sr5_cli gpt -f "$DISK" || { vterr "Failed updating GPT attributes"; exit 1; }
    fi
    sync
    vtinfo "Update ShieldRed 5 ($CUR_VER) on $DISK successfully finished."
    exit 0
fi

# Preflight dependencies before any destructive write in install mode
if ! command -v parted >/dev/null 2>&1; then
    vterr "parted is required to partition $DISK."
    sr5_print_missing_hint
    exit 1
fi
_find_mkfs_vfat >/dev/null 2>&1 || {
    vterr "mkfs.vfat / mkfs.fat is required (install dosfstools)."
    sr5_print_missing_hint
    exit 1
}
if ! command -v mkfs.exfat >/dev/null 2>&1 && ! command -v mkexfatfs >/dev/null 2>&1; then
    vterr "mkfs.exfat / mkexfatfs is required (install exfatprogs or exfat-utils)."
    sr5_print_missing_hint
    exit 1
fi

# Install mode (-i / -I)
if [ "$FORCE" -eq 0 ] && is_shieldred5_disk "$DISK"; then
    cur_installed="$(get_disk_shieldred5_version "$DISK")"
    vterr "$DISK already has ShieldRed 5 ($cur_installed) installed. Use -u to upgrade or -I to overwrite."
    exit 1
fi

DISK_BYTES="$(get_disk_size_in_byte "$DISK")"
TOTAL_SECTORS=$((DISK_BYTES / 512))
DISK_GB=$((DISK_BYTES / 1000000000))

[ -z "$SECUREBOOT" ] && SECUREBOOT="YES"

if [ "$DISK_BYTES" -gt 2199023255552 ] && [ "$VTGPT" = "NO" ]; then
    vtwarn "Disk > 2TB detected ($DISK_GB GB); automatically switching to GPT partition style."
    VTGPT="YES"
fi

echo ""
echo "**********************************************"
echo "Attention:"
echo "You will install ShieldRed 5 ($CUR_VER) to $DISK ($DISK_GB GB)."
echo "Partition Style : $( [ "$VTGPT" = "YES" ] && echo GPT || echo MBR )"
echo "Secure Boot     : $SECUREBOOT"
echo "Volume Label    : $VTNEW_LABEL"
echo "All existing data on $DISK will be LOST!"
echo "**********************************************"
echo ""

if [ "$NON_INTERACTIVE" -eq 0 ]; then
    printf "Continue? (y/n) "
    read -r answer
    case "$answer" in
        y|Y|yes|YES) ;;
        *) echo "Aborted."; exit 0 ;;
    esac
    printf "Double-check: ALL DATA on %s will be formatted. Continue? (y/n) " "$DISK"
    read -r answer2
    case "$answer2" in
        y|Y|yes|YES) ;;
        *) echo "Aborted."; exit 0 ;;
    esac
fi

check_umount_disk "$DISK" || exit 1

RESERVED_SECTORS=$((RESERVE_MB * 2048))
GPT_TAIL=0
[ "$VTGPT" = "YES" ] && GPT_TAIL=33

PART2_START_SEC=$((TOTAL_SECTORS - GPT_TAIL - RESERVED_SECTORS - SHIELDRED5_SECTOR_NUM))
PART1_END_SEC=$((PART2_START_SEC - 1))

if [ "$PART1_END_SEC" -le 4096 ]; then
    vterr "Disk $DISK is too small (or reserved size ${RESERVE_MB}MiB is too large)."
    exit 1
fi

# Cluster size heuristic for exFAT
if [ "$DISK_BYTES" -ge 34359738368 ]; then
    CLUSTER_SECTORS=256   # 128 KiB
else
    CLUSTER_SECTORS=64    # 32 KiB
fi

# Zero first 1 MiB + last 1 MiB to clear stale partition/FS signatures cleanly
sr5_dd_sync if=/dev/zero of="$DISK" bs=512 count=2048 || { vterr "Failed wiping start of $DISK"; exit 1; }
sr5_dd_sync if=/dev/zero of="$DISK" bs=512 count=34 seek=$((TOTAL_SECTORS - 34)) 2>/dev/null || true

if [ "$VTGPT" = "YES" ]; then
    format_shieldred5_disk_gpt "$PART1_END_SEC" "$PART2_START_SEC" "$DISK" || exit 1
else
    format_shieldred5_disk_mbr "$PART1_END_SEC" "$PART2_START_SEC" "$DISK" || exit 1
fi

PART1="$(get_disk_part_name "$DISK" 1)"
if ! [ -b "$PART1" ]; then
    vterr "Partition 1 ($PART1) does not exist after partitioning."
    exit 1
fi

vtinfo "Formatting partition 1 ($PART1) as exFAT [$VTNEW_LABEL] ..."
format_part1_exfat "$PART1" "$VTNEW_LABEL" "$CLUSTER_SECTORS" || exit 1

vtinfo "Writing ShieldRed 5 boot & EFI images to $DISK ..."
sr5_dd_sync if=./boot/boot.img of="$DISK" bs=1 count=446 || { vterr "Failed writing boot.img"; exit 1; }
if [ "$VTGPT" = "YES" ]; then
    sr5_dd_xz ./boot/core.img.xz "$DISK" 34 2014 || { vterr "Failed writing core.img"; exit 1; }
else
    sr5_dd_xz ./boot/core.img.xz "$DISK" 1 2047 || { vterr "Failed writing core.img"; exit 1; }
fi
sr5_dd_xz ./shieldred5/shieldred5.disk.img.xz "$DISK" "$PART2_START_SEC" "$SHIELDRED5_SECTOR_NUM" || { vterr "Failed writing shieldred5.disk.img"; exit 1; }

if [ "$SECUREBOOT" = "NO" ]; then
    vtinfo "Disabling Secure Boot shim on EFI partition ..."
    sr5_cli partresize -s "$DISK" "$PART2_START_SEC" || { vterr "Failed disabling Secure Boot"; exit 1; }
fi

if [ "$VTGPT" = "YES" ]; then
    sr5_cli gpt -f "$DISK" || { vterr "Failed fixing GPT partition attributes"; exit 1; }
fi

sync
vtinfo "Congratulations! ShieldRed 5 ($CUR_VER) has been successfully installed to $DISK."
