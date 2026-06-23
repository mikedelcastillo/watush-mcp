#!/usr/bin/env node
/**
 * On-demand chat-info listener.
 *
 * Run this only when you need to capture a chat ID. While it runs, anyone can
 * DM the bot `/chatinfo` (or `/start`) and the bot replies with their chat ID;
 * every incoming message is also printed to the console. Stop it with Ctrl-C.
 *
 * This is NOT a daemon — it does not run all the time. Start it, grab the IDs
 * you need, stop it.
 *
 *   npm run chatinfo                  run until Ctrl-C
 *   npm run chatinfo -- --once        stop after the first /chatinfo reply
 *   npm run chatinfo -- --timeout=60  stop automatically after 60 seconds
 */

import { loadConfig } from "./config.js";

const POLL_SECONDS = 30; // Telegram long-poll window

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq >= 0 ? hit.slice(eq + 1) : "";
}

async function tg(token: string, method: string, params: unknown, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params ?? {}),
    signal,
  });
  return res.json();
}

function chatLabel(chat: any): { name: string; username: string } {
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.title || "";
  return { name, username: chat.username || "" };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const token = process.env.TELEGRAM_BOT_TOKEN || cfg.botToken;
  if (!token) {
    console.error("No bot token. Set botToken in config.yaml or TELEGRAM_BOT_TOKEN.");
    process.exit(1);
  }

  const once = process.argv.includes("--once");
  const timeoutArg = argValue("--timeout");
  const timeoutMs = timeoutArg ? Number(timeoutArg) * 1000 : 0;

  // Make /chatinfo discoverable in the bot's command menu (best-effort).
  try {
    await tg(token, "setMyCommands", {
      commands: [{ command: "chatinfo", description: "Show this chat's ID" }],
    });
  } catch {
    /* non-fatal */
  }

  console.log("watush listener running.");
  console.log("In Telegram, DM the bot:  /chatinfo   (or send any message).");
  console.log(once ? "Will stop after the first /chatinfo." : "Press Ctrl-C to stop.");
  if (timeoutMs) console.log(`Auto-stops in ${timeoutMs / 1000}s.`);
  console.log("");

  let running = true;
  let controller: AbortController | null = null;
  const stop = (why: string) => {
    if (!running) return;
    running = false;
    if (why) console.log(`\n${why}`);
    controller?.abort();
  };

  process.on("SIGINT", () => stop("stopping…"));
  if (timeoutMs) setTimeout(() => stop("timeout reached, stopping…"), timeoutMs).unref();

  let offset: number | undefined;
  while (running) {
    controller = new AbortController();
    let data: any;
    try {
      data = await tg(token, "getUpdates", { offset, timeout: POLL_SECONDS }, controller.signal);
    } catch (e) {
      if (!running) break; // aborted by Ctrl-C / timeout
      console.error("poll error:", (e as Error).message);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    if (!data || data.ok !== true) {
      console.error("Telegram error:", (data && data.description) || "unknown");
      if (data && data.error_code === 409) {
        console.error("Another getUpdates is running, or a webhook is set. Stop it (or delete the webhook) and retry.");
      }
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    for (const u of data.result || []) {
      offset = u.update_id + 1;
      const m = u.message || u.edited_message || u.channel_post;
      if (!m || !m.chat) continue;
      const chat = m.chat;
      const { name, username } = chatLabel(chat);
      const text: string = m.text || "";
      console.log(
        `chatId ${chat.id}  (${chat.type}${name ? `, ${name}` : ""}${username ? `, @${username}` : ""})` +
          (text ? `  "${text}"` : ""),
      );

      const cmd = text.trim().split(/\s+/)[0]?.split("@")[0]; // "/chatinfo@Bot" -> "/chatinfo"
      if (cmd === "/chatinfo" || cmd === "/start") {
        const reply = [
          "Your chat info:",
          `ID: ${chat.id}`,
          `Type: ${chat.type}`,
          name ? `Name: ${name}` : "",
          username ? `Username: @${username}` : "",
          "",
          "Give this ID to whoever set up the bot, or paste it into config.yaml.",
        ]
          .filter((l) => l !== "")
          .join("\n");
        try {
          await tg(token, "sendMessage", { chat_id: chat.id, text: reply });
        } catch (e) {
          console.error("reply failed:", (e as Error).message);
        }
        if (once) {
          stop("got /chatinfo, stopping…");
          break;
        }
      }
    }
  }

  console.log("listener stopped.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
