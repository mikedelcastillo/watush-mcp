#!/usr/bin/env node
/**
 * Add or remove the [mcp_servers.<name>] block in Codex's config.toml.
 * Usage:
 *   edit-codex.mjs add <command> [name] [arg ...]   # arg... become the args array
 *   edit-codex.mjs remove "" [name]
 * On macOS/Linux <command> is the launcher (no extra args). On Windows pass
 *   add node <name> C:/path/to/dist/src/mcp-server.js
 * Backs up the file before writing. Idempotent: an existing block (and any of
 * its sub-tables) is removed/replaced cleanly.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const [action, command, name = "watush", ...extraArgs] = process.argv.slice(2);
const file = join(homedir(), ".codex", "config.toml");
const header = `[mcp_servers.${name}]`;
const fullKey = `mcp_servers.${name}`;

function backup() {
  if (existsSync(file)) copyFileSync(file, `${file}.bak.${Date.now()}`);
}

const tomlStr = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Parse a TOML table/array-of-tables header line -> its dotted key, else null. */
function headerKey(line) {
  const m = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/);
  return m ? m[1].trim() : null;
}

/** Is `key` our table or one of its sub-tables (mcp_servers.<name>[.x])? */
function isOurs(key) {
  return key === fullKey || key.startsWith(`${fullKey}.`);
}

/** Remove our table block (and any sub-tables), stopping at the next section. */
function stripBlock(text) {
  const out = [];
  let skipping = false;
  for (const line of text.split("\n")) {
    const key = headerKey(line);
    if (key !== null) {
      if (isOurs(key)) {
        skipping = true; // start/continue dropping our block + sub-tables
        continue;
      }
      skipping = false; // a different section begins — keep it
      out.push(line);
      continue;
    }
    if (skipping) continue; // drop body lines belonging to our block
    out.push(line);
  }
  return out.join("\n");
}

const tidy = (s) => s.replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "");

let text = existsSync(file) ? readFileSync(file, "utf8") : "";

if (action === "add") {
  if (!command) {
    console.error("missing command");
    process.exit(2);
  }
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) backup();
  const argsToml = extraArgs.map(tomlStr).join(", ");
  const block = `${header}\ncommand = ${tomlStr(command)}\nargs = [${argsToml}]\n`;
  const base = tidy(stripBlock(text));
  writeFileSync(file, base ? `${base}\n\n${block}` : block);
} else if (action === "remove") {
  if (!existsSync(file)) process.exit(0);
  backup();
  writeFileSync(file, tidy(stripBlock(text)) + "\n");
} else {
  console.error("usage: edit-codex.mjs add <command> [name] [arg ...]  |  edit-codex.mjs remove \"\" [name]");
  process.exit(2);
}
