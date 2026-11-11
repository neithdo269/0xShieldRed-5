"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  DISTRO_FAMILIES,
  parseOsRelease,
  findDistroFamily,
  detectDistroFromOsRelease
} = require("../bin/distro");
const { startPlugsonServer, encodeUtf16Hex } = require("../bin/plugson-server");

const ROOT = path.resolve(__dirname, "..");

function decodeUtf16Hex(hex) {
  let out = "";
  for (let i = 0; i < hex.length; i += 4) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
  }
  return out;
}

test("distro detection handles major Linux distro families", () => {
  const cases = [
    ['ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04"', "debian"],
    ['ID=linuxmint\nID_LIKE="ubuntu debian"', "debian"],
    ['ID=fedora\nVARIANT_ID=silverblue', "silverblue"],
    ['ID=rocky\nID_LIKE="rhel centos fedora"', "fedora"],
    ['ID=manjaro\nID_LIKE=arch', "arch"],
    ['ID=opensuse-tumbleweed\nID_LIKE="opensuse suse"', "opensuse"],
    ['ID=alpine\nPRETTY_NAME="Alpine Linux v3.20"', "alpine"],
    ['ID=void', "void"],
    ['ID=gentoo', "gentoo"],
    ['ID=solus', "solus"],
    ['ID=nixos', "nixos"]
  ];

  for (const [osRelText, expectedKey] of cases) {
    const parsed = parseOsRelease(osRelText);
    const detected = detectDistroFromOsRelease(parsed);
    assert.ok(detected, `Expected detection for ${osRelText}`);
    assert.equal(detected.key, expectedKey);
  }

  assert.ok(DISTRO_FAMILIES.length >= 12);
  assert.equal(findDistroFamily("pacman")?.key, "arch");
  assert.equal(findDistroFamily("does-not-exist"), null);
});

test("shieldred5 CLI flags (--help, --version, --path, --distro-cmd, --doctor)", () => {
  const cli = path.join(ROOT, "bin", "shieldred5.js");

  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /ShieldRed 5/);
  assert.match(help.stdout, /--plugson/);
  assert.match(help.stdout, /--install-deps/);

  const ver = spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" });
  assert.equal(ver.status, 0);
  const pkgVer = fs.readFileSync(path.join(ROOT, "shieldred5", "version"), "utf8").trim();
  assert.ok(ver.stdout.includes(pkgVer));

  const rootOut = spawnSync(process.execPath, [cli, "--path"], { encoding: "utf8" });
  assert.equal(rootOut.status, 0);
  assert.equal(rootOut.stdout.trim(), ROOT);

  const distroAll = spawnSync(process.execPath, [cli, "--distro-cmd", "all"], { encoding: "utf8" });
  assert.equal(distroAll.status, 0);
  for (const tok of ["apt-get", "dnf", "pacman", "zypper", "apk", "xbps-install", "emerge", "eopkg", "nix-shell"]) {
    assert.ok(distroAll.stdout.includes(tok), `Missing ${tok} in --distro-cmd all`);
  }

  const badDistro = spawnSync(process.execPath, [cli, "--distro-cmd", "nonexistent-distro"], { encoding: "utf8" });
  assert.equal(badDistro.status, 1);

  const doctor = spawnSync(process.execPath, [cli, "--doctor"], { encoding: "utf8" });
  assert.equal(doctor.status, 0);
  assert.match(doctor.stdout, /ShieldRed 5 Doctor/);
});

test("Plugson HTTP & /vtoy/json server serves plugson.tar.xz and persists ventoy.json", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sr5-plugson-test-"));
  const cacheDir = path.join(tmpDir, "www-cache");
  const usbDir = path.join(tmpDir, "usb");
  fs.mkdirSync(path.join(usbDir, "ISO"), { recursive: true });
  fs.writeFileSync(path.join(usbDir, "ISO", "test.iso"), "stub");

  const { server, url, jsonPath } = await startPlugsonServer({
    pkgRoot: ROOT,
    dir: usbDir,
    host: "127.0.0.1",
    port: 0,
    cacheDir
  });

  try {
    const indexRes = await fetch(url);
    assert.equal(indexRes.status, 200);
    const html = await indexRes.text();
    assert.match(html, /ShieldRed 5 Plugson/);

    const postRpc = async (body) => {
      const r = await fetch(`${url}vtoy/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      assert.equal(r.status, 200);
      return r.json();
    };

    const sysinfo = await postRpc({ method: "sysinfo" });
    assert.equal(sysinfo.curdir, usbDir);

    const checkRes = await postRpc({ method: "check_path", dir: 0, path: `${usbDir}/ISO/test.iso` });
    assert.equal(checkRes.exist, 1);

    const saveCtrl = await postRpc({
      method: "save_control",
      index: 0,
      default_menu_mode: 1,
      filter_dot_underscore: 1,
      menu_timeout: 10
    });
    assert.equal(saveCtrl.result, "success");

    const addAlias = await postRpc({
      method: "alias_add",
      index: 0,
      path: "/ISO/test.iso",
      alias: "Test Distro ISO",
      type: 0
    });
    assert.equal(addAlias.result, "success");

    const addConf = await postRpc({
      method: "conf_replace_add",
      index: 0,
      path: "/ISO/test.iso",
      org: "/boot/grub/grub.cfg",
      new: "/ventoy/grub_new.cfg",
      img: 0
    });
    assert.equal(addConf.result, "success");
    const gotConf = await postRpc({ method: "get_conf_replace" });
    assert.equal(gotConf[0][0].path, "/ISO/test.iso");
    assert.equal(gotConf[0][0].org, "/boot/grub/grub.cfg");

    const addPwd = await postRpc({
      method: "password_add",
      index: 0,
      type: 0,
      path: "/ISO/test.iso",
      pwd: "txt#secret"
    });
    assert.equal(addPwd.result, "success");
    const savePwd = await postRpc({
      method: "save_password",
      index: 0,
      bootpwd: "txt#boot"
    });
    assert.equal(savePwd.result, "success");
    const gotPwd = await postRpc({ method: "get_password" });
    assert.equal(gotPwd[0].bootpwd, "txt#boot");
    assert.equal(gotPwd[0].list.length, 1);
    assert.equal(gotPwd[0].list[0].path, "/ISO/test.iso");

    const hs = await postRpc({ method: "handshake" });
    assert.equal(hs.exist_control[0], 1);
    assert.equal(hs.exist_menu_alias[0], 1);
    assert.equal(hs.exist_conf_replace[0], 1);
    assert.equal(hs.exist_password[0], 1);

    const preview = await postRpc({ method: "preview_json" });
    const decoded = decodeUtf16Hex(preview.json);
    const parsedPreview = JSON.parse(decoded);
    assert.equal(parsedPreview.menu_alias[0].alias, "Test Distro ISO");
    assert.equal(encodeUtf16Hex("AB"), "00410042");

    assert.ok(fs.existsSync(jsonPath));
    const savedOnDisk = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    assert.equal(savedOnDisk.menu_alias[0].image, "/ISO/test.iso");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Unix scripts and packaging files use LF line endings and match version", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const fileVer = fs.readFileSync(path.join(ROOT, "shieldred5", "version"), "utf8").trim();
  assert.equal(pkg.version, fileVer);

  for (const binRel of Object.values(pkg.bin)) {
    assert.ok(fs.existsSync(path.join(ROOT, binRel)), `Missing bin target: ${binRel}`);
  }

  const unixFiles = [
    "ShieldRed5_Linux.sh",
    "ShieldRed5_macOS.sh",
    "install.sh",
    "uninstall.sh",
    "tool/ShieldRed5Worker.sh",
    "tool/shieldred5_lib.sh",
    "tool/shieldred5_helper.py",
    "tool/shieldred5_macos.py",
    "bin/distro.js",
    "bin/shieldred5.js",
    "bin/shieldred5-plugson.js",
    "bin/plugson-server.js",
    "packaging/debian/control",
    "packaging/debian/build-deb.sh",
    "packaging/rpm/shieldred5.spec",
    "packaging/arch/PKGBUILD",
    "packaging/alpine/APKBUILD",
    "packaging/void/template",
    "packaging/gentoo/shieldred5-1.1.2.ebuild",
    "packaging/nix/flake.nix"
  ];

  for (const rel of unixFiles) {
    const raw = fs.readFileSync(path.join(ROOT, rel));
    assert.equal(raw.includes(0x0d), false, `CRLF byte found in ${rel}`);
  }
});

