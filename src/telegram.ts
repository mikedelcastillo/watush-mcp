/**
 * Thin Telegram Bot API client. Send-only.
 *
 * Uses the global `fetch` (Node 18+). Throws a descriptive Error on any API or
 * network failure so callers can surface it. The matching `Sender` type lets
 * tests inject a fake and stay fully offline.
 */

export type Sender = (token: string, chatId: string, text: string) => Promise<void>;

export const sendTelegram: Sender = async (token, chatId, text) => {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch (e) {
    throw new Error(`network error reaching Telegram: ${(e as Error).message}`);
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Telegram returned a non-JSON response (HTTP ${res.status})`);
  }

  if (!data || data.ok !== true) {
    const desc = (data && (data.description as string)) || `HTTP ${res.status}`;
    throw new Error(desc);
  }
};
