"use strict";

const fs = require("node:fs");

const DISTRO_FAMILIES = [
  {
    key: "debian",
    label: "Debian / Ubuntu / Linux Mint / Pop!_OS / Kali / MX / Raspberry Pi OS",
    aliases: [
      "debian", "ubuntu", "linuxmint", "mint", "pop", "kali", "mx",
      "elementary", "zorin", "parrot", "raspbian", "neon", "deepin", "apt"
    ],
    pkgManager: "apt-get",
    installCmd:
      "sudo apt-get update && sudo apt-get install -y bash parted dosfstools exfatprogs xz-utils python3 util-linux",
    notes: "On older Debian/Ubuntu releases without exfatprogs, replace exfatprogs with exfat-utils."
  },
  {
    key: "fedora",
    label: "Fedora / Nobara / RHEL / CentOS Stream / Rocky Linux / AlmaLinux / Oracle Linux",
    aliases: [
      "fedora", "rhel", "centos", "rocky", "almalinux", "alma", "ol",
      "oracle", "nobara", "scientific", "dnf", "yum"
    ],
    pkgManager: "dnf",
    installCmd:
      "sudo dnf install -y bash parted dosfstools exfatprogs xz python3 util-linux",
    notes: "On RHEL/CentOS/Rocky/Alma 8 or 9, enable EPEL first if exfatprogs is missing: sudo dnf install -y epel-release"
  },
  {
    key: "arch",
    label: "Arch Linux / Manjaro / EndeavourOS / Garuda / CachyOS / SteamOS",
    aliases: [
      "arch", "manjaro", "endeavouros", "garuda", "cachyos", "artix",
      "arcolinux", "steamos", "pacman"
    ],
    pkgManager: "pacman",
    installCmd:
      "sudo pacman -Sy --needed --noconfirm bash parted dosfstools exfatprogs xz python util-linux",
    notes: "On SteamOS immutable rootfs, use steamos-readonly or the system/npm installer."
  },
  {
    key: "opensuse",
    label: "openSUSE Leap / Tumbleweed / SLES",
    aliases: ["opensuse", "opensuse-leap", "opensuse-tumbleweed", "sles", "suse", "zypper"],
    pkgManager: "zypper",
    installCmd:
      "sudo zypper --non-interactive install bash parted dosfstools exfatprogs xz python3 util-linux",
    notes: ""
  },
  {
    key: "alpine",
    label: "Alpine Linux / postmarketOS",
    aliases: ["alpine", "postmarketos", "apk"],
    pkgManager: "apk",
    installCmd:
      "sudo apk add --no-cache bash parted dosfstools exfatprogs xz python3 util-linux coreutils",
    notes: "coreutils provides GNU dd (ShieldRed5 also supports BusyBox dd fallback)."
  },
  {
    key: "void",
    label: "Void Linux",
    aliases: ["void", "xbps", "xbps-install"],
    pkgManager: "xbps-install",
    installCmd:
      "sudo xbps-install -Sy bash parted dosfstools exfatprogs xz python3 util-linux",
    notes: ""
  },
  {
    key: "gentoo",
    label: "Gentoo / Calculate Linux",
    aliases: ["gentoo", "calculate", "funtoo", "emerge"],
    pkgManager: "emerge",
    installCmd:
      "sudo emerge --ask=n app-shells/bash sys-block/parted sys-fs/dosfstools sys-fs/exfatprogs app-arch/xz-utils dev-lang/python sys-apps/util-linux",
    notes: ""
  },
  {
    key: "solus",
    label: "Solus",
    aliases: ["solus", "eopkg"],
    pkgManager: "eopkg",
    installCmd:
      "sudo eopkg install -y bash parted dosfstools exfatprogs xz python3 util-linux",
    notes: ""
  },
  {
    key: "clear",
    label: "Clear Linux OS",
    aliases: ["clear-linux-os", "clear", "swupd"],
    pkgManager: "swupd",
    installCmd:
      "sudo swupd bundle-add sysadmin-basic python3-basic storage-utils",
    notes: ""
  },
  {
    key: "slackware",
    label: "Slackware Linux",
    aliases: ["slackware", "slackpkg"],
    pkgManager: "slackpkg",
    installCmd:
      "Install bash, parted, dosfstools, xz, python3, util-linux (and exfatprogs from SlackBuilds.org / SBo)",
    notes: ""
  },
  {
    key: "silverblue",
    label: "Fedora Silverblue / Kinoite / Sericea / Bazzite (rpm-ostree)",
    aliases: ["silverblue", "kinoite", "bazzite", "sericea", "fedora-ostree", "rpm-ostree"],
    pkgManager: "rpm-ostree",
    installCmd:
      "rpm-ostree install parted dosfstools exfatprogs python3",
    notes: "Reboot after layering packages, or run inside a privileged toolbox/distrobox."
  },
  {
    key: "nixos",
    label: "NixOS / Nix",
    aliases: ["nixos", "nix"],
    pkgManager: "nix",
    installCmd:
      "nix-shell -p bash parted dosfstools exfatprogs xz python3 util-linux",
    notes: "Flake users can also run via packaging/nix/flake.nix."
  }
];

function parseOsRelease(text) {
  const out = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function readLocalOsRelease() {
  try {
    return parseOsRelease(fs.readFileSync("/etc/os-release", "utf8"));
  } catch {
    return {};
  }
}

function findDistroFamily(query) {
  if (!query) return null;
  const normalized = String(query).trim().toLowerCase();
  for (const fam of DISTRO_FAMILIES) {
    if (fam.key === normalized || fam.aliases.includes(normalized)) {
      return fam;
    }
  }
  const tokens = normalized.split(/[\s,]+/).filter(Boolean);
  for (const tok of tokens) {
    for (const fam of DISTRO_FAMILIES) {
      if (fam.aliases.includes(tok)) {
        return fam;
      }
    }
  }
  return null;
}

function detectDistroFromOsRelease(osRel) {
  const rel = osRel || readLocalOsRelease();
  const variant = (rel.VARIANT_ID || "").toLowerCase();
  if (variant === "silverblue" || variant === "kinoite" || variant === "sericea") {
    return findDistroFamily("silverblue");
  }
  return (
    findDistroFamily(rel.ID) ||
    findDistroFamily(rel.ID_LIKE) ||
    null
  );
}

module.exports = {
  DISTRO_FAMILIES,
  parseOsRelease,
  readLocalOsRelease,
  findDistroFamily,
  detectDistroFromOsRelease
};

