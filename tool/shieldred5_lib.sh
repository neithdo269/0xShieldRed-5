#!/usr/bin/env bash
# ShieldRed 5 Linux helper library (cross-distro, BusyBox-compatible)

sr5_init_log() {
    if [ -n "${SHIELDRED5_LOG_FILE:-}" ]; then
        return 0
    fi
    local base_dir="${1:-$PWD}"
    case "$base_dir" in
        /usr/*|/opt/*|*/node_modules/*|/nix/store/*)
            local state_dir="${XDG_STATE_HOME:-${HOME:-/tmp}/.local/state}/shieldred5"
            if mkdir -p "$state_dir" 2>/dev/null && touch "$state_dir/log.txt" 2>/dev/null; then
                SHIELDRED5_LOG_FILE="$state_dir/log.txt"
            elif touch /tmp/shieldred5.log 2>/dev/null; then
                SHIELDRED5_LOG_FILE="/tmp/shieldred5.log"
            else
                SHIELDRED5_LOG_FILE="/dev/null"
            fi
            ;;
        *)
            if { [ -w "$base_dir/log.txt" ] || { ! [ -e "$base_dir/log.txt" ] && [ -w "$base_dir" ]; }; }; then
                SHIELDRED5_LOG_FILE="$base_dir/log.txt"
            elif touch /tmp/shieldred5.log 2>/dev/null; then
                SHIELDRED5_LOG_FILE="/tmp/shieldred5.log"
            else
                SHIELDRED5_LOG_FILE="/dev/null"
            fi
            ;;
    esac
    export SHIELDRED5_LOG_FILE
}

sr5_log() {
    local logfile="${SHIELDRED5_LOG_FILE:-/dev/null}"
    if [ "$logfile" != "/dev/null" ]; then
        echo "$*" >> "$logfile" 2>/dev/null || true
    fi
}

vtdebug() {
    sr5_log "vtdebug: $*"
}

vtinfo() {
    printf '\033[32m%b\033[0m\n' "$*"
    sr5_log "vtinfo: $*"
}

vtwarn() {
    printf '\033[33m%b\033[0m\n' "$*"
    sr5_log "vtwarn: $*"
}

vterr() {
    printf '\033[31m%b\033[0m\n' "$*" >&2
    sr5_log "vterr: $*"
}

sr5_dd_sync() {
    local flags=""
    if dd --help 2>&1 | grep -q "status="; then
        flags="status=none"
    fi
    if dd --help 2>&1 | grep -q "fsync"; then
        # shellcheck disable=SC2086
        dd $flags conv=fsync "$@"
    else
        # BusyBox/minimal dd fallback
        # shellcheck disable=SC2086
        dd $flags "$@" && sync
    fi
}

sr5_dd_quiet() {
    if dd --help 2>&1 | grep -q "status="; then
        dd status=none "$@"
    else
        dd "$@" 2>/dev/null
    fi
}

sr5_detect_os_field() {
    local key="$1"
    [ -r /etc/os-release ] || return 0
    awk -F= -v k="$key" '$1 == k { gsub(/^["'\'']|["'\'']$/, "", $2); print $2; exit }' /etc/os-release
}

sr5_detect_distro_pretty() {
    local pretty
    pretty="$(sr5_detect_os_field PRETTY_NAME)"
    if [ -n "$pretty" ]; then
        echo "$pretty"
    else
        uname -s 2>/dev/null || echo "Linux"
    fi
}

sr5_detect_pkg_mgr() {
    local variant
    variant="$(sr5_detect_os_field VARIANT_ID | tr '[:upper:]' '[:lower:]')"
    if [ "$variant" = "silverblue" ] || [ "$variant" = "kinoite" ] || [ "$variant" = "sericea" ]; then
        if command -v rpm-ostree >/dev/null 2>&1; then
            echo "rpm-ostree"
            return 0
        fi
    fi

    local mgr
    for mgr in apt-get dnf yum pacman zypper apk xbps-install emerge eopkg swupd slackpkg rpm-ostree nix-shell; do
        if command -v "$mgr" >/dev/null 2>&1; then
            echo "$mgr"
            return 0
        fi
    done
    echo "unknown"
    return 1
}

sr5_distro_install_cmd() {
    local mgr="${1:-$(sr5_detect_pkg_mgr)}"
    case "$mgr" in
        apt-get)
            echo "sudo apt-get update && sudo apt-get install -y bash parted dosfstools exfatprogs xz-utils python3 util-linux"
            ;;
        dnf)
            echo "sudo dnf install -y bash parted dosfstools exfatprogs xz python3 util-linux"
            ;;
        yum)
            echo "sudo yum install -y bash parted dosfstools exfatprogs xz python3 util-linux"
            ;;
        pacman)
            echo "sudo pacman -Sy --needed --noconfirm bash parted dosfstools exfatprogs xz python util-linux"
            ;;
        zypper)
            echo "sudo zypper --non-interactive install bash parted dosfstools exfatprogs xz python3 util-linux"
            ;;
        apk)
            echo "sudo apk add --no-cache bash parted dosfstools exfatprogs xz python3 util-linux coreutils"
            ;;
        xbps-install)
            echo "sudo xbps-install -Sy bash parted dosfstools exfatprogs xz python3 util-linux"
            ;;
        emerge)
            echo "sudo emerge --ask=n app-shells/bash sys-block/parted sys-fs/dosfstools sys-fs/exfatprogs app-arch/xz-utils dev-lang/python sys-apps/util-linux"
            ;;
        eopkg)
            echo "sudo eopkg install -y bash parted dosfstools exfatprogs xz python3 util-linux"
            ;;
        swupd)
            echo "sudo swupd bundle-add sysadmin-basic python3-basic storage-utils"
            ;;
        rpm-ostree)
            echo "rpm-ostree install parted dosfstools exfatprogs python3"
            ;;
        nix-shell)
            echo "nix-shell -p bash parted dosfstools exfatprogs xz python3 util-linux"
            ;;
        slackpkg)
            echo "Install bash, parted, dosfstools, xz, python3, util-linux (and exfatprogs via SlackBuilds.org)"
            ;;
        *)
            echo "Install: bash, parted, dosfstools (mkfs.vfat), exfatprogs (or exfat-utils), xz, python3"
            ;;
    esac
}

sr5_print_missing_hint() {
    local mgr cmd
    mgr="$(sr5_detect_pkg_mgr)"
    cmd="$(sr5_distro_install_cmd "$mgr")"
    vtwarn "Install required Linux dependencies for $(sr5_detect_distro_pretty):"
    echo "  $cmd" >&2
    if [ "$mgr" != "unknown" ] && [ "$mgr" != "nix-shell" ] && [ "$mgr" != "slackpkg" ]; then
        echo "Or run: sudo bash $0 --install-deps" >&2
    fi
}

sr5_check_deps() {
    local missing=0
    local distro mgr cmd
    distro="$(sr5_detect_distro_pretty)"
    mgr="$(sr5_detect_pkg_mgr)"

    echo "ShieldRed 5 Linux Dependency Check"
    echo "  Distro          : $distro"
    echo "  Architecture    : $(uname -m 2>/dev/null || echo unknown) (TOOLDIR=${TOOLDIR:-unknown})"
    echo "  Package Manager : $mgr"
    echo ""

    for c in bash python3 parted dd; do
        if command -v "$c" >/dev/null 2>&1; then
            echo "  [OK]      $c ($(command -v "$c"))"
        else
            echo "  [MISSING] $c"
            missing=1
        fi
    done

    if command -v mkfs.vfat >/dev/null 2>&1; then
        echo "  [OK]      mkfs.vfat ($(command -v mkfs.vfat))"
    elif command -v mkfs.fat >/dev/null 2>&1; then
        echo "  [OK]      mkfs.fat ($(command -v mkfs.fat))"
    else
        echo "  [MISSING] mkfs.vfat / mkfs.fat (dosfstools)"
        missing=1
    fi

    if command -v mkfs.exfat >/dev/null 2>&1; then
        echo "  [OK]      mkfs.exfat ($(command -v mkfs.exfat))"
    elif command -v mkexfatfs >/dev/null 2>&1; then
        echo "  [OK]      mkexfatfs ($(command -v mkexfatfs))"
    else
        echo "  [MISSING] mkfs.exfat / mkexfatfs (exfatprogs or exfat-utils)"
        missing=1
    fi

    if command -v xzcat >/dev/null 2>&1 || command -v xz >/dev/null 2>&1; then
        echo "  [OK]      xz/xzcat"
    else
        echo "  [OPTIONAL] xz/xzcat (Python lzma fallback will be used)"
    fi

    if command -v partprobe >/dev/null 2>&1; then
        echo "  [OK]      partprobe"
    else
        echo "  [OPTIONAL] partprobe"
    fi

    echo ""
    if [ "$missing" -eq 0 ]; then
        vtinfo "All required Linux dependencies are installed."
        return 0
    fi

    cmd="$(sr5_distro_install_cmd "$mgr")"
    vtwarn "Some required dependencies are missing."
    echo "Recommended install command:"
    echo "  $cmd"
    if [ "$mgr" != "unknown" ] && [ "$mgr" != "nix-shell" ] && [ "$mgr" != "slackpkg" ]; then
        echo "Or auto-install with: sudo shieldred5 --install-deps"
    fi
    return 1
}

sr5_install_deps() {
    local non_interactive="${1:-0}"
    local mgr cmd
    mgr="$(sr5_detect_pkg_mgr)"

    if [ "$(id -u)" -ne 0 ]; then
        vterr "Root privileges required to install system packages. Re-run with sudo."
        echo "  $(sr5_distro_install_cmd "$mgr")" >&2
        return 1
    fi

    cmd="$(sr5_distro_install_cmd "$mgr")"
    echo "Detected Distro  : $(sr5_detect_distro_pretty)"
    echo "Package Manager  : $mgr"
    echo "Command          : $cmd"

    if [ "$non_interactive" -eq 0 ]; then
        printf "Install ShieldRed 5 dependencies now? (y/n) "
        read -r ans
        case "$ans" in
            y|Y|yes|YES) ;;
            *) echo "Aborted."; return 0 ;;
        esac
    fi

    case "$mgr" in
        apt-get)
            apt-get update || return 1
            if ! apt-get install -y bash parted dosfstools exfatprogs xz-utils python3 util-linux; then
                vtwarn "Retrying with exfat-utils for older Debian/Ubuntu releases ..."
                apt-get install -y bash parted dosfstools exfat-utils xz-utils python3 util-linux || return 1
            fi
            ;;
        dnf)
            dnf install -y bash parted dosfstools exfatprogs xz python3 util-linux || return 1
            ;;
        yum)
            yum install -y bash parted dosfstools exfatprogs xz python3 util-linux || return 1
            ;;
        pacman)
            pacman -Sy --needed --noconfirm bash parted dosfstools exfatprogs xz python util-linux || return 1
            ;;
        zypper)
            zypper --non-interactive install bash parted dosfstools exfatprogs xz python3 util-linux || return 1
            ;;
        apk)
            apk add --no-cache bash parted dosfstools exfatprogs xz python3 util-linux coreutils || return 1
            ;;
        xbps-install)
            xbps-install -Sy bash parted dosfstools exfatprogs xz python3 util-linux || return 1
            ;;
        emerge)
            emerge --ask=n app-shells/bash sys-block/parted sys-fs/dosfstools sys-fs/exfatprogs app-arch/xz-utils dev-lang/python sys-apps/util-linux || return 1
            ;;
        eopkg)
            eopkg install -y bash parted dosfstools exfatprogs xz python3 util-linux || return 1
            ;;
        swupd)
            swupd bundle-add sysadmin-basic python3-basic storage-utils || return 1
            ;;
        rpm-ostree)
            rpm-ostree install parted dosfstools exfatprogs python3 || return 1
            vtwarn "Reboot to apply rpm-ostree layered packages."
            ;;
        *)
            vterr "Unsupported or unrecognized package manager ($mgr)."
            echo "Please install manually: $cmd" >&2
            return 1
            ;;
    esac

    vtinfo "Dependencies installed successfully."
    return 0
}

sr5_cli() {
    if [ -n "${TOOLDIR:-}" ] && [ -x "./tool/$TOOLDIR/vtoycli" ]; then
        if "./tool/$TOOLDIR/vtoycli" fat -T >/dev/null 2>&1; then
            "./tool/$TOOLDIR/vtoycli" "$@"
            return $?
        fi
    fi
    python3 ./tool/shieldred5_helper.py "$@"
}

sr5_xzcat() {
    local src="$1"
    if command -v xzcat >/dev/null 2>&1; then
        xzcat "$src"
    elif command -v xz >/dev/null 2>&1; then
        xz -dc "$src"
    elif [ -n "${TOOLDIR:-}" ] && [ -x "./tool/$TOOLDIR/xzcat" ]; then
        "./tool/$TOOLDIR/xzcat" "$src"
    else
        python3 ./tool/shieldred5_helper.py xzcat "$src"
    fi
}

sr5_dd_xz() {
    local src="$1"
    local disk="$2"
    local seek_sec="$3"
    local count_sec="$4"
    if command -v xzcat >/dev/null 2>&1 || command -v xz >/dev/null 2>&1; then
        sr5_xzcat "$src" | sr5_dd_sync of="$disk" bs=512 count="$count_sec" seek="$seek_sec"
        local pipe_rc=("${PIPESTATUS[@]}")
        if [ "${pipe_rc[0]}" -ne 0 ] || [ "${pipe_rc[1]}" -ne 0 ]; then
            return 1
        fi
        return 0
    fi
    python3 ./tool/shieldred5_helper.py dd-xz --src "$src" --disk "$disk" --seek-sectors "$seek_sec" --sectors "$count_sec"
}

get_disk_part_name() {
    local disk="$1"
    local partno="$2"
    case "$disk" in
        *[0-9]) echo "${disk}p${partno}" ;;
        *)      echo "${disk}${partno}" ;;
    esac
}

get_disk_size_in_byte() {
    local disk="$1"
    local bname="${disk#/dev/}"
    if [ -r "/sys/class/block/${bname}/size" ]; then
        local secs
        secs="$(cat "/sys/class/block/${bname}/size")"
        echo $((secs * 512))
    elif command -v blockdev >/dev/null 2>&1; then
        blockdev --getsize64 "$disk"
    else
        python3 -c 'import os,sys; fd=os.open(sys.argv[1],os.O_RDONLY); print(os.lseek(fd,0,os.SEEK_END)); os.close(fd)' "$disk"
    fi
}

check_umount_disk() {
    local disk="$1"
    local mnt mp_raw mp
    if ! [ -r /proc/mounts ]; then
        return 0
    fi
    while IFS= read -r mp_raw; do
        [ -z "$mp_raw" ] && continue
        mp="$(printf '%b' "${mp_raw//\\040/ }")"
        mp="${mp//\\011/$'\t'}"
        vtdebug "umount $mp"
        if ! umount "$mp" 2>>"${SHIELDRED5_LOG_FILE:-/dev/null}"; then
            vterr "Failed to unmount $mp (device busy). Close open files/terminals on $disk and retry."
            return 1
        fi
    done < <(awk -v d="$disk" 'index($1, d) == 1 && (substr($1, length(d) + 1) == "" || substr($1, length(d) + 1) ~ /^p?[0-9]+$/) { print $2 }' /proc/mounts)
    return 0
}

is_disk_gpt() {
    sr5_cli partresize -t "$1" >/dev/null 2>&1
}

is_shieldred5_disk() {
    local disk="$1"
    local part1 part2 part2_type
    part1="$(get_disk_part_name "$disk" 1)"
    part2="$(get_disk_part_name "$disk" 2)"

    [ -b "$part1" ] || { vtdebug "$part1 does not exist"; return 1; }
    [ -b "$part2" ] || { vtdebug "$part2 does not exist"; return 1; }

    if is_disk_gpt "$disk"; then
        if sr5_cli fat "$part2" >/dev/null 2>&1; then
            return 0
        fi
        return 1
    fi

    part2_type="$(sr5_dd_quiet if="$disk" bs=1 count=1 skip=466 | od -An -tx1 | tr -d ' \n')"
    if [ "$part2_type" = "ef" ] || [ "$part2_type" = "EF" ]; then
        if sr5_cli fat "$part2" >/dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

get_disk_shieldred5_version() {
    local disk="$1"
    local part2
    part2="$(get_disk_part_name "$disk" 2)"
    sr5_cli fat "$part2" 2>/dev/null | head -n1 | tr -d '\r\n'
}

is_disk_secure_boot() {
    local disk="$1"
    local part2
    part2="$(get_disk_part_name "$disk" 2)"
    sr5_cli fat -s "$part2" >/dev/null 2>&1
}

wait_and_create_part() {
    local vPART1="$1"
    local vPART2="$2"
    local wait_cnt=0

    echo "Wait for partitions $vPART1 and $vPART2 ..."
    command -v udevadm >/dev/null 2>&1 && udevadm settle 2>/dev/null || true

    while [ "$wait_cnt" -lt 10 ]; do
        if [ -b "$vPART1" ] && [ -b "$vPART2" ]; then
            break
        fi
        wait_cnt=$((wait_cnt + 1))
        sleep 1
        echo "Wait for $vPART1 and $vPART2 ($wait_cnt/10)..."
    done

    if ! [ -b "$vPART1" ]; then
        local b1="${vPART1#/dev/}"
        if [ -r "/sys/class/block/${b1}/dev" ]; then
            local mm
            mm="$(sed 's/:/ /' "/sys/class/block/${b1}/dev")"
            echo "mknod -m 0660 $vPART1 b $mm ..."
            mknod -m 0660 "$vPART1" b $mm
        fi
    fi

    if ! [ -b "$vPART2" ]; then
        local b2="${vPART2#/dev/}"
        if [ -r "/sys/class/block/${b2}/dev" ]; then
            local mm
            mm="$(sed 's/:/ /' "/sys/class/block/${b2}/dev")"
            echo "mknod -m 0660 $vPART2 b $mm ..."
            mknod -m 0660 "$vPART2" b $mm
        fi
    fi

    if [ -b "$vPART1" ] && [ -b "$vPART2" ]; then
        echo "Partitions $vPART1 and $vPART2 ready."
        return 0
    fi
    vterr "[FAIL] Partition node $vPART1 or $vPART2 does not exist."
    return 1
}

_find_mkfs_vfat() {
    if command -v mkfs.vfat >/dev/null 2>&1; then
        echo "mkfs.vfat"
    elif command -v mkfs.fat >/dev/null 2>&1; then
        echo "mkfs.fat"
    else
        return 1
    fi
}

_format_part2_vfat() {
    local part2="$1"
    local mkvfat
    mkvfat="$(_find_mkfs_vfat)" || {
        vterr "mkfs.vfat / mkfs.fat is required (install dosfstools)."
        sr5_print_missing_hint
        return 1
    }

    local wait_cnt=0
    while [ "$wait_cnt" -lt 10 ]; do
        if "$mkvfat" -F 16 -n VTOYEFI -s 1 "$part2" >>"${SHIELDRED5_LOG_FILE:-/dev/null}" 2>&1; then
            return 0
        fi
        wait_cnt=$((wait_cnt + 1))
        sleep 1
    done
    vterr "Failed to format EFI partition $part2 as FAT16."
    return 1
}

format_shieldred5_disk_mbr() {
    local part1_end_sec="$1"
    local part2_start_sec="$2"
    local disk="$3"
    local part2_end_sec=$((part2_start_sec + 65535))
    local part1 part2

    part1="$(get_disk_part_name "$disk" 1)"
    part2="$(get_disk_part_name "$disk" 2)"

    command -v parted >/dev/null 2>&1 || {
        vterr "parted is required to partition $disk."
        sr5_print_missing_hint
        return 1
    }

    parted -a none -s "$disk" mktable msdos \
        mkpart primary 2048s "${part1_end_sec}s" \
        mkpart primary fat16 "${part2_start_sec}s" "${part2_end_sec}s" \
        set 1 boot on >>"${SHIELDRED5_LOG_FILE:-/dev/null}" 2>&1 || {
        vterr "parted MBR partitioning failed on $disk."
        return 1
    }

    # Set Part 1 MBR type to 0x07 (exFAT/NTFS) so Windows mounts the data partition,
    # and Part 2 MBR type from 0x06/0x0E FAT16 to 0xEF EFI System Partition
    printf '\x07' | sr5_dd_quiet of="$disk" bs=1 count=1 seek=450 conv=notrunc || return 1
    printf '\xef' | sr5_dd_quiet of="$disk" bs=1 count=1 seek=466 conv=notrunc || return 1

    sync
    partprobe "$disk" >/dev/null 2>&1 || true
    command -v partx >/dev/null 2>&1 && partx -u "$disk" >/dev/null 2>&1 || true
    wait_and_create_part "$part1" "$part2" || return 1
    _format_part2_vfat "$part2" || return 1
    return 0
}

format_shieldred5_disk_gpt() {
    local part1_end_sec="$1"
    local part2_start_sec="$2"
    local disk="$3"
    local part2_end_sec=$((part2_start_sec + 65535))
    local part1 part2

    part1="$(get_disk_part_name "$disk" 1)"
    part2="$(get_disk_part_name "$disk" 2)"

    command -v parted >/dev/null 2>&1 || {
        vterr "parted is required to partition $disk."
        sr5_print_missing_hint
        return 1
    }

    parted -a none -s "$disk" mktable gpt \
        mkpart ShieldRed5 2048s "${part1_end_sec}s" \
        mkpart VTOYEFI fat16 "${part2_start_sec}s" "${part2_end_sec}s" \
        set 1 msftdata on >>"${SHIELDRED5_LOG_FILE:-/dev/null}" 2>&1 || {
        vterr "parted GPT partitioning failed on $disk."
        return 1
    }

    sync
    sr5_cli gpt -f "$disk" >>"${SHIELDRED5_LOG_FILE:-/dev/null}" 2>&1 || return 1
    sync
    partprobe "$disk" >/dev/null 2>&1 || true
    command -v partx >/dev/null 2>&1 && partx -u "$disk" >/dev/null 2>&1 || true
    wait_and_create_part "$part1" "$part2" || return 1
    _format_part2_vfat "$part2" || return 1
    return 0
}

format_part1_exfat() {
    local part1="$1"
    local label="$2"
    local cluster_sectors="$3"

    if command -v mkfs.exfat >/dev/null 2>&1; then
        mkfs.exfat -L "$label" "$part1" >>"${SHIELDRED5_LOG_FILE:-/dev/null}" 2>&1 && return 0
    fi
    if command -v mkexfatfs >/dev/null 2>&1; then
        mkexfatfs -n "$label" -s "$cluster_sectors" "$part1" >>"${SHIELDRED5_LOG_FILE:-/dev/null}" 2>&1 && return 0
        mkexfatfs -n "$label" "$part1" >>"${SHIELDRED5_LOG_FILE:-/dev/null}" 2>&1 && return 0
    fi
    vterr "Failed to format $part1 as exFAT (install exfatprogs or exfat-utils)."
    sr5_print_missing_hint
    return 1
}
