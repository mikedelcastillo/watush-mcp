@echo off
REM watush-mcp launcher (Windows). Runs the stdio MCP server via node.
REM Agents (Claude Code, Codex) point at this file; node must be on PATH.
node "%~dp0..\dist\src\mcp-server.js" %*
