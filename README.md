# watush-mcp

A robust, **send-only** Telegram [MCP](https://modelcontextprotocol.io) server.
Any agent — **Claude Code**, **Claude Desktop**, or **Codex** — can use it to
message **you** or **named people** (partner, family, friends) through your own
Telegram bot.

So you can say:

> "message me on telegram once the build is done"
> "message my partner in 30 minutes: running late"
> "ping the family: dinner at 7"

…and it routes to the right person. You (the **owner**) always get an **audit
copy** of anything sent to someone else.

It's send-only by design: it can deliver messages, but it **cannot read your
chats**.

---

## How it works

- **Two tools** are exposed to the agent:
  - `send_telegram_message({ text, to? })` — send a message. `to` is a person's
    **name** or a **tag** (case-insensitive). Omit `to` (or use `"me"`) to
    message yourself. A tag shared by several people fans out to all of them.
  - `list_recipients()` — lets the agent discover who/what tags it can address
    (names + tags only; chat IDs are never exposed).
- **Timing is the agent's job.** "in 30 minutes" is handled by the agent that
  calls the tool; the tool itself always sends *now*.
- **No background process.** Stdio MCP servers are spawned on demand by each
  client, so there's nothing to "start on login" — installing simply registers
  the server with your agents so it's available whenever they run.

---

## Setup

### 1. Install (build + wire all agents)

```bash
cd ~/Code/watush-mcp
./install.sh
```

This installs dependencies, compiles the TypeScript, creates `config.yaml` (if
missing), and registers the server with Claude Code, Codex, and Claude Desktop —
whichever are present. Existing agent configs are backed up first. Re-run it any
time (e.g. after a Node version change).

### 2. Configure `config.yaml`

`config.yaml` holds your secrets and is **git-ignored** — it is never committed.
Copy the example if you don't have one yet:

```bash
cp config.example.yaml config.yaml && chmod 600 config.yaml
```

```yaml
botToken: "123456789:ABC..."        # from @BotFather
owner:
  name: "Owner"
  chatId: "111111"                  # your numeric Telegram ID (gets audit copies)
recipients:
  - name: "Alice"
    chatId: "222222"
    tags: ["partner", "household"]
  - name: "Bob"
    chatId: "333333"
    tags: ["friend", "team"]
auditToOwner: true
```

### 3. Find chat IDs

Everyone you want to message (including you) must DM the bot once. You have two
ways to capture their numeric IDs — neither runs in the background:

**a) On-demand `/chatinfo` listener (recommended)**

```bash
npm run chatinfo
```

This starts a temporary listener. Each person DMs the bot **`/chatinfo`** and the
bot replies to them with their own chat ID (it's also printed in your terminal).
Press **Ctrl-C** when you're done — it does not keep running.

```bash
npm run chatinfo -- --once         # auto-stop after the first /chatinfo
npm run chatinfo -- --timeout=60   # auto-stop after 60 seconds
```

**b) One-shot snapshot**

```bash
npm run chats
```

Prints the chat ID + name of everyone who recently messaged the bot. (Reads
only — never writes your config.)

Copy the right IDs into `config.yaml`.

### 4. Restart Claude Desktop

If you use Claude Desktop, restart it so it loads the new server. Claude Code and
Codex pick it up on their next run.

---

## Usage

Just ask, in any agent:

> "message me on telegram: deploy finished ✅"
> "text my partner: leaving now"
> "notify the family: flight landed"

Behind the scenes the agent calls `send_telegram_message`. Messages to anyone
other than you also send you an audit copy like:

```
🔔 Audit — sent to Alice: leaving now
```

---

## Configuration reference

| Key                 | Meaning                                                        |
| ------------------- | ------------------------------------------------------------- |
| `botToken`          | Telegram bot token from @BotFather.                            |
| `owner.name`        | Your display name.                                             |
| `owner.chatId`      | Your numeric Telegram ID. Receives audit copies.              |
| `recipients[].name` | A person's name (addressable as `to`).                         |
| `recipients[].chatId` | Their numeric Telegram ID.                                   |
| `recipients[].tags` | Aliases like `partner`, `family` (addressable as `to`).       |
| `auditToOwner`      | `true` (default) to copy the owner on messages to others.    |

**Environment overrides** (handy for CI / secrets managers):
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (owner), `TELEGRAM_RECIPIENTS` (a JSON
array of recipients, merged over the file), and `WATUSH_CONFIG` (alternate config
path).

---

## Resolving `to`

| You say…                  | `to`            | Goes to                         |
| ------------------------- | --------------- | ------------------------------- |
| "message me"              | *(omitted)*     | owner (you)                     |
| "message Alice"           | `Alice`         | Alice                           |
| "message my partner"      | `partner`       | whoever is tagged `partner`     |
| "message the family"      | `family`        | everyone tagged `family`        |
| "message Dana" (unknown)  | `Dana`          | nothing — returns a helpful error listing known names/tags |

---

## Uninstall

```bash
./uninstall.sh           # unregister from all agents (keeps config.yaml)
./uninstall.sh --purge   # also remove dist/ and node_modules/
```

---

## Security

- `config.yaml` is git-ignored and `chmod 600`. The token and chat IDs never
  leave your machine and are never committed.
- Send-only: the server has no tool to read messages or list your chats.
- If your token ever leaks, rotate it in @BotFather (`/revoke`) and paste the new
  one into `config.yaml`.

---

## Development

```bash
npm install
npm run build      # tsc -> dist/
npm test           # offline unit tests (resolution, config, audit logic)
npm start          # run the MCP server over stdio
```

Project layout:

```
src/config.ts       load YAML config + resolve recipients (pure, tested)
src/telegram.ts     Telegram Bot API client (send-only)
src/deliver.ts      resolve + send + audit orchestration (pure, tested)
src/mcp-server.ts   the MCP server (two tools)
src/list-chats.ts   read-only "npm run chats" helper
src/listen.ts       on-demand "npm run chatinfo" listener
bin/watush-mcp-server  launcher that resolves node for GUI apps / nvm
scripts/            config editors used by install/uninstall
```

MIT licensed.
