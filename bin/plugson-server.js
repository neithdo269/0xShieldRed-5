"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");

const BIOS_POSTFIX = ["", "_legacy", "_uefi", "_ia32", "_aa64", "_mips"];
const DEL_ALL_PATH = "4119ae33-98ea-448e-b9c0-569aafcf1fb4";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject"
};

const CONTROL_DEFAULTS = {
  win11_bypass_check: 1,
  win11_bypass_nro: 1,
  linux_remount: 0,
  uefi_res_lock: 0,
  uefi_sb_policy: 0,
  secondary_menu: 1,
  password_asterisk: 1,
  default_search_root: "",
  default_search_root_valid: 1,
  menu_timeout: 0,
  secondary_menu_timeout: 0,
  default_image: "",
  default_image_valid: 1,
  max_search_level: -1,
  default_kbd_layout: "QWERTY",
  default_menu_mode: 0,
  treeview_style: 0,
  filter_dot_underscore: 1,
  sort_casesensitive: 0,
  vhd_no_warning: 0,
  filter_iso: 0,
  filter_wim: 0,
  filter_efi: 0,
  filter_img: 0,
  filter_vhd: 0,
  filter_vtoy: 0,
  menu_language: "",
  menu_list: []
};

const CONTROL_KEY_MAP = [
  ["win11_bypass_check", "VTOY_WIN11_BYPASS_CHECK", "int"],
  ["win11_bypass_nro", "VTOY_WIN11_BYPASS_NRO", "int"],
  ["linux_remount", "VTOY_LINUX_REMOUNT", "int"],
  ["uefi_res_lock", "VTOY_UEFI_RES_LOCK", "int"],
  ["uefi_sb_policy", "VTOY_UEFI_SB_POLICY", "int"],
  ["secondary_menu", "VTOY_SECONDARY_BOOT_MENU", "int"],
  ["password_asterisk", "VTOY_PASSWORD_ASTERISK", "int"],
  ["default_search_root", "VTOY_DEFAULT_SEARCH_ROOT", "str"],
  ["menu_timeout", "VTOY_MENU_TIMEOUT", "int"],
  ["secondary_menu_timeout", "VTOY_SECONDARY_TIMEOUT", "int"],
  ["default_image", "VTOY_DEFAULT_IMAGE", "str"],
  ["max_search_level", "VTOY_MAX_SEARCH_LEVEL", "depth"],
  ["default_kbd_layout", "VTOY_DEFAULT_KBD_LAYOUT", "str"],
  ["default_menu_mode", "VTOY_DEFAULT_MENU_MODE", "int"],
  ["treeview_style", "VTOY_TREE_VIEW_MENU_STYLE", "int"],
  ["filter_dot_underscore", "VTOY_FILT_DOT_UNDERSCORE_FILE", "int"],
  ["sort_casesensitive", "VTOY_SORT_CASE_SENSITIVE", "int"],
  ["vhd_no_warning", "VTOY_VHD_NO_WARNING", "int"],
  ["filter_iso", "VTOY_FILTER_ISO", "int"],
  ["filter_wim", "VTOY_FILTER_WIM", "int"],
  ["filter_efi", "VTOY_FILTER_EFI", "int"],
  ["filter_img", "VTOY_FILTER_IMG", "int"],
  ["filter_vhd", "VTOY_FILTER_VHD", "int"],
  ["filter_vtoy", "VTOY_FILTER_VTOY", "int"],
  ["menu_language", "VTOY_MENU_LANGUAGE", "str"]
];

function encodeUtf16Hex(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    out += text.charCodeAt(i).toString(16).padStart(4, "0");
  }
  return out;
}

function readPackageVersion(pkgRoot) {
  try {
    return fs.readFileSync(path.join(pkgRoot, "shieldred5", "version"), "utf8").trim() || "1.1.2";
  } catch {
    return "1.1.2";
  }
}

function extractPlugsonWebAssets(pkgRoot, cacheDir) {
  const version = readPackageVersion(pkgRoot);
  const targetBase = cacheDir || path.join(os.tmpdir(), `shieldred5-plugson-${version}`);
  const wwwDir = path.join(targetBase, "www");
  if (fs.existsSync(path.join(wwwDir, "index.html"))) {
    return wwwDir;
  }

  const archivePath = path.join(pkgRoot, "shieldred5", "plugson.tar.xz");
  if (!fs.existsSync(archivePath)) {
    throw new Error(`Missing Plugson archive: ${archivePath}`);
  }

  fs.mkdirSync(targetBase, { recursive: true });
  const tarRes = spawnSync("tar", ["-xJf", archivePath, "-C", targetBase], { stdio: "pipe" });
  if (tarRes.status === 0 && fs.existsSync(path.join(wwwDir, "index.html"))) {
    return wwwDir;
  }

  const pyCmd = process.platform === "win32" ? "python" : "python3";
  const pyScript =
    "import sys, tarfile; tf = tarfile.open(sys.argv[1], 'r:xz'); tf.extractall(sys.argv[2])";
  for (const exe of [pyCmd, "python3", "python"]) {
    const pyRes = spawnSync(exe, ["-c", pyScript, archivePath, targetBase], { stdio: "pipe" });
    if (pyRes.status === 0 && fs.existsSync(path.join(wwwDir, "index.html"))) {
      return wwwDir;
    }
  }

  throw new Error(
    `Failed to extract ${archivePath}. Ensure 'tar' (with xz support) or 'python3' is installed.`
  );
}

function resolveTargetDir(pkgRoot, explicitDir) {
  if (explicitDir) {
    return path.resolve(explicitDir);
  }
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "ventoy", "ventoy.json"))) {
    return cwd;
  }
  const pluginDir = path.join(pkgRoot, "plugin");
  if (fs.existsSync(path.join(pluginDir, "ventoy", "ventoy.json"))) {
    return pluginDir;
  }
  return cwd;
}

function normalizeRelPath(inputPath) {
  if (!inputPath) return "";
  let p = String(inputPath).replace(/\\/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}

function checkLocalPath(baseDir, inputPath, { dir = 0, fuzzy = 0 } = {}) {
  if (!inputPath) return 0;
  let rel = String(inputPath);
  if (rel.startsWith(baseDir)) {
    rel = rel.slice(baseDir.length);
  }
  rel = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel) return 0;
  if (fuzzy && rel.includes("*")) {
    return 1;
  }
  const resolved = path.resolve(baseDir, rel);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    return 0;
  }
  try {
    const st = fs.statSync(resolved);
    return dir ? (st.isDirectory() ? 1 : 0) : (st.isFile() ? 1 : 0);
  } catch {
    return 0;
  }
}

function parseControlSection(entries) {
  const obj = { ...CONTROL_DEFAULTS, menu_list: [] };
  if (!Array.isArray(entries)) return obj;
  const flat = {};
  for (const item of entries) {
    if (item && typeof item === "object") {
      for (const [k, v] of Object.entries(item)) {
        flat[k] = v;
      }
    }
  }
  for (const [prop, jsonKey, kind] of CONTROL_KEY_MAP) {
    if (!(jsonKey in flat)) continue;
    const raw = flat[jsonKey];
    if (kind === "int") {
      const n = Number.parseInt(String(raw), 10);
      if (Number.isFinite(n)) obj[prop] = n;
    } else if (kind === "depth") {
      obj[prop] = String(raw) === "max" ? -1 : Number.parseInt(String(raw), 10) || -1;
    } else {
      obj[prop] = String(raw);
    }
  }
  return obj;
}

function serializeControlSection(obj) {
  const out = [];
  for (const [prop, jsonKey, kind] of CONTROL_KEY_MAP) {
    const val = obj[prop];
    const defVal = CONTROL_DEFAULTS[prop];
    if (val === undefined || val === defVal) continue;
    if (kind === "depth") {
      out.push({ [jsonKey]: val === -1 ? "max" : String(val) });
    } else {
      out.push({ [jsonKey]: String(val) });
    }
  }
  return out;
}

function defaultThemeTab() {
  return {
    gfxmode: "1920x1080",
    display_mode: 0,
    resolution_fit: 0,
    default_file: 0,
    filelist: [],
    fontslist: []
  };
}

function parseThemeSection(rawTheme, baseDir) {
  const tab = defaultThemeTab();
  if (!rawTheme || typeof rawTheme !== "object") return tab;
  if (rawTheme.gfxmode) tab.gfxmode = String(rawTheme.gfxmode);
  if (rawTheme.display_mode === "serial_console") tab.display_mode = 3;
  else if (rawTheme.display_mode === "serial") tab.display_mode = 2;
  else if (rawTheme.display_mode === "CLI") tab.display_mode = 1;
  else tab.display_mode = 0;
  tab.resolution_fit = Number(rawTheme.resolution_fit) || 0;
  tab.default_file = Number(rawTheme.default_file) || 0;
  const files = Array.isArray(rawTheme.file) ? rawTheme.file : rawTheme.file ? [rawTheme.file] : [];
  tab.filelist = files.map((p) => ({
    path: normalizeRelPath(p),
    valid: checkLocalPath(baseDir, p, { dir: 0 })
  }));
  const fonts = Array.isArray(rawTheme.fonts) ? rawTheme.fonts : rawTheme.fonts ? [rawTheme.fonts] : [];
  tab.fontslist = fonts.map((p) => ({
    path: normalizeRelPath(p),
    valid: checkLocalPath(baseDir, p, { dir: 0 })
  }));
  return tab;
}

function serializeThemeSection(tab) {
  const out = {};
  if (tab.filelist.length === 1) {
    out.file = tab.filelist[0].path;
  } else if (tab.filelist.length > 1) {
    out.file = tab.filelist.map((x) => x.path);
    if (tab.default_file > 0) out.default_file = tab.default_file;
  }
  const modes = ["GUI", "CLI", "serial", "serial_console"];
  const modeStr = modes[tab.display_mode] || "GUI";
  if (modeStr !== "GUI" || Object.keys(out).length > 0) {
    out.display_mode = modeStr;
  }
  if (tab.gfxmode && (tab.gfxmode !== "1920x1080" || Object.keys(out).length > 0)) {
    out.gfxmode = tab.gfxmode;
  }
  if (tab.resolution_fit) out.resolution_fit = tab.resolution_fit;
  if (tab.fontslist.length > 0) out.fonts = tab.fontslist.map((x) => x.path);
  return Object.keys(out).length > 0 ? out : null;
}

function createPlugsonState(pkgRoot, targetDir) {
  const ventoyDir = path.join(targetDir, "ventoy");
  const jsonPath = path.join(ventoyDir, "ventoy.json");
  let config = {};
  let syntaxError = 0;
  let saveError = 0;

  if (fs.existsSync(jsonPath)) {
    try {
      const text = fs.readFileSync(jsonPath, "utf8");
      if (text.trim()) {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          config = parsed;
        } else {
          syntaxError = 1;
        }
      }
    } catch {
      syntaxError = 1;
    }
  }

  function persist() {
    try {
      fs.mkdirSync(ventoyDir, { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(config, null, 4) + "\n", "utf8");
      saveError = 0;
    } catch {
      saveError = 1;
    }
  }

  function keyFor(base, idx) {
    const i = Number(idx) || 0;
    return base + (BIOS_POSTFIX[i] || "");
  }

  function existFlags(base) {
    return BIOS_POSTFIX.map((sfx) => {
      const val = config[base + sfx];
      if (Array.isArray(val)) return val.length > 0 ? 1 : 0;
      if (val && typeof val === "object") return Object.keys(val).length > 0 ? 1 : 0;
      return val ? 1 : 0;
    });
  }

  function getMultiTab(builder) {
    const arr = [];
    for (let i = 0; i < 6; i += 1) {
      arr.push(builder(i));
    }
    arr.push(builder(6));
    return arr;
  }

  function makePathItem(rawPath, type = 0) {
    const norm = normalizeRelPath(rawPath);
    return {
      path: norm,
      type,
      valid: type === 1 ? checkLocalPath(targetDir, norm, { dir: 1 }) : checkLocalPath(targetDir, norm, { dir: 0, fuzzy: 1 })
    };
  }

  function getInnerListTab(section, pathKey, listKey, idx) {
    if (idx === 6) return [];
    const arr = config[keyFor(section, idx)];
    if (!Array.isArray(arr)) return [];
    return arr.map((item) => {
      const type = item.dir ? 1 : 0;
      const p = normalizeRelPath(item[pathKey] || item.dir || item.image || "");
      const rawSub = Array.isArray(item[listKey]) ? item[listKey] : item[listKey] ? [item[listKey]] : [];
      return {
        path: p,
        type,
        valid: checkLocalPath(targetDir, p, { dir: type, fuzzy: 1 }),
        autosel: Number(item.autosel) || 1,
        timeout: Number(item.timeout) || 0,
        list: rawSub.map((sub) => ({
          path: normalizeRelPath(sub),
          valid: checkLocalPath(targetDir, sub, { dir: 0 })
        }))
      };
    });
  }

  function updateSectionList(section, idx, mutator) {
    const k = keyFor(section, idx);
    const list = Array.isArray(config[k]) ? [...config[k]] : [];
    const res = mutator(list);
    if (res.changed) {
      if (list.length > 0) config[k] = list;
      else delete config[k];
      persist();
    }
    return res.status || { result: "success" };
  }

  function handleRpc(reqObj) {
    const m = reqObj && reqObj.method;
    const idx = Number(reqObj && reqObj.index) || 0;

    switch (m) {
      case "sysinfo":
        return {
          language: "en",
          curdir: targetDir,
          os: process.platform === "win32" ? "windows" : process.platform,
          syntax_error: syntaxError,
          invalid_config: 0
        };

      case "handshake":
        return {
          save_error: saveError,
          exist_control: existFlags("control"),
          exist_theme: existFlags("theme"),
          exist_menu_alias: existFlags("menu_alias"),
          exist_menu_class: existFlags("menu_class"),
          exist_menu_tip: existFlags("menu_tip"),
          exist_auto_install: existFlags("auto_install"),
          exist_persistence: existFlags("persistence"),
          exist_injection: existFlags("injection"),
          exist_auto_memdisk: existFlags("auto_memdisk"),
          exist_image_list: existFlags("image_list"),
          exist_conf_replace: existFlags("conf_replace"),
          exist_dud: existFlags("dud"),
          exist_password: existFlags("password")
        };

      case "device_info":
        return {
          dev_name: targetDir,
          dev_capacity: "Directory / Mount",
          dev_fs: "Host Filesystem",
          ventoy_ver: readPackageVersion(pkgRoot),
          part_style: 0,
          secure_boot: 1
        };

      case "preview_json":
        return {
          json: encodeUtf16Hex(JSON.stringify(config, null, 4))
        };

      case "check_path":
        return {
          exist: checkLocalPath(targetDir, reqObj.path, { dir: Number(reqObj.dir) || 0 })
        };

      case "check_path2":
        return {
          exist1: checkLocalPath(targetDir, reqObj.path1, {
            dir: Number(reqObj.dir1) || 0,
            fuzzy: Number(reqObj.fuzzy1) || 0
          }),
          exist2: checkLocalPath(targetDir, reqObj.path2, {
            dir: Number(reqObj.dir2) || 0,
            fuzzy: Number(reqObj.fuzzy2) || 0
          })
        };

      case "check_fuzzy":
        return { exist: 1 };

      case "get_control":
        return getMultiTab((i) => {
          if (i === 6) return { ...CONTROL_DEFAULTS, menu_list: [] };
          const obj = parseControlSection(config[keyFor("control", i)]);
          obj.default_search_root_valid = obj.default_search_root
            ? checkLocalPath(targetDir, obj.default_search_root, { dir: 1 })
            : 1;
          obj.default_image_valid = obj.default_image
            ? checkLocalPath(targetDir, obj.default_image, { dir: 0 })
            : 1;
          return obj;
        });

      case "save_control": {
        const arr = serializeControlSection(reqObj);
        const k = keyFor("control", idx);
        if (arr.length > 0) config[k] = arr;
        else delete config[k];
        persist();
        return { result: "success" };
      }

      case "get_theme":
        return getMultiTab((i) => (i === 6 ? defaultThemeTab() : parseThemeSection(config[keyFor("theme", i)], targetDir)));

      case "save_theme": {
        const k = keyFor("theme", idx);
        const cur = parseThemeSection(config[k], targetDir);
        cur.gfxmode = reqObj.gfxmode || "1920x1080";
        cur.display_mode = Number(reqObj.display_mode) || 0;
        cur.resolution_fit = Number(reqObj.resolution_fit) || 0;
        if ("default_file" in reqObj) cur.default_file = Number(reqObj.default_file) || 0;
        const ser = serializeThemeSection(cur);
        if (ser) config[k] = ser;
        else delete config[k];
        persist();
        return { result: "success" };
      }

      case "theme_add_file":
      case "theme_add_font": {
        const k = keyFor("theme", idx);
        const cur = parseThemeSection(config[k], targetDir);
        const list = m === "theme_add_file" ? cur.filelist : cur.fontslist;
        const p = normalizeRelPath(reqObj.path);
        if (list.some((x) => x.path === p)) return { result: "duplicate" };
        list.push({ path: p, valid: 1 });
        config[k] = serializeThemeSection(cur) || {};
        persist();
        return { result: "success" };
      }

      case "theme_del_file":
      case "theme_del_font": {
        const k = keyFor("theme", idx);
        const cur = parseThemeSection(config[k], targetDir);
        const prop = m === "theme_del_file" ? "filelist" : "fontslist";
        cur[prop] = reqObj.path === DEL_ALL_PATH ? [] : cur[prop].filter((x) => x.path !== reqObj.path);
        const ser = serializeThemeSection(cur);
        if (ser) config[k] = ser;
        else delete config[k];
        persist();
        return { result: "success" };
      }

      case "get_alias":
        return getMultiTab((i) => {
          if (i === 6) return [];
          const arr = config[keyFor("menu_alias", i)];
          if (!Array.isArray(arr)) return [];
          return arr.map((x) => ({
            ...makePathItem(x.dir || x.image, x.dir ? 1 : 0),
            alias: x.alias || ""
          }));
        });

      case "alias_add":
        return updateSectionList("menu_alias", idx, (list) => {
          const p = normalizeRelPath(reqObj.path);
          if (list.some((x) => (x.dir || x.image) === p)) return { changed: false, status: { result: "duplicate" } };
          list.push(Number(reqObj.type) === 1 ? { dir: p, alias: reqObj.alias } : { image: p, alias: reqObj.alias });
          return { changed: true };
        });

      case "alias_del":
        return updateSectionList("menu_alias", idx, (list) => {
          if (reqObj.path === DEL_ALL_PATH) {
            list.length = 0;
            return { changed: true };
          }
          const idxDel = list.findIndex((x) => (x.dir || x.image) === reqObj.path);
          if (idxDel >= 0) list.splice(idxDel, 1);
          return { changed: idxDel >= 0 };
        });

      case "get_class":
        return getMultiTab((i) => {
          if (i === 6) return [];
          const arr = config[keyFor("menu_class", i)];
          if (!Array.isArray(arr)) return [];
          return arr.map((x) => ({
            path: x.key || normalizeRelPath(x.dir || x.parent || ""),
            class: x.class || "",
            type: x.key ? 0 : x.dir ? 1 : 2,
            valid: 1
          }));
        });

      case "class_add":
        return updateSectionList("menu_class", idx, (list) => {
          const t = Number(reqObj.type) || 0;
          const p = t === 0 ? reqObj.path : normalizeRelPath(reqObj.path);
          if (list.some((x) => (x.key || x.dir || x.parent) === p)) return { changed: false, status: { result: "duplicate" } };
          if (t === 0) list.push({ key: p, class: reqObj.class });
          else if (t === 1) list.push({ dir: p, class: reqObj.class });
          else list.push({ parent: p, class: reqObj.class });
          return { changed: true };
        });

      case "class_del":
        return updateSectionList("menu_class", idx, (list) => {
          if (reqObj.path === DEL_ALL_PATH) {
            list.length = 0;
            return { changed: true };
          }
          const idxDel = list.findIndex((x) => (x.key || x.dir || x.parent) === reqObj.path);
          if (idxDel >= 0) list.splice(idxDel, 1);
          return { changed: idxDel >= 0 };
        });

      case "get_tip":
        return getMultiTab((i) => {
          const empty = { left: "5%", top: "95%", color: "#0000ff", tips: [] };
          if (i === 6) return empty;
          const sec = config[keyFor("menu_tip", i)];
          if (!sec || typeof sec !== "object") return empty;
          const tips = Array.isArray(sec.tips)
            ? sec.tips.map((x) => ({ ...makePathItem(x.dir || x.image, x.dir ? 1 : 0), tip: x.tip || "" }))
            : [];
          return {
            left: sec.left || "5%",
            top: sec.top || "95%",
            color: sec.color || "#0000ff",
            tips
          };
        });

      case "save_tip": {
        const k = keyFor("menu_tip", idx);
        const cur = config[k] && typeof config[k] === "object" ? config[k] : { tips: [] };
        cur.left = reqObj.left || "5%";
        cur.top = reqObj.top || "95%";
        cur.color = reqObj.color || "#0000ff";
        config[k] = cur;
        persist();
        return { result: "success" };
      }

      case "tip_add": {
        const k = keyFor("menu_tip", idx);
        const cur = config[k] && typeof config[k] === "object" ? config[k] : { left: "5%", top: "95%", color: "#0000ff", tips: [] };
        cur.tips = Array.isArray(cur.tips) ? cur.tips : [];
        const p = normalizeRelPath(reqObj.path);
        if (cur.tips.some((x) => (x.dir || x.image) === p)) return { result: "duplicate" };
        cur.tips.push(Number(reqObj.type) === 1 ? { dir: p, tip: reqObj.tip } : { image: p, tip: reqObj.tip });
        config[k] = cur;
        persist();
        return { result: "success" };
      }

      case "tip_del": {
        const k = keyFor("menu_tip", idx);
        const cur = config[k];
        if (cur && Array.isArray(cur.tips)) {
          cur.tips = reqObj.path === DEL_ALL_PATH ? [] : cur.tips.filter((x) => (x.dir || x.image) !== reqObj.path);
          if (cur.tips.length === 0) delete config[k];
          persist();
        }
        return { result: "success" };
      }

      case "get_auto_install":
        return getMultiTab((i) => getInnerListTab("auto_install", "image", "template", i));

      case "auto_install_add":
        return updateSectionList("auto_install", idx, (list) => {
          const p = normalizeRelPath(reqObj.path);
          if (list.some((x) => (x.parent || x.image) === p)) return { changed: false, status: { result: "duplicate" } };
          const tpl = Array.isArray(reqObj.template) ? reqObj.template.map(normalizeRelPath) : [normalizeRelPath(reqObj.template)];
          list.push(Number(reqObj.type) === 1 ? { parent: p, template: tpl.length === 1 ? tpl[0] : tpl } : { image: p, template: tpl.length === 1 ? tpl[0] : tpl });
          return { changed: true };
        });

      case "save_auto_install":
        return updateSectionList("auto_install", idx, (list) => {
          const item = list[Number(reqObj.id)];
          if (!item) return { changed: false };
          if (reqObj.timeouten) item.timeout = reqObj.timeout;
          else delete item.timeout;
          if (reqObj.autoselen) item.autosel = reqObj.autosel;
          else delete item.autosel;
          return { changed: true };
        });

      case "auto_install_del":
        return updateSectionList("auto_install", idx, (list) => {
          if (reqObj.path === DEL_ALL_PATH) {
            list.length = 0;
            return { changed: true };
          }
          const pos = list.findIndex((x) => (x.parent || x.image) === reqObj.path);
          if (pos >= 0) list.splice(pos, 1);
          return { changed: pos >= 0 };
        });

      case "auto_install_add_inner":
        return updateSectionList("auto_install", idx, (list) => {
          const item = list.find((x) => (x.parent || x.image) === reqObj.outpath);
          if (!item) return { changed: false };
          const arr = Array.isArray(item.template) ? item.template : [item.template];
          const p = normalizeRelPath(reqObj.path);
          if (arr.includes(p)) return { changed: false, status: { result: "duplicate" } };
          arr.push(p);
          item.template = arr;
          return { changed: true };
        });

      case "auto_install_del_inner":
        return updateSectionList("auto_install", idx, (list) => {
          const item = list.find((x) => (x.parent || x.image) === reqObj.outpath);
          if (!item) return { changed: false };
          const arr = (Array.isArray(item.template) ? item.template : [item.template]).filter((x) => x !== reqObj.path);
          item.template = arr.length === 1 ? arr[0] : arr;
          return { changed: true };
        });

      case "get_persistence":
        return getMultiTab((i) => getInnerListTab("persistence", "image", "backend", i));

      case "persistence_add":
        return updateSectionList("persistence", idx, (list) => {
          const p = normalizeRelPath(reqObj.path);
          if (list.some((x) => x.image === p)) return { changed: false, status: { result: "duplicate" } };
          const be = Array.isArray(reqObj.backend) ? reqObj.backend.map(normalizeRelPath) : [normalizeRelPath(reqObj.backend)];
          list.push({ image: p, backend: be.length === 1 ? be[0] : be });
          return { changed: true };
        });

      case "save_persistence":
        return updateSectionList("persistence", idx, (list) => {
          const item = list[Number(reqObj.id)];
          if (!item) return { changed: false };
          if (reqObj.timeouten) item.timeout = reqObj.timeout;
          else delete item.timeout;
          if (reqObj.autoselen) item.autosel = reqObj.autosel;
          else delete item.autosel;
          return { changed: true };
        });

      case "persistence_del":
        return updateSectionList("persistence", idx, (list) => {
          if (reqObj.path === DEL_ALL_PATH) {
            list.length = 0;
            return { changed: true };
          }
          const pos = list.findIndex((x) => x.image === reqObj.path);
          if (pos >= 0) list.splice(pos, 1);
          return { changed: pos >= 0 };
        });

      case "persistence_add_inner":
      case "persistence_del_inner":
        return updateSectionList("persistence", idx, (list) => {
          const item = list.find((x) => x.image === reqObj.outpath);
          if (!item) return { changed: false };
          const arr = Array.isArray(item.backend) ? item.backend : [item.backend];
          const p = normalizeRelPath(reqObj.path);
          if (m.endsWith("_add_inner")) {
            if (arr.includes(p)) return { changed: false, status: { result: "duplicate" } };
            arr.push(p);
            item.backend = arr;
          } else {
            const next = arr.filter((x) => x !== reqObj.path);
            item.backend = next.length === 1 ? next[0] : next;
          }
          return { changed: true };
        });

      case "get_injection":
        return getMultiTab((i) => {
          if (i === 6) return [];
          const arr = config[keyFor("injection", i)];
          if (!Array.isArray(arr)) return [];
          return arr.map((x) => ({
            ...makePathItem(x.parent || x.image, x.parent ? 1 : 0),
            archive: normalizeRelPath(x.archive),
            archive_valid: checkLocalPath(targetDir, x.archive, { dir: 0 })
          }));
        });

      case "injection_add":
        return updateSectionList("injection", idx, (list) => {
          const p = normalizeRelPath(reqObj.path);
          if (list.some((x) => (x.parent || x.image) === p)) return { changed: false, status: { result: "duplicate" } };
          const arc = normalizeRelPath(reqObj.archive);
          list.push(Number(reqObj.type) === 1 ? { parent: p, archive: arc } : { image: p, archive: arc });
          return { changed: true };
        });

      case "injection_del":
        return updateSectionList("injection", idx, (list) => {
          if (reqObj.path === DEL_ALL_PATH) {
            list.length = 0;
            return { changed: true };
          }
          const pos = list.findIndex((x) => (x.parent || x.image) === reqObj.path);
          if (pos >= 0) list.splice(pos, 1);
          return { changed: pos >= 0 };
        });

      case "get_auto_memdisk":
        return getMultiTab((i) => {
          if (i === 6) return [];
          const arr = config[keyFor("auto_memdisk", i)];
          return Array.isArray(arr) ? arr.map((p) => makePathItem(p, 0)) : [];
        });

      case "auto_memdisk_add":
        return updateSectionList("auto_memdisk", idx, (list) => {
          const p = normalizeRelPath(reqObj.path);
          if (list.includes(p)) return { changed: false, status: { result: "duplicate" } };
          list.push(p);
          return { changed: true };
        });

      case "auto_memdisk_del":
        return updateSectionList("auto_memdisk", idx, (list) => {
          if (reqObj.path === DEL_ALL_PATH) {
            list.length = 0;
            return { changed: true };
          }
          const pos = list.indexOf(reqObj.path);
          if (pos >= 0) list.splice(pos, 1);
          return { changed: pos >= 0 };
        });

      case "get_image_list":
        return getMultiTab((i) => {
          const empty = { type: 0, list: [] };
          if (i === 6) return empty;
          const wl = config[keyFor("image_whitelist", i)];
          const bl = config[keyFor("image_blacklist", i)];
          if (Array.isArray(bl)) return { type: 1, list: bl.map((p) => makePathItem(p, 0)) };
          if (Array.isArray(wl)) return { type: 0, list: wl.map((p) => makePathItem(p, 0)) };
          return empty;
        });

      case "save_image_list": {
        const wlKey = keyFor("image_whitelist", idx);
        const blKey = keyFor("image_blacklist", idx);
        const existing = config[wlKey] || config[blKey] || [];
        delete config[wlKey];
        delete config[blKey];
        if (existing.length > 0) {
          config[Number(reqObj.type) === 1 ? blKey : wlKey] = existing;
        }
        persist();
        return { result: "success" };
      }

      case "image_list_add": {
        const wlKey = keyFor("image_whitelist", idx);
        const blKey = keyFor("image_blacklist", idx);
        const targetKey = Array.isArray(config[blKey]) ? blKey : wlKey;
        const list = Array.isArray(config[targetKey]) ? config[targetKey] : [];
        const p = normalizeRelPath(reqObj.path);
        if (list.includes(p)) return { result: "duplicate" };
        list.push(p);
        config[targetKey] = list;
        persist();
        return { result: "success" };
      }

      case "image_list_del": {
        for (const k of [keyFor("image_whitelist", idx), keyFor("image_blacklist", idx)]) {
          if (Array.isArray(config[k])) {
            config[k] = reqObj.path === DEL_ALL_PATH ? [] : config[k].filter((p) => p !== reqObj.path);
            if (config[k].length === 0) delete config[k];
          }
        }
        persist();
        return { result: "success" };
      }

      case "get_conf_replace":
        return getMultiTab((i) => {
          if (i === 6) return [];
          const arr = config[keyFor("conf_replace", i)];
          if (!Array.isArray(arr)) return [];
          return arr.map((x) => ({
            path: normalizeRelPath(x.iso),
            org: normalizeRelPath(x.org),
            new: normalizeRelPath(x.new),
            valid: checkLocalPath(targetDir, x.iso, { dir: 0, fuzzy: 1 }),
            new_valid: checkLocalPath(targetDir, x.new, { dir: 0 }),
            img: Number(x.img) || 0
          }));
        });

      case "conf_replace_add":
        return updateSectionList("conf_replace", idx, (list) => {
          const iso = normalizeRelPath(reqObj.path);
          const org = normalizeRelPath(reqObj.org);
          const nw = normalizeRelPath(reqObj.new);
          if (list.some((x) => x.iso === iso && x.org === org)) return { changed: false, status: { result: "duplicate" } };
          const entry = { iso, org, new: nw };
          if (Number(reqObj.img)) entry.img = 1;
          list.push(entry);
          return { changed: true };
        });

      case "conf_replace_del":
        return updateSectionList("conf_replace", idx, (list) => {
          if (reqObj.path === DEL_ALL_PATH) {
            list.length = 0;
            return { changed: true };
          }
          const pos = list.findIndex((x) => x.iso === reqObj.path || x.org === reqObj.path);
          if (pos >= 0) list.splice(pos, 1);
          return { changed: pos >= 0 };
        });

      case "get_dud":
        return getMultiTab((i) => getInnerListTab("dud", "image", "dud", i));

      case "dud_add":
        return updateSectionList("dud", idx, (list) => {
          const p = normalizeRelPath(reqObj.path);
          if (list.some((x) => x.image === p)) return { changed: false, status: { result: "duplicate" } };
          const duds = Array.isArray(reqObj.dud) ? reqObj.dud.map(normalizeRelPath) : [normalizeRelPath(reqObj.dud)];
          list.push({ image: p, dud: duds.length === 1 ? duds[0] : duds });
          return { changed: true };
        });

      case "dud_del":
        return updateSectionList("dud", idx, (list) => {
          if (reqObj.path === DEL_ALL_PATH) {
            list.length = 0;
            return { changed: true };
          }
          const pos = list.findIndex((x) => x.image === reqObj.path);
          if (pos >= 0) list.splice(pos, 1);
          return { changed: pos >= 0 };
        });

      case "dud_add_inner":
      case "dud_del_inner":
        return updateSectionList("dud", idx, (list) => {
          const item = list.find((x) => x.image === reqObj.outpath);
          if (!item) return { changed: false };
          const arr = Array.isArray(item.dud) ? item.dud : [item.dud];
          const p = normalizeRelPath(reqObj.path);
          if (m.endsWith("_add_inner")) {
            if (arr.includes(p)) return { changed: false, status: { result: "duplicate" } };
            arr.push(p);
            item.dud = arr;
          } else {
            const next = arr.filter((x) => x !== reqObj.path);
            item.dud = next.length === 1 ? next[0] : next;
          }
          return { changed: true };
        });

      case "get_password":
        return getMultiTab((i) => {
          const empty = { bootpwd: "", isopwd: "", wimpwd: "", imgpwd: "", vhdpwd: "", efipwd: "", vtoypwd: "", list: [] };
          if (i === 6) return empty;
          const sec = config[keyFor("password", i)];
          if (!sec || typeof sec !== "object") return empty;
          const rawList = Array.isArray(sec.menu_password) ? sec.menu_password : [];
          const list = rawList.map((entry) => {
            const type = entry.parent ? 1 : 0;
            const p = normalizeRelPath(entry.parent || entry.file || "");
            return {
              type,
              path: p,
              valid: checkLocalPath(targetDir, p, { dir: type, fuzzy: 1 }),
              pwd: entry.password || ""
            };
          });
          return {
            bootpwd: sec.bootpwd || "",
            isopwd: sec.isopwd || "",
            wimpwd: sec.wimpwd || "",
            imgpwd: sec.imgpwd || "",
            vhdpwd: sec.vhdpwd || "",
            efipwd: sec.efipwd || "",
            vtoypwd: sec.vtoypwd || "",
            list
          };
        });

      case "save_password": {
        const k = keyFor("password", idx);
        const cur = config[k] && typeof config[k] === "object" ? config[k] : {};
        const next = {};
        for (const f of ["bootpwd", "isopwd", "wimpwd", "imgpwd", "vhdpwd", "efipwd", "vtoypwd"]) {
          if (reqObj[f]) next[f] = reqObj[f];
        }
        if (Array.isArray(cur.menu_password) && cur.menu_password.length > 0) {
          next.menu_password = cur.menu_password;
        }
        if (Object.keys(next).length > 0) config[k] = next;
        else delete config[k];
        persist();
        return { result: "success" };
      }

      case "password_add": {
        const k = keyFor("password", idx);
        const cur = config[k] && typeof config[k] === "object" ? { ...config[k] } : {};
        const list = Array.isArray(cur.menu_password) ? [...cur.menu_password] : [];
        const p = normalizeRelPath(reqObj.path);
        if (list.some((x) => (x.parent || x.file) === p)) return { result: "duplicate" };
        list.push(Number(reqObj.type) === 1 ? { parent: p, password: reqObj.pwd } : { file: p, password: reqObj.pwd });
        cur.menu_password = list;
        config[k] = cur;
        persist();
        return { result: "success" };
      }

      case "password_del": {
        const k = keyFor("password", idx);
        const cur = config[k];
        if (cur && typeof cur === "object" && Array.isArray(cur.menu_password)) {
          cur.menu_password = reqObj.path === DEL_ALL_PATH
            ? []
            : cur.menu_password.filter((x) => (x.parent || x.file) !== reqObj.path);
          if (cur.menu_password.length === 0) delete cur.menu_password;
          if (Object.keys(cur).length === 0) delete config[k];
          persist();
        }
        return { result: "success" };
      }

      default:
        return { result: "success" };
    }
  }

  return { handleRpc, jsonPath };
}

function openBrowser(url) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

function startPlugsonServer(options = {}) {
  const pkgRoot = options.pkgRoot || path.resolve(__dirname, "..");
  const targetDir = resolveTargetDir(pkgRoot, options.dir);
  const host = options.host || "127.0.0.1";
  const port = options.port !== undefined ? Number(options.port) : 24680;
  const wwwDir = extractPlugsonWebAssets(pkgRoot, options.cacheDir);
  const state = createPlugsonState(pkgRoot, targetDir);

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", `http://${host}`);
    if (req.method === "POST" && reqUrl.pathname === "/vtoy/json") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const payload = JSON.stringify(state.handleRpc(parsed));
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(payload);
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ result: "error", message: err.message }));
        }
      });
      return;
    }

    let relPath = decodeURIComponent(reqUrl.pathname);
    if (relPath === "/") relPath = "/index.html";
    const resolved = path.resolve(wwwDir, "." + relPath);
    if (!resolved.startsWith(path.resolve(wwwDir))) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(resolved, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      const url = `http://${host}:${actualPort}/`;
      resolve({ server, url, wwwDir, targetDir, jsonPath: state.jsonPath });
    });
  });
}

module.exports = {
  startPlugsonServer,
  extractPlugsonWebAssets,
  resolveTargetDir,
  encodeUtf16Hex,
  openBrowser
};
