/**
 * Config loading + recipient resolution.
 *
 * Pure and offline: no network here. `parseConfig` works on a plain object so it
 * is trivially unit-testable; `loadConfig` is the thin wrapper that reads the
 * YAML file from disk. Resolution (`resolveRecipients`) maps a free-text "to"
 * (a name or a tag like "partner") onto the people to actually message.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export interface Recipient {
  name: string;
  chatId: string;
  tags: string[];
}

export interface Config {
  botToken: string;
  owner: Recipient;
  recipients: Recipient[];
  auditToOwner: boolean;
}

export type Resolution =
  | { kind: "ok"; targets: Recipient[] }
  | { kind: "unknown"; to: string; known: string[] };

const OWNER_ALIASES = new Set(["", "me", "myself", "self", "owner"]);

const here = dirname(fileURLToPath(import.meta.url)); // .../dist/src

/** Path to the live config. Override with WATUSH_CONFIG. Defaults to repo root. */
export function defaultConfigPath(): string {
  return process.env.WATUSH_CONFIG || join(here, "..", "..", "config.yaml");
}

function asString(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

/**
 * Return a trimmed string, treating untouched example placeholders
 * (e.g. "PASTE_YOUR_CHAT_ID_HERE") as unset so an unedited config produces a
 * clear "not configured" message instead of a confusing Telegram API error.
 */
function clean(v: unknown): string {
  const s = asString(v).trim();
  return /^PASTE_[A-Z0-9_]*$/i.test(s) ? "" : s;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asString).map((s) => s.trim()).filter((s) => s.length > 0);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function normalizeRecipient(r: any): Recipient | null {
  if (!r || typeof r !== "object") return null;
  const name = asString(r.name).trim();
  const chatId = clean(r.chatId ?? r.chat_id ?? r.id);
  const tags = asStringArray(r.tags);
  if (!name && !chatId) return null;
  return { name: name || chatId, chatId, tags };
}

/** Build a validated Config from a raw object (e.g. parsed YAML) + env. */
export function parseConfig(raw: any, env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = raw && typeof raw === "object" ? raw : {};

  const botToken = clean(env.TELEGRAM_BOT_TOKEN || cfg.botToken);

  const rawOwner = cfg.owner && typeof cfg.owner === "object" ? cfg.owner : {};
  const ownerChatId = clean(env.TELEGRAM_CHAT_ID || rawOwner.chatId || cfg.chatId);
  const owner: Recipient = {
    name: asString(rawOwner.name).trim() || "You",
    chatId: ownerChatId,
    tags: asStringArray(rawOwner.tags),
  };

  const fileRecipients = Array.isArray(cfg.recipients)
    ? (cfg.recipients.map(normalizeRecipient).filter(Boolean) as Recipient[])
    : [];

  let envRecipients: Recipient[] = [];
  if (env.TELEGRAM_RECIPIENTS) {
    try {
      const parsed = JSON.parse(env.TELEGRAM_RECIPIENTS);
      if (Array.isArray(parsed)) {
        envRecipients = parsed.map(normalizeRecipient).filter(Boolean) as Recipient[];
      }
    } catch {
      /* ignore malformed TELEGRAM_RECIPIENTS */
    }
  }

  // Merge by lower-cased name; env entries override file entries.
  const byName = new Map<string, Recipient>();
  for (const r of fileRecipients) byName.set(r.name.toLowerCase(), r);
  for (const r of envRecipients) byName.set(r.name.toLowerCase(), r);

  const auditToOwner = !(cfg.auditToOwner === false || env.WATUSH_AUDIT === "false");

  return { botToken, owner, recipients: [...byName.values()], auditToOwner };
}

/** Read + parse the YAML config file (tolerant: missing file → defaults). */
export function loadConfig(configPath: string = defaultConfigPath()): Config {
  let raw: unknown = {};
  try {
    if (existsSync(configPath)) {
      raw = parseYaml(readFileSync(configPath, "utf8")) ?? {};
    }
  } catch (e) {
    process.stderr.write(`[watush-mcp] could not read config ${configPath}: ${(e as Error).message}\n`);
  }
  return parseConfig(raw);
}

function knownLabels(cfg: Config): string[] {
  const labels = [`me (${cfg.owner.name})`];
  for (const r of cfg.recipients) {
    labels.push(r.tags.length ? `${r.name} [${r.tags.join(", ")}]` : r.name);
  }
  return labels;
}

function dedupeByChatId(list: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of list) {
    const key = r.chatId || `name:${r.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Resolve a "to" string to the recipients to message.
 *  - omitted / "me" / "myself" / "owner" / owner's name / an owner tag → the owner
 *  - a recipient name or tag → that recipient (case-insensitive)
 *  - a tag shared by several recipients → all of them (fan-out)
 *  - no match → { kind: "unknown" } with the list of known targets
 */
export function resolveRecipients(cfg: Config, to?: string): Resolution {
  const key = (to ?? "").trim().toLowerCase();
  const ownerName = cfg.owner.name.trim().toLowerCase();
  const ownerTagMatch = key !== "" && cfg.owner.tags.some((t) => t.trim().toLowerCase() === key);

  if (OWNER_ALIASES.has(key) || (key !== "" && key === ownerName) || ownerTagMatch) {
    return { kind: "ok", targets: [cfg.owner] };
  }

  const matched = cfg.recipients.filter(
    (r) =>
      r.name.trim().toLowerCase() === key ||
      r.tags.some((t) => t.trim().toLowerCase() === key),
  );

  if (matched.length === 0) {
    return { kind: "unknown", to: to ?? "", known: knownLabels(cfg) };
  }
  return { kind: "ok", targets: dedupeByChatId(matched) };
}
