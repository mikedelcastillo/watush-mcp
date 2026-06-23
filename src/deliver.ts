/**
 * Delivery orchestration: resolve a "to" string, send to everyone it matches,
 * and (for non-owner recipients) send the owner an audit copy. The `send`
 * function is injected so this whole module is testable offline.
 */

import { resolveRecipients, type Config, type Recipient } from "./config.js";
import type { Sender } from "./telegram.js";

export interface SendOutcome {
  isError: boolean;
  text: string;
}

function targetLabel(target: Recipient, to: string | undefined, isOwner: boolean): string {
  if (isOwner) return "you";
  const t = (to ?? "").trim();
  if (t && t.toLowerCase() !== target.name.toLowerCase()) return `${target.name} (${t})`;
  return target.name;
}

export async function deliver(
  cfg: Config,
  to: string | undefined,
  text: string,
  send: Sender,
): Promise<SendOutcome> {
  if (!text || !text.trim()) {
    return { isError: true, text: "Message text is empty." };
  }
  if (!cfg.botToken) {
    return {
      isError: true,
      text: "No bot token configured. Set botToken in config.yaml or the TELEGRAM_BOT_TOKEN env var.",
    };
  }

  const resolution = resolveRecipients(cfg, to);
  if (resolution.kind === "unknown") {
    return {
      isError: true,
      text: `Unknown recipient "${resolution.to}". Known: ${resolution.known.join("; ")}. (Omit "to" to message yourself.)`,
    };
  }

  const ownerChatId = cfg.owner.chatId;
  const sent: string[] = [];
  const failed: string[] = [];
  let auditCount = 0;
  let auditFailed = false;

  for (const target of resolution.targets) {
    const isOwner = target === cfg.owner || (!!ownerChatId && target.chatId === ownerChatId);
    const label = targetLabel(target, to, isOwner);

    if (!target.chatId) {
      failed.push(
        isOwner
          ? "you (no owner chatId — set owner.chatId in config.yaml or TELEGRAM_CHAT_ID)"
          : `${target.name} (no chatId configured)`,
      );
      continue;
    }

    try {
      await send(cfg.botToken, target.chatId, text);
      sent.push(label);
    } catch (e) {
      failed.push(`${label} (${(e as Error).message})`);
      continue;
    }

    if (cfg.auditToOwner && !isOwner && ownerChatId) {
      try {
        await send(cfg.botToken, ownerChatId, `🔔 Audit — sent to ${target.name}: ${text}`);
        auditCount++;
      } catch {
        auditFailed = true;
      }
    }
  }

  const parts: string[] = [];
  if (sent.length) parts.push(`Sent to ${sent.join(", ")}.`);
  if (auditCount > 0) parts.push(auditCount === 1 ? "Audit copy sent to you." : "Audit copies sent to you.");
  if (auditFailed) parts.push("(audit copy failed to send)");
  if (failed.length) parts.push(`Failed: ${failed.join("; ")}.`);

  return {
    isError: failed.length > 0 || sent.length === 0,
    text: parts.join(" ") || "Nothing was sent.",
  };
}
