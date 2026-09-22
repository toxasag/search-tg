import * as cheerio from "cheerio";
import { normalizeTelegramLink } from "../src/telegram-links.js";
import { checkSearchCancelled, logSearch, searchContext } from "./search-context.js";
import type { StoredChannelInput } from "./store.js";

export const EXTRA_CATALOGS = ["tgcat", "catalogTelegram", "tglib"];
const hosts = new Set(["api.tg-cat.com", "catalog-telegram.site", "tglib.net", "yandex.ru"]);
const headers = { "User-Agent": "Mozilla/5.0", Accept: "text/html,application/json" };

async function request(url: string): Promise<{ body: string; telegramUrl?: string }> {
  for (let redirects = 0; redirects < 4; redirects++) {
    checkSearchCancelled();
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !hosts.has(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw new Error("Unexpected catalog redirect host");
    logSearch(`[Fetch] ${parsed.hostname}${parsed.pathname}; timeout 15s`);
    const jobSignal = searchContext.getStore()?.signal;
    const timeout = AbortSignal.timeout(15000);
    const response = await fetch(url, { headers, redirect: "manual", signal: jobSignal ? AbortSignal.any([jobSignal, timeout]) : timeout });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Catalog redirect has no Location");
      const next = new URL(location, url).href;
      const telegramUrl = normalizeTelegramLink(next);
      if (telegramUrl) return { body: "", telegramUrl };
      url = next;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Catalog HTTP ${response.status}`); }
    const body = await response.text();
    logSearch(`[Fetch] HTTP ${response.status}; ${body.length} characters`);
    if (/showcaptcha|captcha-container|SmartCaptcha|Checking your browser|Just a moment\.\.\./i.test(body)) throw new Error("Catalog blocked by CAPTCHA/challenge; no bypass attempted");
    return { body };
  }
  throw new Error("Too many catalog redirects");
}

export function parseTgCat(body: string): { results: StoredChannelInput[]; reported: number } {
  const data = JSON.parse(body);
  if (!Array.isArray(data.results)) throw new Error("TG-Cat response format changed");
  return { reported: Number(data.count || 0), results: data.results.flatMap((item: any) => {
    const telegramUrl = normalizeTelegramLink(item.link);
    if (!["channel", "supergroup", "group"].includes(item.type) || !telegramUrl || typeof item.title !== "string") return [];
    return [{ title: item.title, description: item.orig_description || item.description || "", source: "tgcat",
      detailUrl: telegramUrl, telegramUrl, subscribers: item.subscribers == null ? null : String(item.subscribers),
      extractionStatus: "success", chatType: item.type === "channel" ? "channel" : "group" }];
  }) };
}

export function parseCatalogTelegram(body: string, page: number) {
  const $ = cheerio.load(body);
  const candidates: { item: StoredChannelInput; redirect: string }[] = [];
  $('a[href*="/catalog/redirect/to/"]').each((_, element) => {
    const card = $(element).closest("div.col-span-1");
    const titleLink = card.find("h2 a").first();
    const detailUrl = titleLink.attr("href");
    const title = titleLink.text().trim();
    const redirect = $(element).attr("href");
    if (!title || !detailUrl || !redirect || candidates.some(c => c.item.detailUrl === detailUrl)) return;
    candidates.push({ redirect, item: { title, detailUrl, description: card.find('div.h-32').text().trim(),
      source: "catalogTelegram", imageUrl: card.find("img").attr("src") || null,
      extractionStatus: "pending", chatType: "unknown" } });
  });
  const lastPage = Math.max(1, ...[...body.matchAll(/gotoPage\((\d+)/g)].map(m => Number(m[1])));
  if (!candidates.length && !/ничего не найдено|найдено\s*:?\s*0|результат[^<]*0/i.test($.text())) throw new Error("Catalog Telegram: no recognizable result cards (markup changed or blocked)");
  return { candidates, hasMore: page < lastPage };
}

export function parseTglibSearch(body: string, page: number) {
  const $ = cheerio.load(body);
  const results: StoredChannelInput[] = [];
  $(".b-serp-item").each((_, el) => {
    const link = $(el).find("a.b-serp-item__title-link").first();
    const href = link.attr("href") || "";
    if (!/^https:\/\/tglib\.net\/(?:ru|en)\/(?:channels|groups)\/\d+(?:\/)?$/.test(href)) return;
    if (results.some(r => r.detailUrl === href)) return;
    results.push({ title: link.text().trim(), detailUrl: href, source: "tglib",
      description: $(el).find(".b-serp-item__text").text().trim(), extractionStatus: "pending",
      chatType: href.includes("/groups/") ? "group" : "channel" });
  });
  if (!results.length && !/ничего не найдено|ничего не нашли|no results/i.test($.text())) throw new Error("TGLib search unavailable: no recognized Yandex site-search results");
  const hasMore = $(".b-pager a").toArray().some(a => {
    try { return Number(new URL($(a).attr("href") || "", "https://yandex.ru").searchParams.get("p")) >= page; }
    catch { return false; }
  });
  return { results, hasMore };
}

export function extractTglibLink(body: string) {
  const $ = cheerio.load(body);
  return normalizeTelegramLink($("a.button.is-success").filter((_, a) => /Посмотреть|View|Open/i.test($(a).text())).first().attr("href"));
}

export async function fetchCatalogPage(source: string, query: string, page: number): Promise<{ results: StoredChannelInput[]; hasMore: boolean }> {
  if (source === "tgcat") {
    // The public frontend exposes two finite result sets, not a page/offset API.
    if (page > 1) return { results: [], hasMore: false };
    const results: StoredChannelInput[] = [];
    for (const type of ["supergroup", "channel"]) {
      const url = `https://api.tg-cat.com/api/cf/search?${new URLSearchParams({ search: query, type, lang: "ru" })}`;
      const parsed = parseTgCat((await request(url)).body);
      logSearch(`[TG-Cat] ${type}: received ${parsed.results.length} non-ad records; catalog reports ${parsed.reported} (not a completeness guarantee)`);
      results.push(...parsed.results);
    }
    return { results, hasMore: false };
  }
  if (source === "catalogTelegram") {
    const url = `https://catalog-telegram.site/search?${new URLSearchParams({ search: query, page: String(page) })}`;
    const parsed = parseCatalogTelegram((await request(url)).body, page);
    for (const { item, redirect } of parsed.candidates) {
      checkSearchCancelled();
      try {
        const target = await request(redirect);
        item.telegramUrl = target.telegramUrl || null;
        item.extractionStatus = item.telegramUrl ? "success" : "pending";
        if (!item.telegramUrl) logSearch(`[Warning] ${item.title}: redirect did not expose a Telegram link`);
      } catch (error: any) { checkSearchCancelled(); item.error = error.message; logSearch(`[Warning] ${item.title}: ${error.message}`); }
    }
    return { results: parsed.candidates.map(c => c.item), hasMore: parsed.hasMore };
  }
  if (source === "tglib") {
    const url = `https://yandex.ru/search/site/?${new URLSearchParams({ searchid: "4748854", text: query, web: "0", p: String(page - 1) })}`;
    const parsed = parseTglibSearch((await request(url)).body, page);
    for (const item of parsed.results) {
      checkSearchCancelled();
      try {
        item.telegramUrl = extractTglibLink((await request(item.detailUrl)).body);
        item.extractionStatus = item.telegramUrl ? "success" : "pending";
        if (!item.telegramUrl) logSearch(`[Warning] ${item.title}: no community link on detail page`);
      } catch (error: any) { checkSearchCancelled(); item.error = error.message; logSearch(`[Warning] ${item.title}: ${error.message}`); }
    }
    return parsed;
  }
  throw new Error("Unknown additional catalog");
}
