#!/usr/bin/env node
/**
 * Read-only helper: prints the chat IDs of everyone who recently DM'd your bot,
 * so you can copy the right id into config.yaml. Never writes anything.
 *
 * Usage: npm run chats   (after each person sends the bot any message)
 */

import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const token = process.env.TELEGRAM_BOT_TOKEN || cfg.botToken;
  if (!token) {
    console.error("No bot token. Set botToken in config.yaml or TELEGRAM_BOT_TOKEN.");
    process.exit(1);
  }

  let data: any;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    data = await res.json();
  } catch (e) {
    console.error("Request to Telegram failed:", (e as Error).message);
    process.exit(1);
  }

  if (!data || data.ok !== true) {
    console.error("Telegram error:", (data && data.description) || "unknown");
    process.exit(1);
  }

  const chats = new Map<number | string, any>();
  for (const u of data.result || []) {
    const m = u.message || u.edited_message || u.channel_post || u.my_chat_member;
    const chat = m && m.chat;
    if (chat) chats.set(chat.id, chat);
  }

  if (chats.size === 0) {
    console.log(
      "No recent messages found.\n" +
        "Ask each person (and yourself) to open Telegram and send the bot any message,\n" +
        "then run this again. (Telegram only keeps recent updates.)",
    );
    return;
  }

  console.log("Recent chats — copy the id into config.yaml (owner.chatId or a recipient):\n");
  for (const [id, c] of chats) {
    const name =
      [c.first_name, c.last_name].filter(Boolean).join(" ") || c.title || c.username || "";
    console.log(`  ${id}\t(${c.type}${name ? `, ${name}` : ""})`);
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
