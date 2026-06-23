#!/usr/bin/env node
/**
 * Add or remove the watush MCP server entry in Claude Desktop's config.
 * Usage: edit-desktop.mjs <add|remove> <launcherPath> [name]
 * Backs up the file before writing. Preserves all other mcpServers.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const [action, launcher, name = "watush"] = process.argv.slice(2);
const file = join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");

function backup() {
  if (existsSync(file)) copyFileSync(file, `${file}.bak.${Date.now()}`);
}

let cfg = {};
if (existsSync(file)) {
  const raw = readFileSync(file, "utf8").trim();
  if (raw) {
    try {
      cfg = JSON.parse(raw);
    } catch (e) {
      console.error(`Claude Desktop config is not valid JSON; leaving it untouched: ${e.message}`);
      process.exit(1);
    }
  }
}

if (action === "add") {
  if (!launcher) {
    console.error("missing launcher path");
    process.exit(2);
  }
  mkdirSync(dirname(file), { recursive: true });
  backup();
  cfg.mcpServers = cfg.mcpServers || {};
  cfg.mcpServers[name] = { command: launcher, args: [] };
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
} else if (action === "remove") {
  if (cfg.mcpServers && cfg.mcpServers[name]) {
    backup();
    delete cfg.mcpServers[name];
    writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  }
} else {
  console.error("usage: edit-desktop.mjs <add|remove> <launcher> [name]");
  process.exit(2);
}
