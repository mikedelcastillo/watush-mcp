#!/usr/bin/env bash
#
# watush-mcp uninstaller.
#
# Removes the server registration from Claude Code, Codex, and Claude Desktop.
# Your config.yaml is always left untouched. Configs are backed up before edit.
#
#   ./uninstall.sh           unregister from all agents
#   ./uninstall.sh --purge   also delete dist/ and node_modules/ (keeps config.yaml)
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="watush"
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

say()  { printf '\033[1;36m[watush]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[watush]\033[0m %s\n' "$*"; }

# Claude Code
if command -v claude >/dev/null 2>&1; then
  claude mcp remove "$NAME" >/dev/null 2>&1 || true
  claude mcp remove --scope user "$NAME" >/dev/null 2>&1 || true
  say "removed from Claude Code"
else
  warn "Claude Code CLI not found — skipped"
fi

# Codex
if [ -d "$HOME/.codex" ]; then
  if node "$REPO/scripts/edit-codex.mjs" remove "" "$NAME"; then
    say "removed from Codex"
  else
    warn "could not edit Codex config"
  fi
else
  warn "Codex (~/.codex) not found — skipped"
fi

# Claude Desktop
DESKTOP_DIR="$HOME/Library/Application Support/Claude"
if [ -d "$DESKTOP_DIR" ]; then
  if node "$REPO/scripts/edit-desktop.mjs" remove "" "$NAME"; then
    say "removed from Claude Desktop — restart the app"
  else
    warn "could not edit Claude Desktop config"
  fi
else
  warn "Claude Desktop config dir not found — skipped"
fi

if [ "$PURGE" = "1" ]; then
  rm -rf "$REPO/dist" "$REPO/node_modules"
  say "purged dist/ and node_modules/ (config.yaml kept)"
fi

say "uninstall complete. config.yaml was left untouched."
