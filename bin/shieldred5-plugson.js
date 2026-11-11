#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { startPlugsonServer, openBrowser } = require("./plugson-server");

function parseArgs(argv) {
  const opts = { host: "127.0.0.1", port: 24680, dir: "", open: true, native: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "--no-open") {
      opts.open = false;
    } else if (arg === "--native") {
      opts.native = true;
    } else if (arg === "--host" && argv[i + 1]) {
      opts.host = argv[++i];
    } else if (arg === "-p" || arg === "--port") {
      if (argv[i + 1]) opts.port = Number(argv[++i]);
    } else if (arg === "-d" || arg === "--dir") {
      if (argv[i + 1]) opts.dir = argv[++i];
    } else if (!arg.startsWith("-") && !opts.dir) {
      opts.dir = arg;
    }
  }
  return opts;
}

function printHelp() {
  console.log(`ShieldRed 5 Plugson Web Configurator (Cross-Platform)

Usage:
  shieldred5-plugson [OPTIONS] [USB_MOUNT_DIR]
  shieldred5 --plugson [OPTIONS] [USB_MOUNT_DIR]

Options:
  -d, --dir <PATH>   Target USB root or plugin folder containing ventoy/ventoy.json
  -p, --port <PORT>  HTTP listen port (default: 24680)
  --host <HOST>      HTTP listen host (default: 127.0.0.1)
  --no-open          Do not open the browser automatically
  --native           On Windows, launch native ShieldRed5Plugson.exe instead
  -h, --help         Show this help message
`);
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  const pkgRoot = path.resolve(__dirname, "..");

  if (opts.native) {
    if (process.platform !== "win32") {
      console.error("Error: --native ShieldRed5Plugson.exe is Windows-only. Omit --native to run the cross-platform web UI.");
      return 1;
    }
    const exe64 = path.join(pkgRoot, "altexe", "ShieldRed5Plugson_X64.exe");
    const exe32 = path.join(pkgRoot, "ShieldRed5Plugson.exe");
    const exe = process.arch === "x64" && require("node:fs").existsSync(exe64) ? exe64 : exe32;
    const res = spawnSync(exe, [], { cwd: pkgRoot, stdio: "inherit" });
    return res.status ?? 0;
  }

  const { server, url, targetDir, jsonPath } = await startPlugsonServer({
    pkgRoot,
    dir: opts.dir,
    host: opts.host,
    port: opts.port
  });

  console.log(`ShieldRed 5 Plugson Web UI running at ${url}`);
  console.log(`Target directory : ${targetDir}`);
  console.log(`Config file      : ${jsonPath}`);
  console.log("Press Ctrl+C to stop.");

  if (opts.open) {
    openBrowser(url);
  }

  await new Promise((resolve) => {
    process.on("SIGINT", () => {
      server.close(() => resolve());
    });
    process.on("SIGTERM", () => {
      server.close(() => resolve());
    });
  });
  return 0;
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

module.exports = { main, parseArgs };
