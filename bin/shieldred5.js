#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  DISTRO_FAMILIES,
  detectDistroFromOsRelease,
  findDistroFamily
} = require("./distro");

const PKG_ROOT = path.resolve(__dirname, "..");

function getVersion() {
  try {
    return fs.readFileSync(path.join(PKG_ROOT, "shieldred5", "version"), "utf8").trim() || "1.1.2";
  } catch {
    return "1.1.2";
  }
}

function commandExists(cmd) {
  const probe = process.platform === "win32" ? "where.exe" : "which";
  const res = spawnSync(probe, [cmd], { stdio: "ignore" });
  return res.status === 0;
}

function printHelp() {
  const ver = getVersion();
  console.log(`ShieldRed 5 (${ver}) - Cross-Platform Multi-Boot USB Utility

Usage:
  shieldred5 [OPTIONS] <TARGET>
  shieldred5 --plugson [PLUGSON_OPTIONS] [USB_MOUNT_DIR]

Cross-Platform npm CLI Commands:
  --doctor, --check         Verify OS tools, payloads, and distro dependencies
  --distro-cmd [DISTRO]     Show Linux dependency install command (e.g. ubuntu, fedora, arch, alpine, nixos, or 'all')
  --plugson [ARGS...]       Launch offline ShieldRed 5 Plugson Web Configurator UI
  --vlnk                    Launch ShieldRed5Vlnk.exe (Windows only)
  --path                    Print installed ShieldRed 5 package root directory
  -V, --version             Print version information
  -h, --help                Show this help message

Linux Usage (run with sudo for block devices):
  sudo shieldred5 -i /dev/sdX          Install ShieldRed 5 (fails if already installed)
  sudo shieldred5 -I /dev/sdX          Force install (destroys all data on /dev/sdX)
  sudo shieldred5 -u /dev/sdX          Non-destructive upgrade (preserves ISOs/data)
  sudo shieldred5 -l /dev/sdX          Show ShieldRed 5 info on /dev/sdX
  sudo shieldred5 --install-deps [-y]  Auto-install dependencies for current Linux distro
  Options: -g (GPT), -r N (reserve MiB), -s/-S (Secure Boot on/off), -L LABEL, -y

macOS Usage (run with sudo for /dev/diskN):
  sudo shieldred5 -i /dev/diskN        Install ShieldRed 5 to /dev/diskN
  sudo shieldred5 -I /dev/diskN        Force install (destroys all data on /dev/diskN)
  sudo shieldred5 -u /dev/diskN        Non-destructive upgrade on /dev/diskN
  sudo shieldred5 -l /dev/diskN        Inspect /dev/diskN
  Options: -g/-m (GPT/MBR), -f exfat|fat32, -s/-S (use -S for Intel Mac), -r N, -L LABEL, --image

Windows Usage:
  shieldred5                           Launch ShieldRed5 GUI (x64 or Win32)
  shieldred5 --plugson [DIR]           Launch Node.js Plugson Web UI (or --plugson --native for .exe)
`);
}

function printDistroCmd(arg) {
  if (arg && arg.toLowerCase() === "all") {
    console.log("ShieldRed 5 Linux Dependencies by Distribution:\n");
    for (const fam of DISTRO_FAMILIES) {
      console.log(`[${fam.key}] ${fam.label}`);
      console.log(`  ${fam.installCmd}`);
      if (fam.notes) console.log(`  Note: ${fam.notes}`);
      console.log("");
    }
    return 0;
  }

  const fam = arg ? findDistroFamily(arg) : detectDistroFromOsRelease();
  if (!fam) {
    if (arg) {
      console.error(`Unknown Linux distro/package manager: ${arg}`);
      console.error("Run `shieldred5 --distro-cmd all` to list all supported distributions.");
      return 1;
    }
    console.log("Could not detect Linux distribution locally. Run `shieldred5 --distro-cmd all` to view all distros.");
    return 0;
  }

  console.log(`Distribution : ${fam.label}`);
  console.log(`Package Mgr  : ${fam.pkgManager}`);
  console.log(`Install Cmd  : ${fam.installCmd}`);
  if (fam.notes) console.log(`Note         : ${fam.notes}`);
  return 0;
}

function checkPayloads() {
  const required = [
    path.join("boot", "boot.img"),
    path.join("boot", "core.img.xz"),
    path.join("shieldred5", "shieldred5.disk.img.xz"),
    path.join("shieldred5", "plugson.tar.xz"),
    path.join("tool", "shieldred5_helper.py")
  ];
  let ok = true;
  for (const rel of required) {
    const exists = fs.existsSync(path.join(PKG_ROOT, rel));
    console.log(`  [${exists ? "OK" : "MISSING"}] payload: ${rel}`);
    if (!exists) ok = false;
  }
  return ok;
}

function runDoctor() {
  const ver = getVersion();
  console.log(`ShieldRed 5 Doctor v${ver} (${process.platform}/${process.arch})`);
  console.log(`Package Root: ${PKG_ROOT}\n`);

  if (process.platform === "linux") {
    if (commandExists("bash")) {
      const res = spawnSync("bash", [path.join(PKG_ROOT, "ShieldRed5_Linux.sh"), "--doctor"], {
        stdio: "inherit"
      });
      return res.status ?? 1;
    }
    console.log("  [MISSING] tool: bash");
    checkPayloads();
    const fam = detectDistroFromOsRelease();
    if (fam) {
      console.log(`\nDetected distro: ${fam.label}`);
      console.log(`Install dependencies with:\n  ${fam.installCmd}`);
    }
    return 1;
  }

  let ok = checkPayloads();
  if (process.platform === "darwin") {
    for (const cmd of ["bash", "python3", "diskutil", "newfs_exfat", "newfs_msdos"]) {
      const has = commandExists(cmd);
      console.log(`  [${has ? "OK" : "MISSING"}] tool: ${cmd}`);
      if (!has) ok = false;
    }
    const hasTar = commandExists("tar");
    console.log(`  [${hasTar ? "OK" : "OPTIONAL"}] tool: tar`);
  } else if (process.platform === "win32") {
    for (const exe of ["ShieldRed5.exe", path.join("altexe", "ShieldRed5_X64.exe"), "ShieldRed5Plugson.exe", "ShieldRed5Vlnk.exe"]) {
      const has = fs.existsSync(path.join(PKG_ROOT, exe));
      console.log(`  [${has ? "OK" : "MISSING"}] binary: ${exe}`);
      if (!has && exe === "ShieldRed5.exe") ok = false;
    }
    const hasPy = commandExists("python") || commandExists("python3");
    const hasTar = commandExists("tar");
    console.log(`  [${hasPy ? "OK" : "OPTIONAL"}] tool: python`);
    console.log(`  [${hasTar ? "OK" : "OPTIONAL"}] tool: tar`);
  }

  console.log(ok ? "\nStatus: Ready." : "\nStatus: Missing required files or tools.");
  return ok ? 0 : 1;
}

function launchWindowsExe(exePath, args) {
  if (!fs.existsSync(exePath)) {
    console.error(`Error: Executable not found: ${exePath}`);
    return 1;
  }
  const res = spawnSync(exePath, args, { cwd: PKG_ROOT, stdio: "inherit" });
  if (res.error && (res.error.code === "EACCES" || res.error.errno === -4092)) {
    const psArgs = args.length > 0 ? `-ArgumentList ${JSON.stringify(args.join(" "))}` : "";
    const psCmd = `Start-Process -FilePath '${exePath.replace(/'/g, "''")}' -WorkingDirectory '${PKG_ROOT.replace(/'/g, "''")}' ${psArgs}`;
    const elevated = spawnSync("powershell.exe", ["-NoProfile", "-Command", psCmd], { stdio: "inherit" });
    return elevated.status ?? 0;
  }
  if (res.error) {
    console.error(`Failed to launch ${exePath}: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 0;
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 && process.platform !== "win32") {
    printHelp();
    return 0;
  }

  const first = argv[0];
  if (first === "-h" || first === "--help") {
    printHelp();
    return 0;
  }
  if (first === "-V" || first === "--version") {
    console.log(`ShieldRed 5 ${getVersion()} (${process.platform}/${process.arch})`);
    return 0;
  }
  if (first === "--path" || first === "--root") {
    console.log(PKG_ROOT);
    return 0;
  }
  if (first === "--distro-cmd" || first === "--linux-deps") {
    return printDistroCmd(argv[1]);
  }
  if (first === "--doctor" || first === "--check") {
    return runDoctor();
  }
  if (first === "--plugson") {
    const plugson = require("./shieldred5-plugson");
    return plugson.main(argv.slice(1));
  }
  if (first === "--vlnk") {
    if (process.platform !== "win32") {
      console.error("Error: ShieldRed5Vlnk.exe is a Windows-only utility.");
      return 1;
    }
    return launchWindowsExe(path.join(PKG_ROOT, "ShieldRed5Vlnk.exe"), argv.slice(1));
  }

  if (process.platform === "linux") {
    if (!commandExists("bash")) {
      console.error("Error: 'bash' is required on Linux.");
      printDistroCmd();
      return 1;
    }
    const res = spawnSync("bash", [path.join(PKG_ROOT, "ShieldRed5_Linux.sh"), ...argv], {
      stdio: "inherit"
    });
    return res.status ?? 1;
  }

  if (process.platform === "darwin") {
    const res = spawnSync("bash", [path.join(PKG_ROOT, "ShieldRed5_macOS.sh"), ...argv], {
      stdio: "inherit"
    });
    return res.status ?? 1;
  }

  if (process.platform === "win32") {
    const cleanArgs = argv[0] === "--gui" ? argv.slice(1) : argv;
    const x64Exe = path.join(PKG_ROOT, "altexe", "ShieldRed5_X64.exe");
    const x86Exe = path.join(PKG_ROOT, "ShieldRed5.exe");
    const chosen = process.arch === "x64" && fs.existsSync(x64Exe) ? x64Exe : x86Exe;
    return launchWindowsExe(chosen, cleanArgs);
  }

  console.error(`Unsupported platform: ${process.platform}`);
  return 1;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  );
}

module.exports = { main, getVersion, printDistroCmd, runDoctor };

