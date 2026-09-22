import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "search-tg-test-")), "db.sqlite");
process.env.GEMINI_API_KEY = "";
process.env.HTTPS_PROXY = "";
process.env.HTTP_PROXY = "";
process.env.ALL_PROXY = "";
const { app, runSearchJob } = await import("../server.ts");
const { db } = await import("../server/db.ts");
const store = await import("../server/store.ts");
const { hashPassword, createSession } = await import("../server/auth.ts");
const { buildTxt, normalizeTelegramLink } = await import("../src/telegram-links.ts");

const nativeFetch = globalThis.fetch;
const card = (name: string) => `<div class="channel-card"><h2 class="channel-card__title"><a href="/channel/123">${name}</a></h2><ul class="channel-card__options"><li>42 subscribers</li><li>@${name}</li></ul><div class="channel-card__description">Phuket community</div></div>`;

test("durable search: live events, partial results, cancellation, retries and isolation", async () => {
  db.prepare("INSERT INTO users (id,email,password_hash,role,must_change_password) VALUES (1,?,?, 'owner',0)").run("owner@test.local", await hashPassword("long-test-password"));
  db.prepare("INSERT INTO users (id,email,password_hash,role,must_change_password) VALUES (2,?,?, 'user',0)").run("user@test.local", await hashPassword("long-test-password"));
  let cookie = "";
  await createSession({ cookie(name: string, value: string) { cookie = `${name}=${value}`; } } as any, { id: 1, email: "owner@test.local", role: "owner", mustChangePassword: false });
  const http = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => http.once("listening", resolve));
  const base = `http://127.0.0.1:${(http.address() as any).port}`;
  let releasePage: () => void = () => {};
  let secondRequested: () => void = () => {};
  const secondPage = new Promise<void>(resolve => { secondRequested = resolve; });
  const gate = new Promise<void>(resolve => { releasePage = resolve; });
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return nativeFetch(input, options);
    if (url.pathname.startsWith("/channel/")) return new Response('<a href="tg://resolve?domain=phuket_test">Open</a>');
    if (url.searchParams.get("page") === "2") { secondRequested(); await gate; return new Response(card("phuket_other")); }
    return new Response(card("phuket_test"));
  };
  try {
    const started = Date.now();
    const first = await nativeFetch(base + "/api/search", { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ query: "phuket", source: "tgsearch", limitPages: 2, requestId: "proof" }) });
    assert.equal(first.status, 202);
    assert.ok(Date.now() - started < 1500);
    const { searchId } = await first.json() as any;
    await Promise.race([secondPage, new Promise((_,rej)=>setTimeout(()=>rej(new Error("secondPage timeout")), 5000))]);
    const live = await nativeFetch(base + `/api/searches/${searchId}/status`, { headers: { cookie } }).then(r => r.json()) as any;
    assert.equal(live.status, "running");
    assert.ok(String(live.currentSource||"").includes("tgsearch"));
    assert.ok(live.logs.some((line: string) => line.includes("[Page]")));
    assert.ok(live.logs.some((line: string) => line.includes("[Saved]")));
    assert.ok(live.logs.every((line: string) => /^\[\d{4}-/.test(line)));
    const duplicate = await nativeFetch(base + "/api/search", { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ query: "phuket", source: "tgsearch", limitPages: 2, requestId: "proof" }) }).then(r => r.json()) as any;
    assert.equal(duplicate.searchId, searchId);
    assert.equal(store.getSearchStatus(2, Number(searchId)), null);
    assert.equal(store.requestSearchCancel(2, Number(searchId)), false);
    assert.equal(store.deleteSearch(1, Number(searchId)), false);
    store.requestSearchCancel(1, Number(searchId));
    releasePage();
    // Wait on completion event via database state with a bounded test-only assertion loop.
    for (let i = 0; i < 100 && store.getSearchStatus(1, Number(searchId))?.status === "running"; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal(store.getSearchStatus(1, Number(searchId))?.status, "cancelled");
    assert.ok(store.getSearch(1, Number(searchId))!.results.length >= 1);
    let attempts = 0;
    globalThis.fetch = async () => { attempts++; throw new Error("fixture offline"); };
    const failedId = store.createSearch(1, { query: "test", source: "waybien", mode: "fast", limitPages: 500 });
    store.claimSearch(failedId);
    await runSearchJob(1, failedId, { query: "test", source: "waybien", mode: "fast", limitPages: 500 });
    assert.equal(attempts, 1);
    assert.equal(store.getSearchStatus(1, failedId)?.status, "failed");
    assert.equal(store.getSearchStatus(1, failedId)?.searchStats.waybien.status, "failed");
    const queries: string[] = [];
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/channel/")) return new Response('<a href="tg://resolve?domain=phuket_test">Open</a>');
      queries.push(url.searchParams.get("query") || "");
      return new Response(card("phuket_test"));
    };
    const multiId = store.createSearch(1, { query: "phuket, thailand", source: "tgsearch", mode: "fast", limitPages: 1 });
    store.claimSearch(multiId);
    await runSearchJob(1, multiId, { query: "phuket, thailand", source: "tgsearch", mode: "fast", limitPages: 1 });
    assert.deepEqual(queries, ["phuket", "thailand"]);
    assert.equal(store.getSearch(1, multiId)!.results.length, 1);
    db.prepare("UPDATE searches SET status = 'queued' WHERE id = ?").run(multiId);
    store.claimSearch(multiId);
    await runSearchJob(1, multiId, { query: "phuket, thailand", source: "tgsearch", mode: "fast", limitPages: 1 });
    assert.equal(queries.length, 2, "completed sources must not run again after recovery");
    assert.equal(store.getSearchStatus(1, multiId)?.progress, 100);
  } finally {
    releasePage(); globalThis.fetch = nativeFetch;
    await new Promise<void>(resolve => http.close(() => resolve()));
  }
});

test("TXT normalizes protocols, deduplicates usernames and preserves invite case", () => {
  assert.equal(normalizeTelegramLink("tg://resolve?domain=Phuket_test"), "https://t.me/phuket_test");
  assert.equal(normalizeTelegramLink("https://t.me/+AbCd_123"), "https://t.me/+AbCd_123");
  assert.equal(normalizeTelegramLink("https://evil.test/t.me/phuket"), null);
  const row: any = { title: "Phuket", source: "test", detailUrl: "https://catalog.test/x", telegramUrl: "tg://resolve?domain=Phuket_test", extractionStatus: "success" };
  const text = buildTxt([row, { ...row, telegramUrl: "https://t.me/phuket_test" }, { ...row, telegramUrl: "https://t.me/guessed", extractionStatus: "guessed" }]);
  assert.equal(text, "https://t.me/phuket_test\n");
  assert.match(buildTxt([row], true), /Название: Phuket/);
});
