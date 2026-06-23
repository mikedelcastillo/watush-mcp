# watush-mcp — Design Spec

**Date:** 2026-06-23
**Status:** Approved design, implementation in progress
**Repo:** `github.com/mikedelcastillo/watush-mcp` (public)

## Purpose

`watush-mcp` is a robust, send-only Telegram MCP server that any agent (Claude
Code, Claude Desktop, Codex) can call to message **you or named people in your
life** on Telegram. So you can say *"message me once this is done"* or *"message
my partner after 30 minutes"* and it routes to the right person via your bot — with
an audit copy of every outbound message sent back to you.

It replaces the original zero-dependency `telegram-send.js` with a TypeScript
implementation on the official `@modelcontextprotocol/sdk`, adds a recipients
model with tags, audit copies, idempotent install/uninstall scripts, and is
published as a public GitHub repo with strict secret hygiene.

## Non-goals (YAGNI)

- **Scheduling / timers.** "after 30 minutes" is the *calling agent's* job. The
  MCP tool sends *now*; the agent decides *when* to call it.
- **No persistent process / daemon.** Stdio MCP servers are spawned on demand by
  each client. Nothing to "start on login"; registration with the agents makes
  it available whenever they run.
- **No inbound `/userinfo` bot command** (cancelled). Capturing chat IDs is done
  with a read-only, print-only helper.
- **No message reading.** Send-only. Cannot read your chats.
- **No Markdown/HTML formatting** in v1. Plain text only.

## Secret hygiene (hard requirement)

- The real config — bot token, owner chat ID, recipients — lives in
  **`config.yaml`**, which is **git-ignored** and `chmod 600`.
- A committed **`config.example.yaml`** documents the shape with placeholders.
- `.gitignore` excludes `config.yaml`, `node_modules/`, `dist/`, `*.bak*`, and
  the legacy `telegram.config.json`.
- The repo is initialized with `.gitignore` in place **before the first commit**,
  so no secret is ever staged. A pre-push grep verifies the bot-token pattern
  appears in no tracked file.
- The existing token in `telegram.config.json` is migrated into the local
  `config.yaml` and the legacy JSON is deleted (never committed).

## Architecture

```
watush-mcp/
  src/
    config.ts        # load + validate YAML config + env, recipient resolution
    telegram.ts      # Telegram Bot API client (sendMessage) — thin wrapper
    mcp-server.ts    # MCP stdio server on @modelcontextprotocol/sdk; tools
    list-chats.ts    # read-only CLI: print recent chats + IDs
  test/
    config.test.ts   # resolution + load + audit logic (node:test, offline)
  bin/
    watush-mcp-server     # shell launcher: resolves node (PATH→nvm→common)
  dist/                   # compiled JS (gitignored)
  config.yaml             # real secrets + recipients (gitignored, chmod 600)
  config.example.yaml     # template (committed)
  package.json
  tsconfig.json
  .gitignore
  install.sh
  uninstall.sh
  README.md
  LICENSE                 # MIT
```

### Unit responsibilities & interfaces

- **`config.ts`** — loads YAML config from file + env, validates, resolves a `to`
  string to recipient(s). `loadConfig(): Config`,
  `resolveRecipients(cfg, to?): { matched: Recipient[]; owner: Recipient }`.
  Pure/unit-testable (fs + yaml only, no network).
- **`telegram.ts`** — `sendTelegram(token, chatId, text): Promise<void>` (throws
  on API error). Uses global `fetch` (Node 25).
- **`mcp-server.ts`** — registers two tools, resolves via `config.ts`, sends via
  `telegram.ts`, formats results + audits.
- **`list-chats.ts`** — one-shot CLI: Bot API `getUpdates` → prints
  `chatId  (type, name)`. Print only; never writes config.

## Config model — YAML

`config.yaml` (chmod 600, gitignored):

```yaml
botToken: "123:ABC"
owner:
  name: Owner
  chatId: "111111"          # master = you; receives audit copies
recipients:
  - name: Alice
    chatId: "222222"
    tags: [partner, household]
  - name: Bob
    chatId: "333333"
    tags: [friend, team]
auditToOwner: true
```

`config.example.yaml` is the same shape with placeholder values and comments.

**Precedence.** Token: `TELEGRAM_BOT_TOKEN` env → `botToken`. Owner chatId:
`TELEGRAM_CHAT_ID` env → `owner.chatId`. Recipients: file `recipients` merged
with optional `TELEGRAM_RECIPIENTS` (JSON) env (env wins per name). A legacy
top-level `chatId:` (no `owner:`) is accepted as the owner.

## MCP tools

### `send_telegram_message({ text, to? })`

- `text` (string, required).
- `to` (string, optional): recipient **name or tag**, case-insensitive.

**Resolution** (`resolveRecipients`):

1. `to` omitted/empty/`me`/`myself`/`owner`/owner's name → **owner (you)**.
2. Else match recipients where `name === to` or `tags` include `to`
   (case-insensitive, trimmed).
   - 1 match → send to them.
   - >1 match → **fan-out** to all (e.g. "the family"); report list.
   - 0 matches → **error** listing known recipients/tags (never silent
     misdelivery to owner).

**Audit.** For each resolved non-owner recipient, if `auditToOwner`, also send
owner: `🔔 Audit — sent to <Name> (<match>): <text>`. Owner-addressed messages
are not self-audited.

**Result.** e.g. `Sent to Alice (partner). Audit copy sent to you.` Fan-out reports
all. Partial failures: fan-out is sequential; result lists successes + failures
and is flagged `isError` if any failed.

### `list_recipients()`

Returns owner + recipients with **names and tags only** (no chat IDs) so the
model can map "my partner" → a valid `to`.

## Robust agent wiring — the launcher

`node` is at an nvm path GUI apps lack and that changes on upgrade. All three
agents point at `bin/watush-mcp-server`, which resolves a node binary
(PATH → source nvm → homebrew/usr-local) then `exec`s `dist/mcp-server.js`.

## install.sh

Idempotent; backs up before editing.

1. Preflight: require node + npm; print versions.
2. Build: `npm install` → `npm run build` (tsc → dist).
3. Secrets: if `config.yaml` missing, copy from example; `chmod 600`.
4. `chmod +x bin/watush-mcp-server`.
5. Claude Code (if `claude` present): `claude mcp remove watush` then
   `claude mcp add --scope user watush -- <abs>/bin/watush-mcp-server`.
6. Codex (if `~/.codex` exists): add `[mcp_servers.watush]` to `config.toml`
   via Node edit; back up first; skip if already correct.
7. Claude Desktop (if config dir exists): JSON-merge `watush` into `mcpServers`;
   back up first; preserve existing servers.
8. Summary: wired / skipped / next steps.

Re-run install.sh to update after a node upgrade or config change.

## uninstall.sh

Reverses wiring; keeps config + source by default.

1. Claude Code: `claude mcp remove watush`.
2. Codex: remove `[mcp_servers.watush]` block (Node edit; back up).
3. Claude Desktop: remove `watush` key from `mcpServers` (Node edit; back up).
4. `--purge` also removes `dist/` + `node_modules/` (never `config.yaml`).

## Error handling

- Missing token / owner chatId / unknown `to` → friendly `isError` from the tool.
- Telegram API failure per recipient → captured, surfaced; fan-out continues.
- Config parse error → stderr only; tool returns friendly error.
- Server writes **only** JSON-RPC to stdout; all diagnostics → stderr.

## Git & GitHub

- `git init`, add `.gitignore` first, then `git add -A` (config.yaml excluded).
- Verify no token in tracked files (grep guard).
- `gh repo create watush-mcp --public --source . --remote origin --push`.
- MIT `LICENSE`, README with setup for all three agents.

## Testing

`node:test`, offline:

- `resolveRecipients`: owner default; me/name/tag (case-insensitive); single;
  multi fan-out; zero-match error; legacy chatId-only; env-merged recipients.
- `loadConfig`: file+env precedence; legacy shape; missing fields.
- Audit decision: owner → none; recipient → audit; `auditToOwner:false` → none.

`telegram.ts` tested via injected fake sender (offline). Manual real-send smoke
test documented in README.

## Acceptance criteria

1. `npm run build` compiles cleanly (tsc strict).
2. `npm test` passes.
3. `config.yaml` is gitignored; no token in any tracked file; repo is public.
4. After `install.sh`: `claude mcp list` shows `watush`; Codex + Desktop wired;
   backups made.
5. `send_telegram_message({text})` → owner. `{to:"partner"}` → Alice + audit.
6. Unknown `to` → helpful error, nothing sent.
7. `npm run chats` prints recent chat IDs.
8. `uninstall.sh` removes the entry from all three agents; config preserved.
