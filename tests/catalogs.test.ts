import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTgCat, parseCatalogTelegram, parseTglibSearch, extractTglibLink, fetchCatalogPage } from "../server/catalog-sources.ts";

test("TG-Cat excludes ads/bots and preserves invite hashes and types", () => {
  const parsed = parseTgCat(JSON.stringify({ count: 500, results: [
    { type: "ad", title: "Ad", link: "https://t.me/advert" },
    { type: "bot", title: "Bot", link: "https://t.me/test_bot" },
    { type: "supergroup", title: "Chat", link: "https://t.me/Chat_test", subscribers: 0 },
    { type: "channel", title: "Channel", link: "https://t.me/+AbCd_123" },
  ] }));
  assert.equal(parsed.results.length, 2);
  assert.equal(parsed.reported, 500);
  assert.equal(parsed.results[0].chatType, "group");
  assert.equal(parsed.results[0].subscribers, "0");
  assert.equal(parsed.results[1].telegramUrl, "https://t.me/+AbCd_123");
});

test("Catalog Telegram scopes cards and stops at last page", () => {
  const html = `<a href="https://t.me/support_bot">Support</a><div class="col-span-1"><h2><a href="https://catalog-telegram.site/catalog/jobs/test">Test</a></h2><div class="h-32">Description</div><a href="https://catalog-telegram.site/catalog/redirect/to/1">Open</a></div><button wire:click="gotoPage(3, 'page')">3</button>`;
  assert.equal(parseCatalogTelegram(html, 1).candidates.length, 1);
  assert.equal(parseCatalogTelegram(html, 3).hasMore, false);
  assert.equal(parseCatalogTelegram("Ничего не найдено", 1).candidates.length, 0);
  assert.throws(() => parseCatalogTelegram("<html>Shell</html>", 1));
});

test("TGLib restricts search to detail URLs and community buttons", () => {
  const html = `<div class="b-serp-item"><a class="b-serp-item__title-link" href="https://tglib.net/ru/channels/123">Channel</a></div><div class="b-serp-item"><a class="b-serp-item__title-link" href="https://evil.test/ru/channels/123">Not a result</a></div><div class="b-pager"><a href="/search/site/?p=1">2</a></div>`;
  assert.equal(parseTglibSearch(html, 1).results.length, 1);
  assert.equal(parseTglibSearch(html, 1).hasMore, true);
  assert.equal(parseTglibSearch(html, 2).hasMore, false);
  assert.equal(extractTglibLink('<a href="https://t.me/support">Support</a><a class="button is-success" href="https://t.me/channel_test">Посмотреть канал</a>'), "https://t.me/channel_test");
  assert.throws(() => parseTglibSearch("CAPTCHA", 1));
});

test("Catalog redirect resolves tg:// without fetching Telegram or arbitrary hosts", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); urls.push(url);
    if (url.includes('/redirect/')) return new Response(null, { status: 302, headers: { location: 'tg://resolve?domain=Test_channel' } });
    return new Response('<div class="col-span-1"><h2><a href="https://catalog-telegram.site/catalog/jobs/test">Test</a></h2><a href="https://catalog-telegram.site/catalog/redirect/to/1">Open</a></div>');
  };
  try {
    const result = await fetchCatalogPage("catalogTelegram", "test", 1);
    assert.equal(result.results[0].telegramUrl, "https://t.me/test_channel");
    assert.equal(urls.length, 2);
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    await assert.rejects(fetchCatalogPage("catalogTelegram", "test", 1), /Unexpected catalog redirect/);
    globalThis.fetch = async () => new Response("<title>Just a moment...</title>");
    await assert.rejects(fetchCatalogPage("tglib", "test", 1), /CAPTCHA/);
  } finally { globalThis.fetch = original; }
});

test("isBotTarget detects bot links and usernames while preserving regular channels and groups", async () => {
  const { isBotTarget } = await import("../server/store.js");
  assert.equal(isBotTarget("https://t.me/beelinebusiness_bot"), true);
  assert.equal(isBotTarget("https://t.me/chat4bizbot"), true);
  assert.equal(isBotTarget("https://t.me/my_test_bot"), true);
  assert.equal(isBotTarget(null, "some_support_bot"), true);
  assert.equal(isBotTarget(null, "chatgptbot"), true);
  assert.equal(isBotTarget(null, null, "Telegram: Contact @sample_bot"), true);
  assert.equal(isBotTarget(null, null, null, "bot"), true);

  // Legitimate channels & groups must NOT be classified as bots
  assert.equal(isBotTarget("https://t.me/phuketchatru"), false);
  assert.equal(isBotTarget("https://t.me/robotics_daily"), false);
  assert.equal(isBotTarget("https://t.me/+joinchat_hash"), false);
  assert.equal(isBotTarget("https://t.me/bottles_business"), false);
  assert.equal(isBotTarget(null, "bottom_line"), false);
});

