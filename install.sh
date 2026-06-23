#!/usr/bin/env bash
#
# watush-mcp installer.
#
# Builds the TypeScript, ensures config.yaml exists, and registers the server
# with every agent it can find: Claude Code, Codex, and Claude Desktop. So once
# any of them runs (i.e. after you log in and open them), the server is
# available on demand. Stdio MCP servers have no resident process to "start on
# login" — registration is what makes them always available.
#
# Idempotent and safe: existing configs are backed up before editing, and
# agents that aren't installed are skipped. Re-run after a node upgrade.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$REPO/bin/watush-mcp-server"
NAME="watush"

say()  { printf '\033[1;36m[watush]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[watush]\033[0m %s\n' "$*"; }

# 1. Preflight
command -v node >/dev/null 2>&1 || { echo "Node.js (>=18) is required but 'node' was not found."; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "npm is required but was not found."; exit 1; }
say "using node $(node -v), npm $(npm -v)"

# 2. Build
say "installing dependencies…"
( cd "$REPO" && npm install --silent )
say "compiling TypeScript…"
( cd "$REPO" && npm run build --silent )

# 3. Config
if [ ! -f "$REPO/config.yaml" ]; then
  cp "$REPO/config.example.yaml" "$REPO/config.yaml"
  say "created config.yaml from the example — you'll edit it below"
fi
chmod 600 "$REPO/config.yaml" 2>/dev/null || true

# 4. Launcher
chmod +x "$LAUNCHER"

# 5. Claude Code
if command -v claude >/dev/null 2>&1; then
  claude mcp remove "$NAME" >/dev/null 2>&1 || true
  claude mcp remove --scope user "$NAME" >/dev/null 2>&1 || true
  if claude mcp add --scope user "$NAME" -- "$LAUNCHER" >/dev/null 2>&1; then
    say "wired Claude Code (user scope)"
  else
    warn "could not wire Claude Code automatically. Run: claude mcp add --scope user $NAME -- \"$LAUNCHER\""
  fi
else
  warn "Claude Code CLI ('claude') not found — skipped"
fi

# 6. Codex
if [ -d "$HOME/.codex" ]; then
  if node "$REPO/scripts/edit-codex.mjs" add "$LAUNCHER" "$NAME"; then
    say "wired Codex (~/.codex/config.toml)"
  else
    warn "could not wire Codex automatically"
  fi
else
  warn "Codex (~/.codex) not found — skipped"
fi

# 7. Claude Desktop
DESKTOP_DIR="$HOME/Library/Application Support/Claude"
if [ -d "$DESKTOP_DIR" ]; then
  if node "$REPO/scripts/edit-desktop.mjs" add "$LAUNCHER" "$NAME"; then
    say "wired Claude Desktop — restart the app to load it"
  else
    warn "could not wire Claude Desktop automatically"
  fi
else
  warn "Claude Desktop config dir not found — skipped"
fi

say "install complete."
echo
echo "Next steps:"
echo "  1. Edit $REPO/config.yaml:"
echo "       - owner.chatId  = your numeric Telegram user ID"
echo "       - recipients    = people you want to message (name, chatId, tags)"
echo "     Find chat IDs of anyone who has DM'd the bot:  npm run chats"
echo "  2. Restart Claude Desktop if you use it."
echo "  3. Try it — ask any agent:  \"message me on telegram: hello from watush\""
