ShieldRed 5 (1.1.2 - Red Ninja Hardened Edition)
==================================================

ShieldRed 5 is a multi-boot USB preparation utility rebuilt with cross-platform
installers for Windows, Linux, and macOS, custom ShieldRed 5 / Red Ninja
branding, offline web configuration UI (with external CDN/fonts/links, Flash
links, Adobe XMP metadata, and PDB debug paths removed), and installer bug fixes.

License: GNU General Public License v3.0 (https://www.gnu.org/licenses/gpl-3.0.html)


1. Windows
----------
Run ShieldRed5.exe (or altexe\ShieldRed5_X64.exe on 64-bit x64 systems):
  - ShieldRed5.exe                   : USB installer / updater GUI & CLI (Win32)
  - altexe\ShieldRed5_X64.exe        : USB installer / updater GUI & CLI (x64)
  - ShieldRed5Plugson.exe            : Offline plugin configurator web UI (Win32)
  - altexe\ShieldRed5Plugson_X64.exe : Offline plugin configurator web UI (x64)
  - ShieldRed5Vlnk.exe               : Virtual link (.vlnk) creator GUI & CLI (Win32)

Preferences are stored in ShieldRed5.ini. Windows ARM/ARM64 binaries are not
included because only Win32 and x64 MSVC toolsets were available locally.


2. npm Install & Cross-Platform Node.js CLI (Windows / Linux / macOS)
---------------------------------------------------------------------
Requirements: Node.js >= 18 (plus platform USB tools for disk operations).

Install globally from this directory (or pack/publish to a registry):
  npm install -g .
  # or run directly without global install:
  npx . --help
  # or run local npm scripts:
  npm run doctor
  npm run plugson

Global commands installed by npm:
  shieldred5 --help                  : Cross-platform CLI help
  shieldred5 --doctor                : Verify tools, payloads & Linux dependencies
  shieldred5 --distro-cmd [DISTRO]   : Show Linux install command (or 'all')
  sudo shieldred5 --install-deps     : Auto-install Linux distro dependencies
  sudo shieldred5 -i /dev/sdX        : Run Linux USB installer (on Linux)
  sudo shieldred5 -i /dev/diskN      : Run macOS USB installer (on macOS)
  shieldred5                         : Launch ShieldRed5 GUI (on Windows)
  shieldred5 --plugson [USB_DIR]     : Launch Node.js Plugson web UI (all OSes)
  shieldred5-plugson [USB_DIR]       : Direct Plugson web configurator server


3. Linux (Portable, System Install & Multi-Distro Packages)
-----------------------------------------------------------
Core runtime requirements: bash, parted, dosfstools (mkfs.vfat), exfatprogs
(or exfat-utils), dd, python3, util-linux (optional: xz/xzcat, nodejs >= 18 for
shieldred5-plugson).

A) Portable usage (from this extracted directory):
  bash ./ShieldRed5_Linux.sh --doctor
  sudo bash ./ShieldRed5_Linux.sh --install-deps
  sudo bash ./ShieldRed5_Linux.sh [OPTIONS] /dev/sdX

B) System-wide install / uninstall (installs `shieldred5` & `shieldred5-plugson`):
  sudo bash ./install.sh --install-deps
  # or without auto-installing distro packages:
  sudo bash ./install.sh
  # uninstall:
  sudo bash ./uninstall.sh

C) Per-Distro Dependency Installation Commands:
  - Debian / Ubuntu / Linux Mint / Pop!_OS / Kali / MX / Raspberry Pi OS:
      sudo apt-get update && sudo apt-get install -y bash parted dosfstools exfatprogs xz-utils python3 util-linux
      (Older Debian/Ubuntu releases: replace `exfatprogs` with `exfat-utils`.)
  - Fedora / Nobara / RHEL / CentOS Stream / Rocky / AlmaLinux / Oracle Linux:
      sudo dnf install -y bash parted dosfstools exfatprogs xz python3 util-linux
      (RHEL/Rocky/Alma 8/9: enable EPEL first if needed: `sudo dnf install -y epel-release`.)
  - Arch Linux / Manjaro / EndeavourOS / Garuda / CachyOS / SteamOS:
      sudo pacman -Sy --needed --noconfirm bash parted dosfstools exfatprogs xz python util-linux
  - openSUSE Leap / Tumbleweed / SLES:
      sudo zypper --non-interactive install bash parted dosfstools exfatprogs xz python3 util-linux
  - Alpine Linux / postmarketOS:
      sudo apk add --no-cache bash parted dosfstools exfatprogs xz python3 util-linux coreutils
  - Void Linux:
      sudo xbps-install -Sy bash parted dosfstools exfatprogs xz python3 util-linux
  - Gentoo / Calculate Linux:
      sudo emerge --ask=n app-shells/bash sys-block/parted sys-fs/dosfstools sys-fs/exfatprogs app-arch/xz-utils dev-lang/python sys-apps/util-linux
  - Solus:
      sudo eopkg install -y bash parted dosfstools exfatprogs xz python3 util-linux
  - Clear Linux OS:
      sudo swupd bundle-add sysadmin-basic python3-basic storage-utils
  - Fedora Silverblue / Kinoite / Sericea / Bazzite (rpm-ostree):
      rpm-ostree install parted dosfstools exfatprogs python3
  - NixOS / Nix:
      nix-shell -p bash parted dosfstools exfatprogs xz python3 util-linux
      (Or via Flakes: `nix run ./packaging/nix` / `nix develop ./packaging/nix`.)
  - Slackware:
      Install bash, parted, dosfstools, xz, python3, util-linux (+ exfatprogs from SBo).

D) Native Distro Packaging Recipes (`packaging/`):
  - Debian/Ubuntu (.deb) : bash ./packaging/debian/build-deb.sh
  - Fedora/RHEL/openSUSE : packaging/rpm/shieldred5.spec
  - Arch Linux           : packaging/arch/PKGBUILD
  - Alpine Linux         : packaging/alpine/APKBUILD
  - Void Linux           : packaging/void/template
  - Gentoo Linux         : packaging/gentoo/shieldred5-1.1.2.ebuild
  - NixOS / Nix Flakes   : packaging/nix/flake.nix

Installer Options (`ShieldRed5_Linux.sh` / `shieldred5`):
  -i             Install ShieldRed 5 to /dev/sdX (fails if already installed)
  -I             Force install ShieldRed 5 to /dev/sdX (destroys existing partitions)
  -u             Non-destructive upgrade on /dev/sdX (preserves data partition & ISOs)
  -l             Show ShieldRed 5 installation info on /dev/sdX
  -g             Use GPT partition style (default is MBR; -g auto-enabled on >2TB disks)
  -r N           Reserve N MiB space at the end of the disk
  -s             Enable Secure Boot support (default)
  -S             Disable Secure Boot support (removes shim/MOK; boots direct GRUB EFI)
  -L X           Set Partition 1 volume label (default: "ShieldRed 5")
  -y             Skip interactive confirmation prompt
  --doctor       Inspect OS, package manager, and missing dependencies
  --install-deps Auto-install required packages using the detected distro package manager


4. macOS
--------
Requirements: macOS with built-in diskutil, newfs_exfat, newfs_msdos, and python3.

Usage (portable or after `sudo bash ./install.sh` / `npm install -g .`):
  sudo bash ./ShieldRed5_macOS.sh [OPTIONS] /dev/diskN
  # or if installed via install.sh / npm:
  sudo shieldred5 [OPTIONS] /dev/diskN

Options:
  -i   Install ShieldRed 5 to /dev/diskN (fails if already installed)
  -I   Force install ShieldRed 5 to /dev/diskN (destroys all data on diskN)
  -u   Non-destructive upgrade of the ShieldRed 5 boot & EFI partition on diskN
  -l   Show ShieldRed 5 installation info on /dev/diskN
  -g   Use GPT partition style (default is MBR)
  -m   Use MBR partition style explicitly
  -r N Reserve N MiB space at the end of the disk
  -s   Enable Secure Boot support (default)
  -S   Disable Secure Boot support (recommended when booting Intel Macs directly)
  -L X Set Partition 1 volume label (default: "ShieldRed 5")
  -f X Filesystem for Partition 1 on macOS: exfat (default) or fat32

Important Notes:
  - Always double-check /dev/diskN with `diskutil list` before installing.
    Internal system disks are blocked by default.
  - Apple Silicon (M1/M2/M3/M4) Macs use iBoot rather than UEFI and cannot boot
    standard PC/UEFI USB images natively, though macOS on Apple Silicon can
    safely prepare USB drives for PCs and Intel Macs.
  - When booting Intel Macs directly from USB, pass `-S` to disable the EFI
    Secure Boot shim.
  - For runtime ISO boot compatibility with the precompiled GRUB2 core images,
    the EFI partition label remains `VTOYEFI` and USB plugin configs read from
    `plugin\ventoy\` (`/ventoy/ventoy.json` on the USB data partition).
