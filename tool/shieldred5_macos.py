#!/usr/bin/env python3
"""
ShieldRed 5 macOS installer, updater, and disk inspector.

Uses macOS `diskutil`, `newfs_exfat`, `newfs_msdos`, and raw `/dev/rdiskN`
aligned block I/O via `shieldred5_helper`.
"""

import argparse
import lzma
import os
import plistlib
import re
import struct
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shieldred5_helper as vtoy_helper  # noqa: E402


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
BOOT_IMG = os.path.join(ROOT_DIR, "boot", "boot.img")
CORE_IMG_XZ = os.path.join(ROOT_DIR, "boot", "core.img.xz")
DISK_IMG_XZ = os.path.join(ROOT_DIR, "shieldred5", "shieldred5.disk.img.xz")
VERSION_FILE = os.path.join(ROOT_DIR, "shieldred5", "version")


def get_pkg_version() -> str:
    try:
        with open(VERSION_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return "1.1.2"


def normalize_macos_disk_name(target: str) -> str:
    """Convert disk2, /dev/disk2, or /dev/rdisk2 -> disk2; reject slices."""
    t = target.strip()
    if t.startswith("/dev/"):
        t = t[5:]
    if t.startswith("r"):
        t = t[1:]
    if not re.fullmatch(r"disk\d+", t):
        raise ValueError(
            f"Invalid macOS whole-disk identifier {target!r}. Expected /dev/diskN or diskN (never a partition slice like disk2s1)."
        )
    return t


def run_cmd(cmd: list[str], capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        check=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )


def diskutil_info(disk_id: str) -> dict:
    proc = run_cmd(["diskutil", "info", "-plist", f"/dev/{disk_id}"], capture=True)
    return plistlib.loads(proc.stdout)


def unmount_disk(disk_id: str) -> None:
    subprocess.run(["diskutil", "unmountDisk", "force", f"/dev/{disk_id}"], check=True)


def wait_for_slice(raw_slice: str, disk_id: str, is_gpt: bool = False, timeout: int = 12) -> bool:
    for _ in range(timeout):
        if os.path.exists(raw_slice):
            return True
        # Trigger macOS diskarbitrationd / MediaKit partition map rescan after raw /dev/rdisk write
        subprocess.run(["diskutil", "list", f"/dev/{disk_id}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if is_gpt:
            subprocess.run(["gpt", "-r", "show", f"/dev/{disk_id}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["diskutil", "unmountDisk", "force", f"/dev/{disk_id}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1)
    return os.path.exists(raw_slice)


def parse_existing_layout(dev: vtoy_helper.RawBlockDevice) -> dict | None:
    """Inspect existing disk/image for a ShieldRed 5 partition 2 + version."""
    buf = dev.read_at(0, 34 * vtoy_helper.SECTOR_SIZE)
    if vtoy_helper.is_gpt_disk(buf):
        style = "gpt"
        p2_off = 1024 + 128
        p2_start, p2_last = struct.unpack_from("<QQ", buf, p2_off + 32)
        p2_count = (p2_last - p2_start + 1) if p2_last >= p2_start > 0 else 0
    else:
        style = "mbr"
        p2_type = buf[462 + 4]
        p2_start, p2_count = struct.unpack_from("<II", buf, 462 + 8)
        if p2_type != 0xEF:
            return None

    if p2_start < 2048 or p2_count < 4096:
        return None
    if (p2_start + p2_count) * vtoy_helper.SECTOR_SIZE > dev.size:
        return None

    try:
        fat = vtoy_helper.Fat16Volume(dev, p2_start * vtoy_helper.SECTOR_SIZE)
        cfg = fat.read_file("/grub/grub.cfg").decode("utf-8", errors="replace")
        m = re.search(r'VENTOY_VERSION\s*=\s*"?([^"\r\n]+)"?', cfg)
        if not m:
            return None
        ver = m.group(1).strip()
        sb = fat.exists("/EFI/BOOT/grubx64_real.efi")
        return {
            "style": style,
            "part2_start": p2_start,
            "part2_sectors": p2_count,
            "version": ver,
            "secure_boot": sb,
        }
    except Exception:
        return None


def confirm_or_abort(prompt: str, yes_flag: bool) -> bool:
    if yes_flag:
        return True
    try:
        ans = input(f"{prompt} (y/n): ").strip().lower()
    except EOFError:
        return False
    return ans in ("y", "yes")


def do_list(raw_path: str) -> int:
    with vtoy_helper.RawBlockDevice(raw_path, write=False) as dev:
        info = parse_existing_layout(dev)
    if not info:
        print(f"{raw_path} does not contain a valid ShieldRed 5 installation.", file=sys.stderr)
        return 1
    print(f"ShieldRed 5 Version in Disk : {info['version']}")
    print(f"Disk Partition Style        : {info['style'].upper()}")
    print(f"Secure Boot Support         : {'Enabled' if info['secure_boot'] else 'Disabled'}")
    print(f"VTOYEFI Start Sector        : {info['part2_start']}")
    return 0


def do_update(raw_path: str, disk_id: str | None, args) -> int:
    pkg_ver = get_pkg_version()
    with vtoy_helper.RawBlockDevice(raw_path, write=False) as dev:
        info = parse_existing_layout(dev)
    if not info:
        print(f"{raw_path} does not contain ShieldRed 5. Use -i or -I to install.", file=sys.stderr)
        return 1

    target_sb = info["secure_boot"] if args.secure_boot is None else args.secure_boot
    print(f"Upgrade operation is safe; data in partition 1 on {raw_path} will be preserved.")
    print(f"Current version: {info['version']}  -->  New version: {pkg_ver}")
    print(f"Partition Style: {info['style'].upper()}  |  Secure Boot: {'Enabled' if target_sb else 'Disabled'}")

    if not confirm_or_abort(f"Continue upgrading {raw_path}?", args.yes):
        print("Aborted.")
        return 0

    with open(BOOT_IMG, "rb") as f:
        boot_img = f.read()
    with lzma.open(CORE_IMG_XZ, "rb") as f:
        core_img = f.read()
    with lzma.open(DISK_IMG_XZ, "rb") as f:
        efi_img = f.read()

    if disk_id:
        unmount_disk(disk_id)

    p2_start = info["part2_start"]
    with vtoy_helper.RawBlockDevice(raw_path, write=True) as dev:
        dev.write_at(0, boot_img[:440])
        if info["style"] == "gpt":
            dev.write_at(34 * vtoy_helper.SECTOR_SIZE, core_img[: 2014 * vtoy_helper.SECTOR_SIZE])
        else:
            dev.write_at(vtoy_helper.SECTOR_SIZE, core_img[: 2047 * vtoy_helper.SECTOR_SIZE])
        dev.write_at(p2_start * vtoy_helper.SECTOR_SIZE, efi_img[: vtoy_helper.SHIELDRED5_EFI_PART_SIZE])
        if not target_sb:
            vtoy_helper.strip_secure_boot_fat16(dev, p2_start)

    if info["style"] == "gpt":
        vtoy_helper.cmd_gpt_fix(argparse.Namespace(disk=raw_path, fix=True))

    if disk_id:
        subprocess.run(["diskutil", "mount", f"/dev/{disk_id}s1"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print(f"Upgrade to ShieldRed 5 ({pkg_ver}) completed successfully on {raw_path}.")
    return 0


def do_install(raw_path: str, disk_id: str | None, force: bool, args) -> int:
    pkg_ver = get_pkg_version()

    if not force:
        with vtoy_helper.RawBlockDevice(raw_path, write=False) as dev:
            existing = parse_existing_layout(dev)
        if existing:
            print(
                f"{raw_path} already has ShieldRed 5 ({existing['version']}). Use -u to upgrade or -I to overwrite.",
                file=sys.stderr,
            )
            return 1

    with vtoy_helper.RawBlockDevice(raw_path, write=False) as dev:
        disk_bytes = dev.size

    disk_gb = disk_bytes / 1_000_000_000.0
    style = args.style
    if disk_bytes > 2_199_023_255_552 and style != "gpt":
        print(f"Notice: disk > 2TB ({disk_gb:.1f} GB); automatically using GPT partition style.")
        style = "gpt"

    sb_enabled = True if args.secure_boot is None else args.secure_boot
    fs_type = args.fs
    label = args.label or "ShieldRed 5"
    mbr_type = 0x0C if fs_type == "fat32" else 0x07

    print("")
    print("**********************************************")
    print(f"Target Device   : {raw_path} ({disk_gb:.2f} GB)")
    print(f"Version         : ShieldRed 5 ({pkg_ver})")
    print(f"Partition Style : {style.upper()}")
    print(f"Filesystem      : {fs_type.upper()}  (Label: {label})")
    print(f"Secure Boot     : {'Enabled' if sb_enabled else 'Disabled'}")
    if sb_enabled:
        print("Intel Mac Tip   : Re-run with -S if an Intel Mac hangs on the Secure Boot shim.")
    print("WARNING: ALL EXISTING DATA ON THIS DISK WILL BE DESTROYED!")
    print("**********************************************")
    print("")

    if not confirm_or_abort(f"Format and install ShieldRed 5 onto {raw_path}?", args.yes):
        print("Aborted.")
        return 0
    if not confirm_or_abort(f"Second confirmation: erase ALL data on {raw_path}?", args.yes):
        print("Aborted.")
        return 0

    if disk_id:
        unmount_disk(disk_id)

    # Clear first 1 MiB and backup GPT area first
    with vtoy_helper.RawBlockDevice(raw_path, write=True) as dev:
        total_secs = dev.size // vtoy_helper.SECTOR_SIZE
        dev.write_at(0, b"\x00" * (2048 * vtoy_helper.SECTOR_SIZE))
        if total_secs > 34:
            dev.write_at((total_secs - 34) * vtoy_helper.SECTOR_SIZE, b"\x00" * (34 * vtoy_helper.SECTOR_SIZE))

    layout_args = argparse.Namespace(
        disk=raw_path,
        style=style,
        mbr_type=mbr_type,
        label=label,
        reserve_mb=args.reserve_mb,
        align_4k=args.align_4k,
        secure_boot=1 if sb_enabled else 0,
        boot_img=BOOT_IMG,
        core_img_xz=CORE_IMG_XZ,
        disk_img_xz=DISK_IMG_XZ,
    )
    rc = vtoy_helper.cmd_write_layout(layout_args)
    if rc != 0:
        return rc

    if disk_id:
        raw_p1 = f"/dev/r{disk_id}s1"
        disk_p1 = f"/dev/{disk_id}s1"
        disk_p2 = f"/dev/{disk_id}s2"
        if not wait_for_slice(raw_p1, disk_id, is_gpt=(style == "gpt"), timeout=15):
            print(
                f"Partition node {raw_p1} did not appear in time. Unplug/replug or check `diskutil list {disk_id}`.",
                file=sys.stderr,
            )
            return 1
        unmount_disk(disk_id)
        if fs_type == "exfat":
            # macOS newfs_exfat accepts up to 15 chars for volume name
            run_cmd(["newfs_exfat", "-v", label[:15], raw_p1])
        else:
            # FAT32 volume label max 11 uppercase ASCII characters
            fat_lbl = re.sub(r"[^A-Z0-9 _\-]", "", label.upper())[:11] or "SHIELDRED5"
            run_cmd(["newfs_msdos", "-F", "32", "-v", fat_lbl, raw_p1])
        subprocess.run(["diskutil", "unmount", "force", disk_p2], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["diskutil", "mount", disk_p1], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print(f"Congratulations! ShieldRed 5 ({pkg_ver}) has been installed to {raw_path}.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="ShieldRed5_macOS.sh",
        description="ShieldRed 5 USB installer and updater for macOS.",
    )
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("-i", dest="mode_install", action="store_true", help="Install ShieldRed 5 (fails if already installed)")
    mode.add_argument("-I", dest="mode_force", action="store_true", help="Force install ShieldRed 5 (destroys all data)")
    mode.add_argument("-u", dest="mode_update", action="store_true", help="Upgrade existing ShieldRed 5 installation safely")
    mode.add_argument("-l", dest="mode_list", action="store_true", help="Show ShieldRed 5 status on target device")

    style = ap.add_mutually_exclusive_group()
    style.add_argument("-g", dest="style", action="store_const", const="gpt", help="Use GPT partition style")
    style.add_argument("-m", dest="style", action="store_const", const="mbr", help="Use MBR partition style (default)")
    ap.set_defaults(style="mbr")

    sb = ap.add_mutually_exclusive_group()
    sb.add_argument("-s", dest="secure_boot", action="store_const", const=True, help="Enable Secure Boot shim")
    sb.add_argument("-S", dest="secure_boot", action="store_const", const=False, help="Disable Secure Boot shim (recommended for Intel Macs)")
    ap.set_defaults(secure_boot=None)

    ap.add_argument("-r", dest="reserve_mb", type=int, default=0, help="Reserve trailing space in MiB")
    ap.add_argument("-L", dest="label", default="ShieldRed 5", help='Partition 1 volume label (default: "ShieldRed 5")')
    ap.add_argument("-f", dest="fs", choices=("exfat", "fat32"), default="exfat", help="Partition 1 filesystem (default: exfat)")
    ap.add_argument("-4", dest="align_4k", action="store_true", help="Align Partition 2 to 4K sectors")
    ap.add_argument("-y", "--yes", action="store_true", help="Skip interactive confirmation prompts")
    ap.add_argument("--allow-internal", action="store_true", help="Allow targeting an internal macOS drive (dangerous)")
    ap.add_argument("--image", action="store_true", help="Operate on a raw disk image file instead of /dev/diskN")
    ap.add_argument("target", help="Target disk (e.g. /dev/disk2) or disk image path with --image")
    return ap


def main(argv: list[str] | None = None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)

    if args.reserve_mb < 0:
        print("Error: -r reserve size must be non-negative.", file=sys.stderr)
        return 1

    if args.image:
        if not os.path.isfile(args.target):
            print(f"Error: disk image file not found: {args.target}", file=sys.stderr)
            return 1
        raw_path = args.target
        disk_id = None
    else:
        if sys.platform != "darwin":
            print("Error: /dev/diskN operations require macOS (use --image to test on image files).", file=sys.stderr)
            return 1
        try:
            disk_id = normalize_macos_disk_name(args.target)
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1
        if disk_id == "disk0":
            print("Refusing to operate on disk0 (primary macOS system drive).", file=sys.stderr)
            return 1
        if os.geteuid() != 0 and not args.mode_list:
            print("Root privileges required. Re-run with sudo.", file=sys.stderr)
            return 1

        try:
            dinfo = diskutil_info(disk_id)
        except subprocess.CalledProcessError as e:
            print(f"Failed to query diskutil for /dev/{disk_id}: {e}", file=sys.stderr)
            return 1

        if not dinfo.get("Whole", dinfo.get("WholeDisk", False)):
            print(f"Error: /dev/{disk_id} is not a whole disk.", file=sys.stderr)
            return 1
        if not args.mode_list and not dinfo.get("WritableMedia", dinfo.get("Writable", True)):
            print(f"Error: /dev/{disk_id} is read-only.", file=sys.stderr)
            return 1
        if not args.mode_list and dinfo.get("Internal", False) and not args.allow_internal:
            print(
                f"Refusing to overwrite internal drive /dev/{disk_id} ({dinfo.get('MediaName', 'unknown')}). Pass --allow-internal only if intended.",
                file=sys.stderr,
            )
            return 1

        raw_path = f"/dev/r{disk_id}"

    if args.mode_list:
        return do_list(raw_path)
    if args.mode_update:
        return do_update(raw_path, disk_id, args)
    if args.mode_install:
        return do_install(raw_path, disk_id, force=False, args=args)
    if args.mode_force:
        return do_install(raw_path, disk_id, force=True, args=args)
    return 1


if __name__ == "__main__":
    sys.exit(main())
