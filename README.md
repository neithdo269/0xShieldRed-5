# ShieldRed 5 (`1.1.2` - Red Ninja Hardened Edition)

Cross-platform multi-boot USB preparation utility and offline Plugson web configurator for **Windows**, **Linux**, **macOS**, and **Node.js (`npm`)**.

- License: **GNU General Public License v3.0** (`GPL-3.0-only`)
- Repository: https://github.com/neithdo269/0xShieldRed-5

---

## 1. Install via `npm` (Windows / Linux / macOS)

Requires **Node.js >= 18**.

```bash
# Install globally directly from GitHub
npm install -g git+https://github.com/neithdo269/0xShieldRed-5.git

# Or from a local clone
git clone https://github.com/neithdo269/0xShieldRed-5.git
cd 0xShieldRed-5
npm install -g .
```

Global commands provided:

```bash
shieldred5 --help                  # Unified cross-platform CLI help
shieldred5 --doctor                # Check OS tools, payloads & Linux dependencies
shieldred5 --distro-cmd all        # Show Linux dependency commands for all distros
sudo shieldred5 --install-deps     # Auto-install required Linux distro packages
sudo shieldred5 -i /dev/sdX        # Linux USB install
sudo shieldred5 -i /dev/diskN      # macOS USB install
shieldred5                         # Launch Windows GUI (x64 or Win32)
shieldred5 --plugson [USB_DIR]     # Cross-platform Plugson Web UI (port 24680)
shieldred5-plugson [USB_DIR]       # Direct Plugson Web UI server
```

---

## 2. Linux Installation & Multi-Distro Support

### Portable / System-Wide Install

```bash
# Check dependencies & detect distro
bash ./ShieldRed5_Linux.sh --doctor

# Auto-install required packages for your distro
sudo bash ./ShieldRed5_Linux.sh --install-deps

# System-wide install (/usr/local/bin/shieldred5 + /usr/local/bin/shieldred5-plugson)
sudo bash ./install.sh --install-deps

# Uninstall
sudo bash ./uninstall.sh
```

### Per-Distro Dependency Commands

| Distribution Family | Package Manager | Install Command |
|---|---|---|
| Debian / Ubuntu / Mint / Pop!_OS / Kali / RPi OS | `apt-get` | `sudo apt-get update && sudo apt-get install -y bash parted dosfstools exfatprogs xz-utils python3 util-linux` *(older releases: `exfat-utils`)* |
| Fedora / RHEL / CentOS Stream / Rocky / AlmaLinux | `dnf` | `sudo dnf install -y bash parted dosfstools exfatprogs xz python3 util-linux` |
| Arch Linux / Manjaro / EndeavourOS / Garuda / SteamOS | `pacman` | `sudo pacman -Sy --needed --noconfirm bash parted dosfstools exfatprogs xz python util-linux` |
| openSUSE Leap / Tumbleweed / SLES | `zypper` | `sudo zypper --non-interactive install bash parted dosfstools exfatprogs xz python3 util-linux` |
| Alpine Linux / postmarketOS | `apk` | `sudo apk add --no-cache bash parted dosfstools exfatprogs xz python3 util-linux coreutils` |
| Void Linux | `xbps-install` | `sudo xbps-install -Sy bash parted dosfstools exfatprogs xz python3 util-linux` |
| Gentoo / Calculate | `emerge` | `sudo emerge --ask=n app-shells/bash sys-block/parted sys-fs/dosfstools sys-fs/exfatprogs app-arch/xz-utils dev-lang/python sys-apps/util-linux` |
| Solus | `eopkg` | `sudo eopkg install -y bash parted dosfstools exfatprogs xz python3 util-linux` |
| Clear Linux | `swupd` | `sudo swupd bundle-add sysadmin-basic python3-basic storage-utils` |
| Fedora Silverblue / Kinoite / Bazzite | `rpm-ostree` | `rpm-ostree install parted dosfstools exfatprogs python3` |
| NixOS / Nix | `nix` | `nix-shell -p bash parted dosfstools exfatprogs xz python3 util-linux` *(or `packaging/nix/flake.nix`)* |

### Native Distro Packaging Recipes (`packaging/`)

- **Debian / Ubuntu (`.deb`)**: `bash ./packaging/debian/build-deb.sh` (`packaging/debian/control`)
- **Fedora / RHEL / openSUSE (`.rpm`)**: `packaging/rpm/shieldred5.spec`
- **Arch Linux (`PKGBUILD`)**: `packaging/arch/PKGBUILD`
- **Alpine Linux (`APKBUILD`)**: `packaging/alpine/APKBUILD`
- **Void Linux (`xbps-src`)**: `packaging/void/template`
- **Gentoo (`ebuild`)**: `packaging/gentoo/shieldred5-1.1.2.ebuild`
- **NixOS / Nix Flakes**: `packaging/nix/flake.nix`

---

## 3. macOS

Requires macOS built-in `diskutil`, `newfs_exfat`, `newfs_msdos`, and `python3`.

```bash
sudo bash ./ShieldRed5_macOS.sh -i /dev/diskN
# Or after `install.sh` / `npm install -g`:
sudo shieldred5 -i /dev/diskN
```

Notes:
- Double-check `/dev/diskN` with `diskutil list` before installing (`disk0` and internal drives are blocked by default).
- Pass `-S` to disable the Secure Boot shim when booting Intel Macs directly.
- Apple Silicon Macs use iBoot and cannot boot PC/UEFI USB images natively, though macOS on Apple Silicon can safely prepare USB drives for PCs and Intel Macs.

---

## 4. Windows

- `ShieldRed5.exe` / `altexe\ShieldRed5_X64.exe`: USB installer / updater GUI & CLI (Win32 / x64)
- `ShieldRed5Plugson.exe` / `altexe\ShieldRed5Plugson_X64.exe`: Native offline Plugson web UI (Win32 / x64)
- `ShieldRed5Vlnk.exe`: Virtual link (`.vlnk`) creator GUI & CLI (Win32)

---

## 5. Development & Testing

```bash
npm test
npm run doctor
npm run pack:check
```

