#!/usr/bin/env node
/**
 * watush-mcp — a send-only Telegram MCP server (stdio transport).
 *
 * Tools:
 *   - send_telegram_message({ text, to? })  message yourself or a named/tagged person
 *   - list_recipients()                     discover who/what tags you can address
 *
 * stdout is the JSON-RPC channel; all logging goes to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { deliver } from "./deliver.js";
import { sendTelegram } from "./telegram.js";

function log(msg: string): void {
  process.stderr.write(`[watush-mcp] ${msg}\n`);
}

const server = new McpServer({ name: "watush", version: "1.0.0" });

server.registerTool(
  "send_telegram_message",
  {
    title: "Send Telegram message",
    description:
      "Send a Telegram message to the user (yourself) or to a named/tagged person such as a partner, family member, or friend. " +
      "Use whenever the user asks to be messaged, pinged, notified, texted, or alerted on Telegram, or to message someone like " +
      "a partner or a named contact, or to deliver a result/reminder. Omit 'to' (or use 'me') to message the user themselves. " +
      "The user (owner) always receives an audit copy of messages sent to other people.",
    inputSchema: {
      text: z.string().min(1).describe("The message text to send."),
      to: z
        .string()
        .optional()
        .describe(
          "Who to send to: a person's name (e.g. 'Alex') or a tag (e.g. 'partner', 'friend', 'family'). " +
            "Omit or use 'me' to message the user (owner). Call list_recipients to see valid names and tags.",
        ),
    },
  },
  async ({ text, to }) => {
    try {
      const cfg = loadConfig();
      const outcome = await deliver(cfg, to, text, sendTelegram);
      return { content: [{ type: "text", text: outcome.text }], isError: outcome.isError };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Failed to send: ${(e as Error).message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "list_recipients",
  {
    title: "List Telegram recipients",
    description:
      "List who can be messaged on Telegram: the owner (you) and configured recipients with their names and tags. " +
      "Use this to map a phrase like 'my partner' to a valid 'to' value for send_telegram_message. Chat IDs are never returned.",
    inputSchema: {},
  },
  async () => {
    try {
      const cfg = loadConfig();
      const ownerTags = cfg.owner.tags.length ? ` [${cfg.owner.tags.join(", ")}]` : "";
      const lines = [`you (owner): ${cfg.owner.name}${ownerTags} — address as "me"`];
      for (const r of cfg.recipients) {
        lines.push(`${r.name}${r.tags.length ? ` [${r.tags.join(", ")}]` : ""}`);
      }
      const text = cfg.recipients.length
        ? `Recipients you can message:\n${lines.join("\n")}`
        : `Only the owner (you) is configured: ${cfg.owner.name}. Add people under "recipients" in config.yaml.`;
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Failed to list recipients: ${(e as Error).message}` }],
        isError: true,
      };
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("server started (stdio)");
}

main().catch((e) => {
  log(`fatal: ${(e as Error).message}`);
  process.exit(1);
});
