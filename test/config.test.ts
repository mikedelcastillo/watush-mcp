import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, resolveRecipients, type Config } from "../src/config.js";
import { deliver } from "../src/deliver.js";

const NO_ENV = {} as NodeJS.ProcessEnv;

function sampleConfig(overrides: Record<string, unknown> = {}): Config {
  return parseConfig(
    {
      botToken: "TOKEN",
      owner: { name: "Owner", chatId: "1" },
      recipients: [
        { name: "Alice", chatId: "2", tags: ["partner", "household"] },
        { name: "Bob", chatId: "3", tags: ["friend", "family"] },
        { name: "Carol", chatId: "4", tags: ["family"] },
      ],
      auditToOwner: true,
      ...overrides,
    },
    NO_ENV,
  );
}

function fakeSender(failOn: string[] = []) {
  const calls: Array<{ chatId: string; text: string }> = [];
  const send = async (_token: string, chatId: string, text: string) => {
    if (failOn.includes(chatId)) throw new Error("boom");
    calls.push({ chatId, text });
  };
  return { calls, send };
}

// ---------- parseConfig ----------

test("parseConfig: legacy top-level chatId becomes the owner", () => {
  const cfg = parseConfig({ botToken: "T", chatId: "999" }, NO_ENV);
  assert.equal(cfg.owner.chatId, "999");
  assert.equal(cfg.owner.name, "You");
  assert.deepEqual(cfg.recipients, []);
  assert.equal(cfg.auditToOwner, true);
});

test("parseConfig: env overrides token and owner chatId", () => {
  const cfg = parseConfig(
    { botToken: "fileTok", owner: { name: "Owner", chatId: "1" } },
    { TELEGRAM_BOT_TOKEN: "envTok", TELEGRAM_CHAT_ID: "777" } as NodeJS.ProcessEnv,
  );
  assert.equal(cfg.botToken, "envTok");
  assert.equal(cfg.owner.chatId, "777");
});

test("parseConfig: numeric chatIds are coerced to strings; tags normalized", () => {
  const cfg = parseConfig(
    { botToken: "T", owner: { name: "O", chatId: 1 }, recipients: [{ name: "Alice", chatId: 2, tags: ["Partner", " Household "] }] },
    NO_ENV,
  );
  assert.equal(cfg.owner.chatId, "1");
  assert.equal(cfg.recipients[0]!.chatId, "2");
  assert.deepEqual(cfg.recipients[0]!.tags, ["Partner", "Household"]);
});

test("parseConfig: TELEGRAM_RECIPIENTS env merges and overrides by name", () => {
  const cfg = parseConfig(
    { botToken: "T", owner: { chatId: "1" }, recipients: [{ name: "Alice", chatId: "2", tags: ["partner"] }] },
    { TELEGRAM_RECIPIENTS: JSON.stringify([{ name: "Alice", chatId: "22", tags: ["spouse"] }, { name: "Boss", chatId: "5", tags: ["work"] }]) } as NodeJS.ProcessEnv,
  );
  const alice = cfg.recipients.find((r) => r.name === "Alice")!;
  assert.equal(alice.chatId, "22");
  assert.deepEqual(alice.tags, ["spouse"]);
  assert.ok(cfg.recipients.some((r) => r.name === "Boss"));
});

test("parseConfig: untouched PASTE_ placeholders are treated as unset", () => {
  const cfg = parseConfig(
    {
      botToken: "PASTE_BOT_TOKEN_HERE",
      owner: { name: "Owner", chatId: "PASTE_YOUR_CHAT_ID_HERE" },
      recipients: [{ name: "Alice", chatId: "PASTE_ALICE_CHAT_ID", tags: ["partner"] }],
    },
    NO_ENV,
  );
  assert.equal(cfg.botToken, "");
  assert.equal(cfg.owner.chatId, "");
  assert.equal(cfg.recipients[0]!.chatId, "");
  // a real id that merely contains digits/letters is NOT stripped
  assert.equal(parseConfig({ botToken: "T", owner: { chatId: "123:abc" } }, NO_ENV).owner.chatId, "123:abc");
});

test("parseConfig: auditToOwner defaults true, respects false", () => {
  assert.equal(parseConfig({ botToken: "T" }, NO_ENV).auditToOwner, true);
  assert.equal(parseConfig({ botToken: "T", auditToOwner: false }, NO_ENV).auditToOwner, false);
  assert.equal(parseConfig({ botToken: "T" }, { WATUSH_AUDIT: "false" } as NodeJS.ProcessEnv).auditToOwner, false);
});

// ---------- resolveRecipients ----------

test("resolve: omitted/me/owner-name all map to owner", () => {
  const cfg = sampleConfig();
  for (const to of [undefined, "", "me", "myself", "owner", "Owner"]) {
    const r = resolveRecipients(cfg, to);
    assert.equal(r.kind, "ok");
    assert.deepEqual((r as any).targets, [cfg.owner]);
  }
});

test("resolve: by name and by tag, case-insensitive", () => {
  const cfg = sampleConfig();
  assert.deepEqual((resolveRecipients(cfg, "alice") as any).targets[0].name, "Alice");
  assert.deepEqual((resolveRecipients(cfg, "PARTNER") as any).targets[0].name, "Alice");
  assert.deepEqual((resolveRecipients(cfg, "  household ") as any).targets[0].name, "Alice");
});

test("resolve: shared tag fans out to multiple recipients", () => {
  const cfg = sampleConfig();
  const r = resolveRecipients(cfg, "family");
  assert.equal(r.kind, "ok");
  const names = (r as any).targets.map((t: any) => t.name).sort();
  assert.deepEqual(names, ["Bob", "Carol"]);
});

test("resolve: unknown recipient returns kind=unknown with known list", () => {
  const cfg = sampleConfig();
  const r = resolveRecipients(cfg, "nobody");
  assert.equal(r.kind, "unknown");
  assert.equal((r as any).to, "nobody");
  assert.ok((r as any).known.length >= 1);
});

test("resolve: owner can be addressed by an owner tag", () => {
  const cfg = sampleConfig({ owner: { name: "Owner", chatId: "1", tags: ["boss"] } });
  const r = resolveRecipients(cfg, "boss");
  assert.deepEqual((r as any).targets, [cfg.owner]);
});

// ---------- deliver ----------

test("deliver: to owner sends once, no audit", async () => {
  const cfg = sampleConfig();
  const { calls, send } = fakeSender();
  const out = await deliver(cfg, undefined, "done", send);
  assert.equal(out.isError, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { chatId: "1", text: "done" });
  assert.match(out.text, /Sent to you\./);
});

test("deliver: to partner sends to Alice + audit to owner", async () => {
  const cfg = sampleConfig();
  const { calls, send } = fakeSender();
  const out = await deliver(cfg, "partner", "dinner?", send);
  assert.equal(out.isError, false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { chatId: "2", text: "dinner?" });
  assert.equal(calls[1]!.chatId, "1");
  assert.match(calls[1]!.text, /Audit/);
  assert.match(out.text, /Sent to Alice \(partner\)\. Audit copy sent to you\./);
});

test("deliver: auditToOwner=false suppresses audit", async () => {
  const cfg = sampleConfig({ auditToOwner: false });
  const { calls, send } = fakeSender();
  const out = await deliver(cfg, "partner", "hi", send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.chatId, "2");
  assert.doesNotMatch(out.text, /Audit/);
});

test("deliver: fan-out to family sends to both + audits both", async () => {
  const cfg = sampleConfig();
  const { calls, send } = fakeSender();
  const out = await deliver(cfg, "family", "reunion", send);
  assert.equal(out.isError, false);
  // 2 recipients + 2 audits
  assert.equal(calls.length, 4);
  assert.match(out.text, /Audit copies sent to you\./);
});

test("deliver: partial failure is reported and flagged isError", async () => {
  const cfg = sampleConfig();
  const { calls, send } = fakeSender(["3"]); // Bob (chatId 3) fails
  const out = await deliver(cfg, "family", "reunion", send);
  assert.equal(out.isError, true);
  assert.match(out.text, /Failed: Bob/);
  // Carol send + Carol audit succeed = 2 calls; Bob failed before send recorded
  assert.equal(calls.length, 2);
});

test("deliver: unknown recipient sends nothing, returns error", async () => {
  const cfg = sampleConfig();
  const { calls, send } = fakeSender();
  const out = await deliver(cfg, "stranger", "hi", send);
  assert.equal(out.isError, true);
  assert.equal(calls.length, 0);
  assert.match(out.text, /Unknown recipient "stranger"/);
});

test("deliver: missing bot token errors before sending", async () => {
  const cfg = parseConfig({ owner: { chatId: "1" } }, NO_ENV);
  const { calls, send } = fakeSender();
  const out = await deliver(cfg, undefined, "hi", send);
  assert.equal(out.isError, true);
  assert.equal(calls.length, 0);
  assert.match(out.text, /No bot token/);
});

test("deliver: owner with no chatId gives a helpful error", async () => {
  const cfg = parseConfig({ botToken: "T", owner: { name: "Owner" } }, NO_ENV);
  const { calls, send } = fakeSender();
  const out = await deliver(cfg, undefined, "hi", send);
  assert.equal(out.isError, true);
  assert.equal(calls.length, 0);
  assert.match(out.text, /no owner chatId/);
});

test("deliver: empty text errors", async () => {
  const cfg = sampleConfig();
  const { calls, send } = fakeSender();
  const out = await deliver(cfg, undefined, "   ", send);
  assert.equal(out.isError, true);
  assert.equal(calls.length, 0);
});
