import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import { setGlobalDispatcher, ProxyAgent } from "undici";
import { db, recoverStaleSearches, isDatabaseEmpty, getCachedChannel, putCachedChannel } from "./server/db.js";
import { normalizeTelegramLink } from "./src/telegram-links.js";
import { EXTRA_CATALOGS, fetchCatalogPage } from "./server/catalog-sources.js";
import { telegramConfigured, searchTelegram } from "./server/telegram-discovery.js";
import { searchContext } from "./server/search-context.js";
export { db };
import {
  attachSession,
  bootstrapOwner,
  changePassword,
  createManagedUser,
  createSession,
  destroySession,
  login,
  requireOwner,
  requireUser,
  type AuthenticatedRequest,
} from "./server/auth.js";
import {
  completeSearch,
  createSearch,
  getSearchStatus,
  claimSearch,
  touchSearch,
  requestSearchCancel,
  isSearchCancelRequested,
  listQueuedSearches,
  deleteResult,
  deleteSearch,
  getResult,
  getSearch,
  listSearches,
  saveResults,
  updateResult,
  searchCachedChannels,
  resultKey,
  isBotTarget,
} from "./server/store.js";
import { filterAndRankByRelevance, calculateRelevance } from "./server/relevance.js";

dotenv.config();

const rawProxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const isLocalProxy = rawProxyUrl ? /(?:127\.0\.0\.1|localhost)/.test(rawProxyUrl) : false;
const proxyUrl = (isLocalProxy && process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_PROXY !== "true")
  ? undefined
  : rawProxyUrl;

if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[Network] Routing outbound requests through proxy: ${proxyUrl}`);
} else if (rawProxyUrl) {
  console.log(`[Network] Ignoring local proxy in production: ${rawProxyUrl}`);
}

export const app = express();
const PORT = 3000;
const MAX_PAGES = 500;
const MAX_GLOBAL_CONCURRENT_SEARCHES = 2;
const activeSearches = new Set<number>();
let activeGlobalJobCount = 0;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());
app.use(attachSession);

recoverStaleSearches();

// Lazy-initialize Gemini client
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing. Please set it in Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Utility to clean HTML for Gemini processing
function cleanHtmlForAI(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, svg, iframe, header, footer, nav, noscript, link, meta, head").remove();
  
  // Clean attributes to reduce token count
  $("*").each((_, el) => {
    if (el.type === "tag") {
      const attribs = el.attribs;
      if (attribs) {
        for (const key of Object.keys(attribs)) {
          if (!["href", "src", "alt", "class", "id"].includes(key)) {
            delete attribs[key];
          }
        }
      }
    }
  });
  
  // Return compressed content
  return $.html().replace(/\s+/g, " ").trim();
}

// Deduce direct Telegram link from detailed page URL, description or title
function deduceTelegramUrl(detailUrl: string, title: string, description: string): { telegramUrl: string | null; username: string | null } {
  if (!detailUrl) return { telegramUrl: null, username: null };

  // 1. If detailUrl itself is t.me or telegram.me
  if (/t\.me\/|telegram\.me\//i.test(detailUrl)) {
    const match = detailUrl.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{3,})/i);
    if (match) {
      return { telegramUrl: `https://t.me/${match[1]}`, username: match[1] };
    }
    return { telegramUrl: detailUrl, username: null };
  }

  // 2. Try matching channel/group paths
  const pathMatch = detailUrl.match(/(?:\/(?:channel|group|chat|cat|catalog|c|g|show|tg|t)\/|@)([a-zA-Z0-9_]{3,100})/i);
  if (pathMatch && pathMatch[1]) {
    const username = pathMatch[1];
    const excluded = ["search", "about", "contact", "privacy", "terms", "faq", "help", "channels", "groups", "add", "catalog", "category", "categories", "en", "ru", "feedback", "show", "tg", "t", "pages", "page"];
    // Skip numeric-only IDs (e.g. /channel/13460077389) — these are Telegram internal IDs, not usernames
    if (!excluded.includes(username.toLowerCase()) && !/^\d+$/.test(username)) {
      return { telegramUrl: `https://t.me/${username}`, username };
    }
  }

  // 3. Try finding in description/title
  if (description) {
    const tmeMatch = description.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{3,100})/i);
    if (tmeMatch) {
      return { telegramUrl: `https://t.me/${tmeMatch[1]}`, username: tmeMatch[1] };
    }
    const atMatch = description.match(/@([a-zA-Z0-9_]{4,100})/i);
    if (atMatch) {
      return { telegramUrl: `https://t.me/${atMatch[1]}`, username: atMatch[1] };
    }
  }

  return { telegramUrl: null, username: null };
}

// Helper to determine if a scraped target is a Channel, Group/Chat, or Closed invite-only chat
function detectChatType(telegramUrl: string | null, title: string, description: string, detailUrl: string, subscribers: string | null): "channel" | "group" | "closed" | "unknown" {
  const normTitle = (title || "").toLowerCase();
  const normDesc = (description || "").toLowerCase();
  const normUrl = (telegramUrl || "").toLowerCase();
  const normDetail = (detailUrl || "").toLowerCase();
  const normSubs = (subscribers || "").toLowerCase();

  // 1. Closed/Private link is highest priority
  if (
    normUrl.includes("+") || 
    normUrl.includes("joinchat") || 
    normTitle.includes("закрытый") || 
    normDesc.includes("закрытый") || 
    normDesc.includes("private") || 
    normTitle.includes("private") ||
    normDesc.includes("приглашение") ||
    normDesc.includes("invite") ||
    normTitle.includes("пригласительная")
  ) {
    return "closed";
  }

  // 2. Groups/Chats
  if (
    normDetail.includes("/chat/") ||
    normDetail.includes("/group/") ||
    normDetail.includes("/g/") ||
    normTitle.includes("чат") ||
    normTitle.includes("группа") ||
    normTitle.includes("беседа") ||
    normTitle.includes("group") ||
    normTitle.includes("chat") ||
    normDesc.includes("чат ") ||
    normDesc.includes(" чат") ||
    normDesc.includes("группа") ||
    normDesc.includes("обсуждаем") ||
    normDesc.includes("беседа") ||
    normDesc.includes("group") ||
    normDesc.includes("chat") ||
    normSubs.includes("member") ||
    normSubs.includes("участник") ||
    normSubs.includes("участников")
  ) {
    return "group";
  }

  // 3. Channels
  if (
    normDetail.includes("/channel/") ||
    normDetail.includes("/c/") ||
    normTitle.includes("канал") ||
    normTitle.includes("news") ||
    normTitle.includes("блог") ||
    normTitle.includes("channel") ||
    normDesc.includes("канал") ||
    normDesc.includes("подписывайтесь") ||
    normDesc.includes("news") ||
    normDesc.includes("channel") ||
    normSubs.includes("sub") ||
    normSubs.includes("подпис") ||
    normSubs.includes("subs")
  ) {
    return "channel";
  }

  return "unknown";
}

// Robust fallback selector-based search parser
function parseWithSelectors(html: string, source: string, baseUrl: string): any[] {
  const $ = cheerio.load(html);
  const results: any[] = [];

  // Helper to resolve URLs
  const resolveUrl = (urlStr: string) => {
    if (!urlStr) return "";
    if (urlStr.startsWith("http")) return urlStr;
    return new URL(urlStr, baseUrl).toString();
  };

  // ── tgsearch-specific parser ──
  if (source === "tgsearch") {
    // Search result pages have .channel-card elements (skip .is-promo cards)
    // Each card: h2.channel-card__title > a[href="/channel/<id>"] with tg:// link
    //           ul.channel-card__options > li (subscribers) + li (username or "приватный")
    //           .channel-card__description
    $(".channel-card").each((_, el) => {
      const $card = $(el);
      // Skip promo/ad cards
      if ($card.hasClass("is-promo") || $card.hasClass("is-promo-1")) return;

      const $titleLink = $card.find(".channel-card__title a").first();
      const href = $titleLink.attr("href") || "";
      if (!href.includes("/channel/")) return;

      const detailUrl = resolveUrl(href);
      const title = $titleLink.text().trim();

      // Extract subscribers from first <li> (contains <i class="fa fa-user">)
      let subscribers: string | null = null;
      $card.find(".channel-card__options li").each((_, li) => {
        const text = $(li).text().trim();
        if (text.match(/\d/) && !text.startsWith("@")) {
          subscribers = text.replace(/\s+/g, " ").trim();
        }
      });

      // Extract username from second <li> (e.g. @freelancehuntnews or "приватный")
      let username: string | null = null;
      const optionsLis = $card.find(".channel-card__options li");
      if (optionsLis.length >= 2) {
        const uText = $(optionsLis[1]).text().trim();
        if (uText.startsWith("@")) {
          username = uText.substring(1); // remove @
        }
      }

      const description = $card.find(".channel-card__description").first().text().trim();
      const imageUrl = resolveUrl($card.find(".channel-card__media img").attr("src") || "");

      // Build telegram URL
      let telegramUrl: string | null = null;
      let extractionStatus: string = "pending";
      if (username) {
        telegramUrl = `https://t.me/${username}`;
        extractionStatus = "success";
      } else if (description) {
        // Try to find t.me or tg:// links in description
        const tgMatch = description.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{3,})/i)
                     || description.match(/tg:\/\/resolve\?domain=([a-zA-Z0-9_]{3,})/i)
                     || description.match(/tg:\/\/join\?invite=([a-zA-Z0-9_]+)/i);
        if (tgMatch) {
          telegramUrl = tgMatch[0].startsWith("tg://") ? tgMatch[0] : `https://t.me/${tgMatch[1]}`;
          username = tgMatch[1];
          extractionStatus = "success";
        } else {
          extractionStatus = "pending";
        }
      }

      if (title && detailUrl && !results.some(r => r.detailUrl === detailUrl)) {
        results.push({
          title,
          description: description || "No description provided.",
          subscribers,
          detailUrl,
          imageUrl: imageUrl || null,
          source,
          telegramUrl,
          username,
          extractionStatus,
          chatType: detectChatType(telegramUrl, title, description, detailUrl, subscribers)
        });
      }
    });

    // Also check detail page format (.channel-detail) — used when fetching individual channel pages
    const $detail = $(".channel-detail");
    if ($detail.length > 0 && results.length === 0) {
      const $titleLink = $detail.find(".channel-detail__title a").first();
      const href = $titleLink.attr("href") || "";
      const title = $titleLink.text().trim();

      let subscribers: string | null = null;
      $detail.find(".channel-detail__options li").each((_, li) => {
        const text = $(li).text().trim();
        if (text.match(/\d/) && !text.startsWith("@")) {
          subscribers = text.replace(/\s+/g, " ").trim();
        }
      });

      let username: string | null = null;
      const optionsLis = $detail.find(".channel-detail__options li");
      if (optionsLis.length >= 2) {
        const uText = $(optionsLis[1]).text().trim();
        if (uText.startsWith("@")) {
          username = uText.substring(1);
        }
      }

      const description = $detail.find(".channel-detail__description").first().text().trim();
      const imageUrl = resolveUrl($detail.find(".channel-detail__media img").attr("src") || "");

      let telegramUrl: string | null = null;
      let extractionStatus: string = "pending";
      // The title link itself is tg://resolve?domain=...
      if (href.startsWith("tg://")) {
        telegramUrl = href;
        extractionStatus = "success";
        if (href.includes("domain=")) username = href.split("domain=")[1];
        else if (href.includes("invite=")) username = href.split("invite=")[1];
      } else if (username) {
        telegramUrl = `https://t.me/${username}`;
        extractionStatus = "success";
      }

      if (title && !results.some(r => r.title === title)) {
        results.push({
          title,
          description: description || "No description provided.",
          subscribers,
          detailUrl: resolveUrl($(".channel-detail__link a.app").attr("href") || href),
          imageUrl: imageUrl || null,
          source,
          telegramUrl,
          username,
          extractionStatus,
          chatType: detectChatType(telegramUrl, title, description, "", subscribers)
        });
      }
    }

    return results;
  }

  // ── tgramcat-specific parser ──
  if (source === "tgramcat") {
    // Search results: each card is .col > .border.rounded.bg-body.p-2 containing a[href="/channel/<numeric_id>"]
    // Structure: img.rounded-circle + a[href="/channel/..."] (title) + .text-muted (subs • @username) + div (description)
    
    $(".col").each((_, el) => {
      const $card = $(el);
      const $border = $card.find(".border.rounded.bg-body.p-2");
      if ($border.length === 0) return;

      // Must have a link to /channel/<numeric_id> — NOT /account/channel/add or similar
      const $titleLink = $border.find("a").filter((_, a) => {
        const href = $(a).attr("href") || "";
        return /^\/channel\/\d+/.test(href);
      }).first();
      if ($titleLink.length === 0) return;

      const href = $titleLink.attr("href") || "";
      const detailUrl = resolveUrl(href);
      const title = $titleLink.text().trim();

      // Extract subs + username from .text-muted: "👤 478 • @sozrelvopross"
      let subscribers: string | null = null;
      let username: string | null = null;
      $border.find(".text-muted").each((_, el) => {
        const text = $(el).text().trim();
        if (text.includes("•")) {
          const subsMatch = text.match(/(\d[\d\s.,]*)\s*•/);
          if (subsMatch) subscribers = subsMatch[1].trim();
          const userMatch = text.match(/@([a-zA-Z0-9_]+)/);
          if (userMatch) username = userMatch[1];
        }
      });

      // Description: div inside .d-flex > div:last-child that is NOT .text-muted, NOT title link, NOT img
      let description = "";
      const $textContainer = $border.find(".d-flex > div:last-child");
      if ($textContainer.length > 0) {
        $textContainer.children("div").each((_, d) => {
          const $d = $(d);
          if (!$d.hasClass("text-muted") && $d.find("a").length === 0 && $d.find("img").length === 0) {
            const text = $d.text().trim();
            if (text.length > 3) description = text;
          }
        });
      }

      const imageUrl = resolveUrl($border.find("img").attr("src") || "");

      // Don't build telegram URL from username here — let detail page fetch confirm it
      let telegramUrl: string | null = null;
      let extractionStatus: string = "pending";

      if (title && detailUrl && !results.some(r => r.detailUrl === detailUrl)) {
        results.push({
          title,
          description: description || "No description provided.",
          subscribers,
          detailUrl,
          imageUrl: imageUrl || null,
          source,
          telegramUrl,
          username,
          extractionStatus,
          chatType: detectChatType(telegramUrl, title, description, detailUrl, subscribers)
        });
      }
    });

    // Detail page: h1 with channel info (only if no search results found)
    const $h1 = $("h1.font-family-ua-brand, h1.h2");
    if ($h1.length > 0 && results.length === 0) {
      const title = $h1.first().text().trim();
      
      let subscribers: string | null = null;
      let username: string | null = null;
      const $meta = $(".mb-3.text-muted").first();
      if ($meta.length > 0) {
        const metaText = $meta.text().trim();
        const subsMatch = metaText.match(/(\d[\d\s.,]*)\s*•/);
        if (subsMatch) subscribers = subsMatch[1].trim();
        const userMatch = metaText.match(/@([a-zA-Z0-9_]+)/);
        if (userMatch) username = userMatch[1];
      }

      const description = $(".mb-3.fs-5").first().text().trim();
      
      // Telegram link from "Открыть" button
      let telegramUrl: string | null = null;
      let extractionStatus: string = "pending";
      $("a.btn").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (/t\.me\//i.test(href)) {
          telegramUrl = href;
          extractionStatus = "success";
          return false;
        }
      });
      if (!telegramUrl && username) {
        telegramUrl = `https://t.me/${username}`;
        extractionStatus = "success";
      }

      const imageUrl = resolveUrl($(".channel-header img").attr("src") || "");
      const detailUrl = $("link[rel='canonical']").attr("href") || "";

      if (title) {
        results.push({
          title,
          description: description || "No description provided.",
          subscribers,
          detailUrl,
          imageUrl: imageUrl || null,
          source,
          telegramUrl,
          username,
          extractionStatus,
          chatType: detectChatType(telegramUrl, title, description, detailUrl, subscribers)
        });
      }
    }

    return results;
  }

  // ── tgramsearch-specific parser ──
  if (source === "tgramsearch") {
    // Each card: .tg-channel
    // Title: .tg-channel__link a[href="/join/<id>"]
    // Subscribers: .tg-stat__user-count (just the number)
    // Description: .tg-channel__description
    // Type: .tg-option--public (публичный) or .tg-option--private (приватный)
    // Image: .tg-channel__avatar img

    $(".tg-channel").each((_, el) => {
      const $card = $(el);
      
      const $link = $card.find(".tg-channel__link a").first();
      const href = $link.attr("href") || "";
      if (!href.includes("/join/") && !href.includes("/channel/")) return;

      const detailUrl = resolveUrl(href);
      const title = $link.text().trim();
      if (!title) return;

      // Subscribers: just the number from .tg-stat__user-count
      const subsText = $card.find(".tg-stat__user-count").first().text().trim();
      let subscribers: string | null = null;
      if (subsText) {
        const num = parseInt(subsText, 10);
        if (!isNaN(num)) {
          subscribers = num.toLocaleString("en-US"); // format with commas: 72707 -> 72,707
        }
      }

      const description = $card.find(".tg-channel__description").first().text().trim();
      const imageUrl = resolveUrl($card.find(".tg-channel__avatar img").attr("src") || "");

      // Chat type from option class
      const isPrivate = $card.find(".tg-option--private").length > 0;

      // On search results page, there's NO direct tg:// link — it's on the detail page
      // Mark as pending; detail page fetch will resolve the actual link
      let telegramUrl: string | null = null;
      let username: string | null = null;
      let extractionStatus: string = "pending";

      if (title && detailUrl && !results.some(r => r.detailUrl === detailUrl)) {
        results.push({
          title,
          description: description || "No description provided.",
          subscribers,
          detailUrl,
          imageUrl: imageUrl || null,
          source,
          telegramUrl,
          username,
          extractionStatus,
          chatType: isPrivate ? "closed" : detectChatType(telegramUrl, title, description, detailUrl, subscribers)
        });
      }
    });

    return results;
  }

  // ── Generic parser for other sources ──
  const selectors = [
    ".card", ".channel-card", ".search-item", ".list-group-item",
    ".item", ".channel", ".grid-item", "article", ".box",
    ".result-item", ".result", ".channel-box", ".search_row",
    ".tg-item", ".catalog-item", ".search-result", ".tg-channel",
    ".main-search-button-result-item", ".main-search-button-result-item-wrapper"
  ];

  selectors.forEach((sel) => {
    $(sel).each((_, el) => {
      const $card = $(el);
      // Find the first link that points to a detail or direct telegram page
      const $link = $card.find("a").filter((_, aEl) => {
        const href = $(aEl).attr("href") || "";
        return href.includes("/channel/") || href.includes("/group/") || href.includes("/catalog/") || 
               href.includes("/cat/") || href.includes("/chat/") || href.includes("/show/") || 
               href.includes("/t/") || href.includes("/tg/") || href.includes("/details/") || 
               href.includes("/join/") || /t\.me\//i.test(href);
      }).first();

      if ($link.length > 0) {
        const detailUrl = resolveUrl($link.attr("href") || "");
        const description = $card.find("p, .desc, .description, .text-muted, .info, .search_desc, .channel-description, .search-result-descr, .tg-channel__description").first().text().trim();
        const subscribers = $card.find(".subscribers, .subs, .members, .count, :contains('подпис'), :contains('sub'), .tg-stat__user-count").first().text().trim();
        const imageUrl = resolveUrl($card.find("img").attr("src") || "");

        let title = $card.find("h3, h4, h5, h2, .title, .name, strong, .search_title, .channel-title, .search-result-title, .tg-channel__link, .tg-channel__info").first().text().trim() || $link.text().trim();
        if (!title) {
          const m = detailUrl.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{3,})/i);
          if (m) {
            title = `@${m[1]}`;
          } else {
            const descSnippet = (description || "").split(/\s+/).slice(0, 5).join(" ");
            title = descSnippet ? `${descSnippet}...` : "Telegram Link";
          }
        }

        if (title && detailUrl && !results.some(r => r.detailUrl === detailUrl)) {
          // Check if there is an explicit t.me link inside the card
          let directTgUrl: string | null = null;
          let directUsername: string | null = null;
          
          $card.find("a").each((_, aEl) => {
            const href = $(aEl).attr("href") || "";
            if (/t\.me\/|telegram\.me\//i.test(href)) {
              const m = href.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{3,})/i);
              if (m) {
                directTgUrl = `https://t.me/${m[1]}`;
                directUsername = m[1];
                return false; // break loop
              }
            }
          });

          // If no direct t.me link, try to deduce it
          let deduced = deduceTelegramUrl(detailUrl, title, description || "");
          let finalTelegramUrl = directTgUrl || deduced.telegramUrl;
          let finalUsername = directUsername || deduced.username;
          let isConfirmedSuccess = !!directTgUrl;

          if (source === "tgramsearch" && detailUrl.includes("/join/")) {
             finalTelegramUrl = detailUrl;
             finalUsername = detailUrl.split("/join/")[1] || null;
             isConfirmedSuccess = false;
          }

          results.push({
            title,
            description: description || "No description provided.",
            subscribers: subscribers || null,
            detailUrl,
            imageUrl: imageUrl || null,
            source,
            telegramUrl: finalTelegramUrl,
            username: finalUsername,
            extractionStatus: isConfirmedSuccess ? "success" : (finalTelegramUrl ? "guessed" : "pending"),
            chatType: detectChatType(finalTelegramUrl, title, description || "", detailUrl, subscribers || null)
          });
        }
      }
    });
  });

  // 2. If nothing found, parse all <a> tags that contain channel/group keywords
  if (results.length === 0) {
    $("a").each((_, el) => {
      const $link = $(el);
      const href = $link.attr("href") || "";
      if (href.includes("/channel/") || href.includes("/group/") || href.includes("/cat/") || 
          href.includes("/catalog/") || href.includes("/chat/") || href.includes("/show/") || 
          href.includes("/t/") || href.includes("/tg/") || href.includes("/details/") || /t\.me\//i.test(href)) {
        const detailUrl = resolveUrl(href);
        const parent = $link.closest("div");
        const description = parent.find("p, .desc, .description, .tg-channel__description").first().text().trim();
        const subscribers = parent.text().match(/\d+[\d\s.,]*(подписчиков|subscribers|members|участников|subs)/i)?.[0] || null;
        const imageUrl = resolveUrl(parent.find("img").attr("src") || "");

        let title = $link.text().trim() || parent.find("h1, h2, h3, h4, h5, strong, .tg-channel__link").first().text().trim();
        if (!title) {
          const m = detailUrl.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{3,})/i);
          if (m) {
            title = `@${m[1]}`;
          } else {
            const descSnippet = (description || "").split(/\s+/).slice(0, 5).join(" ");
            title = descSnippet ? `${descSnippet}...` : "Telegram Link";
          }
        }

        if (title && detailUrl && !results.some(r => r.detailUrl === detailUrl)) {
          const deduced = deduceTelegramUrl(detailUrl, title, description || "");
          results.push({
            title,
            description: description || "No description provided.",
            subscribers,
            detailUrl,
            imageUrl: imageUrl || null,
            source,
            telegramUrl: deduced.telegramUrl,
            username: deduced.username,
            extractionStatus: deduced.telegramUrl ? "guessed" : "pending",
            chatType: detectChatType(deduced.telegramUrl, title, description || "", detailUrl, subscribers)
          });
        }
      }
    });
  }

  return results;
}

const CHROME_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Helper to make a fetch request with randomized mobile/desktop browser headers and automatic retry
async function fetchWithHeaders(url: string, retries = 1, delayMs = 1000, extraHeaders: Record<string, string> = {}, timeoutMs = 7000): Promise<string> {
  const headers = {
    "User-Agent": CHROME_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    ...extraHeaders,
  };

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 429) {
        console.warn(`[Rate Limit] HTTP 429 for ${url}. Retrying after ${delayMs * 2}ms...`);
        if (attempt <= retries) {
          await new Promise(r => setTimeout(r, delayMs * 2));
          continue;
        }
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (error: any) {
      const causeDetail = error.cause ? ` — cause: ${error.cause.code || error.cause.message || error.cause}` : "";
      const isFatal = /ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT|TimeoutError|timeout/i.test(`${error.message} ${causeDetail}`);
      console.warn(`[Fetch Attempt ${attempt}/${retries + 1}] Failed for ${url}: ${error.message}${causeDetail}`);
      if (!isFatal && attempt <= retries) {
        await new Promise(r => setTimeout(r, delayMs * attempt));
      } else {
        throw new Error(`Failed to fetch page content: ${error.message}${causeDetail}`);
      }
    }
  }
  throw new Error("Failed to fetch page content: unknown error");
}

// Some catalogs (e.g. tgramsearch) gate real content behind a session cookie issued on first visit —
// a plain stateless fetch to a deep search URL can come back "200 OK" but with an empty/placeholder body.
// Warm up by hitting the homepage first and carry its Set-Cookie into subsequent requests.
async function fetchSessionCookie(baseUrl: string, logs?: string[]): Promise<string> {
  try {
    const res = await fetch(baseUrl, {
      headers: {
        "User-Agent": CHROME_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
    });
    const getSetCookie = (res.headers as any).getSetCookie;
    const cookies: string[] = typeof getSetCookie === "function"
      ? getSetCookie.call(res.headers)
      : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
    return cookies.map(c => c.split(";")[0]).join("; ");
  } catch (e: any) {
    const causeDetail = e.cause ? ` — cause: ${e.cause.code || e.cause.message || e.cause}` : "";
    console.warn(`[Session Warmup] Failed to fetch session cookie for ${baseUrl}: ${e.message}${causeDetail}`);
    logs?.push(`[Session] Warmup request to ${baseUrl} threw: ${e.message}${causeDetail}`);
    return "";
  }
}

// ---------------- API ENDPOINTS ----------------

function safeSearchInput(body: any): { query: string; source: string; mode: "fast" | "ai"; limitPages: number } {
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const source = typeof body.source === "string" ? body.source : "all";
  const mode = body.mode === "ai" ? "ai" : "fast";
  const requestedLimit = Number.parseInt(String(body.limitPages), 10);
  const limitPages = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_PAGES) : MAX_PAGES;
  const validSources = [
    "all",
    "tgsearch",
    "tgramcat",
    "tgramsearch",
    "waybien",
    "lyzem",
    ...EXTRA_CATALOGS,
    "telegram",
  ];
  if (!query) throw new Error("Search query is required.");
  if (!validSources.includes(source)) throw new Error("Unsupported search source.");
  return { query, source, mode, limitPages };
}

app.get("/api/auth/me", (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user || null, needsBootstrap: !req.user && isDatabaseEmpty() });
});

app.post("/api/auth/bootstrap", async (req, res) => {
  if (!isDatabaseEmpty()) {
    return res.status(400).json({ error: "Owner account is already configured." });
  }
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  try {
    const user = await createManagedUser(email, password) as any;
    db.prepare("UPDATE users SET role = 'owner', must_change_password = 0 WHERE id = ?").run(user.id);
    const ownerUser = { id: user.id, email: user.email, role: "owner" as const, mustChangePassword: false };
    await createSession(res, ownerUser);
    res.json({ user: ownerUser });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/channels/search", requireUser, (req: AuthenticatedRequest, res) => {
  const q = typeof req.query?.q === "string" ? req.query.q : "";
  const results = searchCachedChannels(q, 100);
  res.json({ results });
});

app.post("/api/auth/login", async (req, res) => {
  const user = await login(req.body?.email, req.body?.password);
  if (!user) return res.status(401).json({ error: "Invalid email or password." });
  await createSession(res, user);
  res.json({ user });
});

app.post("/api/auth/logout", (req: AuthenticatedRequest, res) => {
  destroySession(req, res);
  res.status(204).end();
});

app.post("/api/auth/change-password", requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    await changePassword(req.user!.id, req.body?.currentPassword, req.body?.newPassword);
    res.status(204).end();
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

interface ImportWorkerState {
  running: boolean;
  searchId: number | null;
  total: number;
  processed: number;
  enriched: number;
  failed: number;
  lastUpdated: string;
}

let importWorkerState: ImportWorkerState = {
  running: false,
  searchId: null,
  total: 0,
  processed: 0,
  enriched: 0,
  failed: 0,
  lastUpdated: new Date().toISOString()
};

async function runBackgroundEnrichment(userId: number, searchId?: number, isGlobal?: boolean) {
  if (importWorkerState.running) return;
  importWorkerState.running = true;

  try {
    let rows: any[] = [];
    if (isGlobal) {
      rows = db.prepare(`SELECT dedup_key as id, telegram_url FROM channels WHERE telegram_url IS NOT NULL AND chat_type != 'bot' AND telegram_url NOT LIKE '%_bot' AND (image_url IS NULL OR description='' OR chat_type='unknown') LIMIT 5000`).all();
    } else {
      const query = searchId
        ? `SELECT r.id, r.telegram_url FROM search_results r WHERE r.search_id=? AND r.chat_type != 'bot' AND r.telegram_url NOT LIKE '%_bot' AND r.telegram_url IS NOT NULL AND (r.image_url IS NULL OR r.description='' OR r.chat_type='unknown')`
        : `SELECT r.id, r.telegram_url FROM search_results r JOIN searches s ON s.id=r.search_id WHERE s.user_id=? AND r.source='import' AND r.chat_type != 'bot' AND r.telegram_url NOT LIKE '%_bot' AND r.telegram_url IS NOT NULL AND (r.image_url IS NULL OR r.description='' OR r.chat_type='unknown') LIMIT 3000`;
      const params = searchId ? [searchId] : [userId];
      rows = db.prepare(query).all(...params) as { id: number; telegram_url: string }[];
    }

    importWorkerState.total = rows.length;
    importWorkerState.processed = 0;
    importWorkerState.enriched = 0;
    importWorkerState.failed = 0;
    importWorkerState.searchId = searchId || null;

    const BATCH_SIZE = 5;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      if (!importWorkerState.running) break;
      const batch = rows.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (row) => {
        try {
          const url = normalizeTelegramLink(row.telegram_url);
          if (!url) {
            importWorkerState.processed++;
            return;
          }
          if (isBotTarget(url)) {
            db.prepare("DELETE FROM channels WHERE dedup_key = ? OR telegram_url = ?").run(row.id, url);
            db.prepare("DELETE FROM search_results WHERE telegram_url = ?").run(url);
            importWorkerState.processed++;
            return;
          }
          const preview = await enrichTelegramPreview(url);
          if (preview.chatType === "bot" || isBotTarget(url, null, preview.title, preview.chatType)) {
            db.prepare("DELETE FROM channels WHERE dedup_key = ? OR telegram_url = ?").run(row.id, url);
            db.prepare("DELETE FROM search_results WHERE telegram_url = ?").run(url);
            importWorkerState.processed++;
            return;
          }
          if (isGlobal) {
            const existing = getCachedChannel(row.id);
            if (existing) {
              putCachedChannel(row.id, {
                ...existing,
                title: preview.title || existing.title,
                description: preview.description || existing.description,
                imageUrl: preview.imageUrl || existing.imageUrl,
                subscribers: preview.subscribers || existing.subscribers,
                chatType: preview.chatType !== 'unknown' ? preview.chatType : existing.chatType,
                extractionStatus: preview.chatType === 'unknown' ? 'pending' : 'success'
              });
              db.prepare(`UPDATE search_results SET 
                title = COALESCE(NULLIF(?, ''), title), 
                description = COALESCE(NULLIF(?, ''), description), 
                image_url = COALESCE(NULLIF(?, ''), image_url), 
                subscribers = COALESCE(NULLIF(?, ''), subscribers), 
                chat_type = CASE WHEN ? = 'unknown' THEN chat_type ELSE ? END, 
                extraction_status = 'success' 
                WHERE telegram_url = ?`).run(
                preview.title || null,
                preview.description || null,
                preview.imageUrl || null,
                preview.subscribers || null,
                preview.chatType,
                preview.chatType,
                url
              );
              importWorkerState.enriched++;
            }
          } else {
            const existing = getResult(userId, row.id);
            if (existing) {
              updateResult(userId, row.id, {
                title: preview.title || existing.title,
                description: preview.description || existing.description,
                imageUrl: preview.imageUrl || existing.imageUrl,
                subscribers: preview.subscribers || existing.subscribers,
                chatType: preview.chatType !== 'unknown' ? preview.chatType : existing.chatType,
                telegramUrl: url,
                username: url.includes('/+') ? null : url.split('/').pop() || null,
                extractionStatus: preview.chatType === 'unknown' ? 'pending' : 'success'
              });
              const cached = getCachedChannel(row.id) || getCachedChannel(`telegram:${url}`);
              if (cached) {
                putCachedChannel(row.id, {
                  ...cached,
                  title: preview.title || cached.title,
                  description: preview.description || cached.description,
                  imageUrl: preview.imageUrl || cached.imageUrl,
                  subscribers: preview.subscribers || cached.subscribers,
                  chatType: preview.chatType !== 'unknown' ? preview.chatType : cached.chatType,
                  extractionStatus: preview.chatType === 'unknown' ? 'pending' : 'success'
                });
              }
              importWorkerState.enriched++;
            }
          }
        } catch {
          importWorkerState.failed++;
        } finally {
          importWorkerState.processed++;
          importWorkerState.lastUpdated = new Date().toISOString();
        }
      }));
      await new Promise(r => setTimeout(r, 150));
    }
  } finally {
    importWorkerState.running = false;
  }
}

app.post("/api/import", requireUser, async (req: AuthenticatedRequest, res) => {
  const raw = typeof req.body?.links === "string" ? req.body.links : "";
  const input = raw.split(/[\s,;\n]+/).filter(Boolean).slice(0, 50000);
  const valid = input.map(value => normalizeTelegramLink(value)).filter((value): value is string => typeof value === "string");
  const unique: string[] = Array.from(new Set(valid));
  if (!unique.length) return res.status(400).json({ error: "Не найдено валидных Telegram-ссылок." });
  const userId = req.user!.id;
  const { getCachedChannel } = await import("./server/db.js");
  const imported: any[] = [];
  let fromBase = 0;
  let alreadyStored = 0;

  for (const url of unique) {
    if (isBotTarget(url)) {
      continue;
    }
    const key = `telegram:${url}`;
    const cached = getCachedChannel(key);
    if (cached) {
      if (isBotTarget(cached.telegramUrl || url, cached.username, cached.title, cached.chatType)) {
        continue;
      }
      fromBase++;
      alreadyStored++;
      imported.push({
        title: cached.title,
        description: cached.description,
        subscribers: cached.subscribers,
        imageUrl: cached.imageUrl,
        detailUrl: url,
        source: "import",
        telegramUrl: url,
        username: cached.username || (url.includes("+") ? null : url.split("/").pop()),
        extractionStatus: cached.extractionStatus,
        chatType: cached.chatType
      });
      continue;
    }
    let chatType = "unknown";
    const urlLower = url.toLowerCase();
    if (urlLower.includes("+") || urlLower.includes("joinchat")) {
      chatType = "closed";
    } else if (urlLower.endsWith("_bot") || urlLower.endsWith("bot")) {
      continue;
    } else if (urlLower.includes("chat") || urlLower.includes("group") || urlLower.includes("talk") || urlLower.includes("club") || urlLower.includes("besedka") || urlLower.includes("boltalka")) {
      chatType = "group";
    } else if (urlLower.includes("channel") || urlLower.includes("kanal") || urlLower.includes("news")) {
      chatType = "channel";
    }

    const username = (url.includes("+") || url.includes("joinchat")) ? null : url.split("/").pop() || null;
    if (isBotTarget(url, username, null, chatType)) {
      continue;
    }

    const item: any = {
      title: url.replace("https://t.me/", "@"),
      description: "",
      detailUrl: url,
      source: "import",
      telegramUrl: url,
      username,
      extractionStatus: "pending",
      chatType
    };
    imported.push(item);
  }

  if (!imported.length) return res.json({ id: null, inputCount: input.length, uniqueCount: unique.length, duplicateCount: input.length - unique.length, alreadyStored, fromBase, enriched: 0, results: [] });
  const searchId = createSearch(userId, { query: `Импорт ${imported.length} ссылок`, source: "import", mode: "fast", limitPages: 1, requestId: `import-${Date.now()}-${Math.random()}` });
  saveResults(searchId, imported);
  completeSearch(searchId, userId, { import: { pagesFetched: 1, totalFound: input.length, uniqueAdded: imported.length, duplicatesFiltered: input.length - unique.length, fromBase, enriched: fromBase } }, [`[Import] Получено строк: ${input.length}`, `[Import] Уникальных в файле: ${unique.length}`, `[Import] Из постоянной базы: ${fromBase}`, `[Import] Сохранено в базу: ${imported.length}`]);

  // Launch background enrichment without blocking client response
  void runBackgroundEnrichment(userId, searchId);

  res.json({ id: String(searchId), inputCount: input.length, uniqueCount: unique.length, duplicateCount: input.length - unique.length, alreadyStored, fromBase, added: imported.length, results: imported });
});

app.post("/api/import/enrich", requireUser, async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const searchId = typeof req.body?.searchId === "number" || typeof req.body?.searchId === "string" ? Number(req.body.searchId) : undefined;
  if (!importWorkerState.running) {
    void runBackgroundEnrichment(userId, Number.isInteger(searchId) ? searchId : undefined);
  }
  res.json({ status: "started", ...importWorkerState });
});

app.get("/api/import/enrich/status", requireUser, (_req, res) => {
  res.json(importWorkerState);
});
app.post("/api/database/enrich", requireUser, async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  if (!importWorkerState.running) {
    void runBackgroundEnrichment(userId, undefined, true);
  }
  res.json({ status: "started", ...importWorkerState });
});

app.get("/api/database/enrich/status", requireUser, (_req, res) => {
  res.json(importWorkerState);
});

app.get("/api/database/channels", requireUser, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(1000, Math.max(1, parseInt(req.query.pageSize as string) || 50));
  const query = (req.query.query as string || "").trim();
  const searchField = req.query.searchField as string || "all";
  const chatType = req.query.chatType as string || "all";
  
  let sql = "SELECT * FROM channels WHERE (chat_type != 'bot' AND telegram_url NOT LIKE '%_bot' AND (username IS NULL OR (username NOT LIKE '%bot' AND username NOT LIKE '%_bot')))";
  const params: any[] = [];
  
  if (query) {
    if (searchField === "title") {
      sql += " AND (title LIKE ? OR username LIKE ?)";
      params.push(`%${query}%`, `%${query}%`);
    } else if (searchField === "description") {
      sql += " AND (description LIKE ? OR channel_description LIKE ?)";
      params.push(`%${query}%`, `%${query}%`);
    } else {
      sql += " AND (title LIKE ? OR description LIKE ? OR channel_description LIKE ? OR username LIKE ? OR telegram_url LIKE ?)";
      params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
    }
  }
  
  if (chatType !== "all") {
    sql += " AND chat_type = ?";
    params.push(chatType);
  }
  
  const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as c");
  const totalCount = (db.prepare(countSql).get(...params) as any).c;
  
  sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
  params.push(pageSize, (page - 1) * pageSize);
  
  const channels = db.prepare(sql).all(...params);
  
  const typeCounts = db.prepare("SELECT chat_type, COUNT(*) as c FROM channels WHERE (chat_type != 'bot' AND telegram_url NOT LIKE '%_bot' AND (username IS NULL OR (username NOT LIKE '%bot' AND username NOT LIKE '%_bot'))) GROUP BY chat_type").all() as any[];
  const stats: Record<string, number> = { total: 0, channels: 0, groups: 0, closed: 0, unknown: 0 };
  let totalChannels = 0;
  for (const row of typeCounts) {
    const t = row.chat_type || "unknown";
    const count = Number(row.c) || 0;
    totalChannels += count;
    if (t === "channel") stats.channels = count;
    else if (t === "group") stats.groups = count;
    else if (t === "closed") stats.closed = count;
    else if (t === "unknown") stats.unknown = count;
  }
  stats.total = totalChannels;
  
  res.json({
    channels: channels.map((r: any) => ({
      id: r.dedup_key,
      title: r.title,
      description: r.description,
      subscribers: r.subscribers,
      detailUrl: r.detail_url,
      imageUrl: r.image_url,
      source: r.source,
      telegramUrl: r.telegram_url,
      username: r.username,
      channelDescription: r.channel_description,
      stats: r.stats ? JSON.parse(r.stats) : null,
      extractionStatus: r.extraction_status,
      chatType: r.chat_type,
      error: r.error,
      similarChannels: r.similar_channels ? JSON.parse(r.similar_channels) : null,
      firstSeenAt: r.first_seen_at,
      updatedAt: r.updated_at
    })),
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
    stats
  });
});

app.post("/api/database/export", requireUser, (req, res) => {
  const { query, searchField = "all", chatType = "all", ids, format = "txt" } = req.body || {};
  
  let sql = "SELECT * FROM channels WHERE (chat_type != 'bot' AND telegram_url NOT LIKE '%_bot' AND (username IS NULL OR (username NOT LIKE '%bot' AND username NOT LIKE '%_bot')))";
  const params: any[] = [];
  
  if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    sql += ` AND dedup_key IN (${placeholders})`;
    params.push(...ids);
  } else {
    if (query) {
      if (searchField === "title") {
        sql += " AND (title LIKE ? OR username LIKE ?)";
        params.push(`%${query}%`, `%${query}%`);
      } else if (searchField === "description") {
        sql += " AND (description LIKE ? OR channel_description LIKE ?)";
        params.push(`%${query}%`, `%${query}%`);
      } else {
        sql += " AND (title LIKE ? OR description LIKE ? OR channel_description LIKE ? OR username LIKE ? OR telegram_url LIKE ?)";
        params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
      }
    }
    if (chatType && chatType !== "all") {
      sql += " AND chat_type = ?";
      params.push(chatType);
    }
  }
  
  sql += " ORDER BY updated_at DESC LIMIT 50000";
  const rows = db.prepare(sql).all(...params) as any[];
  const timestamp = new Date().toISOString().split("T")[0];
  
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="telegram_channels_${timestamp}.csv"`);
    res.write("\uFEFF"); // UTF-8 BOM for Excel
    res.write("Title,Username,Subscribers,Type,Telegram URL,Description\n");
    for (const r of rows) {
      const esc = (v: string | null) => `"${(v || "").replace(/"/g, '""')}"`;
      res.write(`${esc(r.title)},${esc(r.username)},${esc(r.subscribers)},${esc(r.chat_type)},${esc(r.telegram_url)},${esc(r.description || r.channel_description)}\n`);
    }
    return res.end();
  }
  
  if (format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="telegram_channels_${timestamp}.json"`);
    return res.json(rows.map(r => ({
      title: r.title,
      username: r.username,
      subscribers: r.subscribers,
      chatType: r.chat_type,
      telegramUrl: r.telegram_url,
      description: r.description || r.channel_description,
      imageUrl: r.image_url,
      source: r.source
    })));
  }
  
  if (format === "txt_report") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="telegram_report_${timestamp}.txt"`);
    for (const r of rows) {
      res.write(`Название: ${r.title || "—"}\nЮзернейм: ${r.username ? "@" + r.username : "—"}\nАудитория: ${r.subscribers || "—"}\nТип: ${r.chat_type || "unknown"}\nСсылка: ${r.telegram_url || "—"}\nОписание: ${r.description || r.channel_description || "—"}\n\n`);
    }
    return res.end();
  }
  
  // Default: Pure TXT links
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="telegram_links_${timestamp}.txt"`);
  const urls = rows.map(r => r.telegram_url).filter(Boolean);
  res.write(Array.from(new Set(urls)).join("\n") + "\n");
  return res.end();
});

app.get("/api/admin/searches", requireOwner, (_req, res) => {
  const rows = db.prepare("SELECT s.id, s.query, s.source, s.status, s.created_at, u.email, (SELECT COUNT(*) FROM search_results r WHERE r.search_id=s.id) AS result_count FROM searches s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC LIMIT 100").all();
  res.json({ searches: rows });
});
app.get("/api/admin/users", requireOwner, (_req, res) => {
  const users = db.prepare("SELECT id, email, role, is_active, must_change_password, created_at FROM users ORDER BY created_at DESC").all();
  res.json({ users });
});

app.post("/api/admin/users", requireOwner, async (req, res) => {
  try {
    const user = await createManagedUser(req.body?.email, req.body?.temporaryPassword);
    res.status(201).json({ user });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.patch("/api/admin/users/:id", requireOwner, (req: AuthenticatedRequest, res) => {
  const userId = Number(req.params.id);
  const isActive = Boolean(req.body?.isActive);
  if (!Number.isInteger(userId) || userId === req.user!.id) return res.status(400).json({ error: "The owner account cannot be changed here." });
  const changed = db.prepare("UPDATE users SET is_active = ? WHERE id = ? AND role = 'user'").run(isActive ? 1 : 0, userId).changes;
  if (!changed) return res.status(404).json({ error: "User was not found." });
  if (!isActive) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  res.status(204).end();
});

app.delete("/api/admin/users/:id", requireOwner, (req: AuthenticatedRequest, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId === req.user!.id) return res.status(400).json({ error: "The owner account cannot be deleted." });
  const changed = db.prepare("DELETE FROM users WHERE id = ? AND role = 'user'").run(userId).changes;
  if (!changed) return res.status(404).json({ error: "User was not found." });
  res.status(204).end();
});

app.get("/api/searches", requireUser, (req: AuthenticatedRequest, res) => {
  res.json({ searches: listSearches(req.user!.id) });
});

app.get("/api/searches/:id", requireUser, (req: AuthenticatedRequest, res) => {
  const search = getSearch(req.user!.id, Number(req.params.id));
  if (!search) return res.status(404).json({ error: "Search was not found." });
  res.json(search);
});

app.delete("/api/searches/:id", requireUser, (req: AuthenticatedRequest, res) => {
  if (!deleteSearch(req.user!.id, Number(req.params.id))) return res.status(404).json({ error: "Search was not found." });
  res.status(204).end();
});

app.delete("/api/results/:id", requireUser, (req: AuthenticatedRequest, res) => {
  if (!deleteResult(req.user!.id, Number(req.params.id))) return res.status(404).json({ error: "Result was not found." });
  res.status(204).end();
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date() });
});

// Get the search URL for a given source, query, and page number
function getSearchUrlForSource(source: string, query: string, page: number): string {
  const encodedQuery = encodeURIComponent(query);
  switch (source) {
    case "tgsearch":
      return `https://tgsearch.org/search?query=${encodedQuery}&page=${page}`;
    case "tgramcat":
      return `https://tgramcat.com/search?search=${encodedQuery}&page=${page}`;
    case "tgramsearch":
      return `https://tgramsearch.com/search?query=${encodedQuery}&page=${page}`;
    case "waybien":
      return `https://waybien.com/en/search?q=${encodedQuery}&page=${(page - 1) * 10}`;
    case "lyzem":
      return `https://lyzem.com/search?q=${encodedQuery}&p=${page}&per-page=100&f=all`;
    default:
      return "";
  }
}

async function enrichTelegramPreview(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": CHROME_USER_AGENT }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Telegram preview HTTP ${response.status}`);
  const $ = cheerio.load(await response.text());
  
  let title = $("meta[property='og:title']").attr("content") || $(".tgme_page_title").text().trim();
  if (title.startsWith("Telegram: Contact @") || title.startsWith("Telegram: Join Group")) {
    title = url.replace("https://t.me/", "@");
  } else if (title.startsWith("Telegram: ")) {
    title = title.replace(/^Telegram:\s*/, "").trim();
  }

  let description = $("meta[property='og:description']").attr("content") || $(".tgme_page_description").text().trim();
  // Filter out Telegram's default placeholder texts
  if (/right away\.$/i.test(description) || /If you have Telegram/i.test(description) || /You can view and join/i.test(description)) {
    description = "";
  }

  let imageUrl = $("meta[property='og:image']").attr("content") || $(".tgme_page_photo_image img").attr("src") || null;
  // If Telegram returns default placeholder logo, treat as null so UI shows styled initials
  if (imageUrl && (imageUrl.includes("t_logo") || imageUrl.includes("telegram.org/img"))) {
    imageUrl = null;
  }

  const extra = $(".tgme_page_extra").text().trim();
  const actionText = $(".tgme_page_action").text().trim();
  const subscribers = extra.match(/[\d.,KMB]+\s+(?:subscribers|members|подписчиков|участников)/i)?.[0] || null;
  
  const titleLower = title.toLowerCase();
  const descLower = description.toLowerCase();
  const urlLower = url.toLowerCase();
  const actionLower = actionText.toLowerCase();
  const extraLower = extra.toLowerCase();
  
  let chatType = "unknown";
  
  if (urlLower.includes("+") || urlLower.includes("joinchat")) {
    chatType = "closed";
  } else if (urlLower.endsWith("_bot")) {
    chatType = "bot";
  } else if (actionLower.includes("send message")) {
    chatType = "contact";
  } else if (actionLower.includes("start bot")) {
    chatType = "bot";
  } else if (actionLower.includes("join group") || extraLower.includes("members") || extraLower.includes("участников") || extraLower.includes("online")) {
    chatType = "group";
  } else if (actionLower.includes("view channel") || extraLower.includes("subscribers") || extraLower.includes("подписчиков")) {
    chatType = "channel";
  } else {
    const groupKeywords = ["чат", "chat", "болталка", "беседка", "флудилка", "группа", "group", "клуб"];
    const channelKeywords = ["канал", "channel"];
    if (groupKeywords.some(kw => titleLower.includes(kw) || descLower.includes(kw) || urlLower.includes(kw))) {
      chatType = "group";
    } else if (channelKeywords.some(kw => titleLower.includes(kw) || descLower.includes(kw))) {
      chatType = "channel";
    }
  }

  return {
    title: title || url.replace("https://t.me/", "@"),
    description: description || "",
    imageUrl,
    subscribers,
    chatType
  };
}

function getBaseUrlForSource(source: string): string {
  switch (source) {
    case "tgsearch":
      return "https://tgsearch.org";
    case "tgramcat":
      return "https://tgramcat.com";
    case "tgramsearch":
      return "https://tgramsearch.com";
    case "waybien":
      return "https://waybien.com";
    case "lyzem":
      return "https://lyzem.com";
    default:
      return "";
  }
}

async function enrichResultsBatch(userId: number, searchId: number, items: any[]) {
  if (process.env.NODE_ENV === "test") return;
  for (const item of items) {
    if (!item.telegramUrl || item.imageUrl) continue;
    try {
      const url = normalizeTelegramLink(item.telegramUrl);
      if (!url) continue;
      const preview = await enrichTelegramPreview(url);
      const existing = db.prepare("SELECT id FROM search_results WHERE search_id=? AND dedup_key=?").get(searchId, resultKey(item)) as { id?: number } | undefined;
      if (existing?.id) {
        // Verify live preview against the user query (skip for imported channels)
        const searchRow = db.prepare("SELECT query, source FROM searches WHERE id=?").get(searchId) as { query: string; source: string } | undefined;
        if (searchRow?.query && searchRow.source !== "import") {
          const testItem = {
            title: preview.title,
            description: preview.description,
            username: item.username,
            subscribers: preview.subscribers,
            chatType: preview.chatType
          };
          const rel = calculateRelevance(testItem, searchRow.query);
          if (!rel.isRelevant) {
            db.prepare("DELETE FROM search_results WHERE id=?").run(existing.id);
            continue;
          }
        }

        updateResult(userId, existing.id, {
          title: preview.title,
          description: preview.description,
          imageUrl: preview.imageUrl,
          subscribers: preview.subscribers,
          chatType: preview.chatType
        });
      }
    } catch {}
  }
}

export async function runSearchJob(userId: number, searchId: number, input: { query: string; source: string; mode: "fast" | "ai"; limitPages: number }) {
  const { query, source, mode, limitPages } = input;
  if (activeSearches.has(userId)) throw new Error("A search is already running for this account.");
  activeSearches.add(userId);

  const existingSearch = getSearch(userId, searchId);
  const searchStats: Record<string, any> = existingSearch?.searchStats || {};
  const logs: string[] = existingSearch?.logs || [];

  function addLog(msg: string) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}`;
    logs.push(line);
    return line;
  }

  const rawQueries = query.split(/[,;\n]+/).map(q => q.trim()).filter(Boolean);
  const subQueries = rawQueries.length > 0 ? rawQueries : [query.trim()];

  const sources: string[] = [];
  if (source === "all") {
    sources.push("lyzem", "tglib", "catalogTelegram", "tgcat", "tgsearch", "tgramcat", "tgramsearch", "waybien");
    if (telegramConfigured()) sources.push("telegram");
  } else {
    sources.push(source);
  }

  addLog(`Starting automated deep search across sources: [${sources.join(", ")}] for [${subQueries.join(", ")}]...`);

  let searchFailed = false;
  let hasAnySuccess = false;

  // ── Phase 0: Instant results from global database cache ──
  if (source === "all" && process.env.NODE_ENV !== "test") {
    addLog(`[Global Base] Checking local database for existing channels matching: [${subQueries.join(", ")}]...`);
    const initialCached = searchCachedChannels(query, 50);
    if (initialCached.length > 0) {
      addLog(`[Global Base] Found ${initialCached.length} matching channels already in database. Loading instantly...`);
      const toSave = initialCached.map(c => ({
        title: c.title,
        description: c.description || "",
        subscribers: c.subscribers || null,
        detailUrl: c.detailUrl,
        imageUrl: c.imageUrl || null,
        source: c.source,
        telegramUrl: c.telegramUrl || null,
        username: c.username || null,
        channelDescription: c.channelDescription || null,
        stats: c.stats,
        extractionStatus: c.extractionStatus || "success",
        chatType: c.chatType || "unknown",
        error: null
      }));
      saveResults(searchId, toSave);
      hasAnySuccess = true;
    }
  }

  try {
    for (let qIdx = 0; qIdx < subQueries.length; qIdx++) {
      const q = subQueries[qIdx];

      for (let sIdx = 0; sIdx < sources.length; sIdx++) {
        const src = sources[sIdx];
        if (isSearchCancelRequested(searchId)) {
          addLog(`[Search] Cancel requested before source ${src}.`);
          completeSearch(searchId, userId, searchStats, logs, "cancelled");
          return;
        }

        if (searchStats[src]?.status === "completed") {
          addLog(`[Recovery] Skipping ${src} (already completed previously).`);
          hasAnySuccess = true;
          continue;
        }

        if (searchStats[src]?._completedQueries?.includes(q)) {
          addLog(`[Recovery] Skipping ${src} for "${q}" (already completed previously).`);
          hasAnySuccess = true;
          continue;
        }

        if (!searchStats[src]) {
          searchStats[src] = {
            pagesFetched: 0,
            totalFound: 0,
            tgLinksFound: 0,
            duplicatesFiltered: 0,
            uniqueAdded: 0,
            status: "running",
          };
        }

        let page = 1;
        let hasMore = true;
        const maxPages = src === "lyzem" ? Math.min(limitPages, 5) : limitPages;

        // Check if EXTRA_CATALOGS
        if (EXTRA_CATALOGS.includes(src)) {
          addLog(`[Pagination Engine] Commencing automated paging for ${src} (limit: ${maxPages} pages)`);
          while (hasMore && page <= maxPages) {
            if (isSearchCancelRequested(searchId)) {
              addLog(`[Search] Cancel requested during ${src}.`);
              completeSearch(searchId, userId, searchStats, logs, "cancelled");
              return;
            }
            touchSearch(searchId, Math.min(99, Math.round(((sIdx + (page - 1) / Math.max(maxPages, 1)) / sources.length) * 100)), src, searchStats, logs);
            try {
              addLog(`[Page] [${page}] Fetching ${src} for "${q}"...`);
              const abortController = new AbortController();
              const result = await searchContext.run({
                log: (m: string) => addLog(`[${src}] ${m}`),
                checkCancelled: () => {
                  if (isSearchCancelRequested(searchId)) throw new Error("Search was cancelled.");
                },
                signal: abortController.signal
              }, () => fetchCatalogPage(src, q, page));

              searchStats[src].pagesFetched++;
              searchStats[src].totalFound += result.results.length;

              const { relevant, discardedCount } = filterAndRankByRelevance(result.results, q);
              if (discardedCount > 0) {
                addLog(`[Relevance Engine] [${src}] Filtered out ${discardedCount} non-relevant channels for "${q}".`);
              }

              if (relevant.length > 0) {
                saveResults(searchId, relevant);
                searchStats[src].uniqueAdded += relevant.length;
                addLog(`[Page] [Saved] ${relevant.length} relevant channels from ${src} saved to database.`);
                hasAnySuccess = true;
                void enrichResultsBatch(userId, searchId, relevant.slice(0, 10));
              }
              hasMore = result.hasMore && result.results.length > 0;
              page++;
              touchSearch(searchId, Math.min(99, Math.round(((sIdx + page / Math.max(maxPages, 1)) / sources.length) * 100)), src, searchStats, logs);
            } catch (err: any) {
              if (isSearchCancelRequested(searchId)) {
                completeSearch(searchId, userId, searchStats, logs, "cancelled");
                return;
              }
              searchStats[src].status = "failed";
              searchStats[src].error = err.message;
              addLog(`[Error] ${src} (Page ${page}): ${err.message}`);
              hasMore = false;
              break;
            }
          }
          if (searchStats[src].status !== "failed") {
            searchStats[src]._completedQueries = searchStats[src]._completedQueries || [];
            if (!searchStats[src]._completedQueries.includes(q)) searchStats[src]._completedQueries.push(q);
            if (subQueries.every(sq => searchStats[src]._completedQueries.includes(sq))) {
              searchStats[src].status = "completed";
            }
          }
          continue;
        }

        // Check if telegram
        if (src === "telegram") {
          addLog(`[Telegram] Commencing MTProto discovery for "${q}"...`);
          try {
            searchStats[src].pagesFetched = 1;
            const tgResults = await searchTelegram(q);
            searchStats[src].totalFound = tgResults.length;
            const { relevant, discardedCount } = filterAndRankByRelevance(tgResults, q);
            if (discardedCount > 0) {
              addLog(`[Relevance Engine] [Telegram] Filtered out ${discardedCount} non-relevant channels for "${q}".`);
            }
            if (relevant.length > 0) {
              saveResults(searchId, relevant);
              searchStats[src].uniqueAdded += relevant.length;
              addLog(`[Saved] ${relevant.length} channels from Telegram saved to database.`);
              hasAnySuccess = true;
            }
            searchStats[src]._completedQueries = searchStats[src]._completedQueries || [];
            if (!searchStats[src]._completedQueries.includes(q)) searchStats[src]._completedQueries.push(q);
            if (subQueries.every(sq => searchStats[src]._completedQueries.includes(sq))) {
              searchStats[src].status = "completed";
            }
          } catch (err: any) {
            searchStats[src].status = "failed";
            searchStats[src].error = err.message;
            addLog(`[Error] Telegram discovery: ${err.message}`);
          }
          continue;
        }

        // Standard catalogs
        let sourceUnavailable = false;
        let consecutiveEmptyPages = 0;
        const batchSize = 5;
        const seenTitlesAndUrls = new Set<string>();

        let sessionCookie = "";
        if (src === "tgramsearch") {
          sessionCookie = await fetchSessionCookie(getBaseUrlForSource(src), logs);
          addLog(sessionCookie
            ? `[Session] tgramsearch: session cookie acquired from homepage warmup.`
            : `[Session] tgramsearch: homepage warmup returned no cookie — proceeding without one.`);
        }
        const srcExtraHeaders: Record<string, string> = src === "tgramsearch"
          ? { Referer: `${getBaseUrlForSource(src)}/`, ...(sessionCookie ? { Cookie: sessionCookie } : {}) }
          : {};

        addLog(`[Pagination Engine] Commencing automated paging for ${src} (limit: ${maxPages} pages)`);

        while (hasMore && page <= maxPages) {
          if (isSearchCancelRequested(searchId)) {
            addLog(`[Search] Cancel requested during ${src}.`);
            completeSearch(searchId, userId, searchStats, logs, "cancelled");
            return;
          }

          touchSearch(searchId, Math.min(99, Math.round(((sIdx + (page - 1) / Math.max(maxPages, 1)) / sources.length) * 100)), src, searchStats, logs);
          const batchPages: number[] = [];
          for (let i = 0; i < batchSize && (page + i) <= maxPages; i++) {
            batchPages.push(page + i);
          }

          addLog(`[Scanning] ${src} — pages ${batchPages[0]}–${batchPages[batchPages.length - 1]} of ~${maxPages}...`);

          try {
            let newResultsInBatchCount = 0;
            let allPagesInBatchEmpty = true;
            for (let idx = 0; idx < batchPages.length; idx++) {
              if (isSearchCancelRequested(searchId)) {
                addLog(`[Search] Cancel requested.`);
                return;
              }
              const p = batchPages[idx];
              addLog(`[Page] [${p}] Scanning ${src}...`);
              touchSearch(searchId, Math.min(99, Math.round(((sIdx + (p - 1) / Math.max(maxPages, 1)) / sources.length) * 100)), src, searchStats, logs);
              if (idx > 0) {
                await new Promise((resolve) => setTimeout(resolve, 250));
              }
              const searchUrl = getSearchUrlForSource(src, q, p);
              if (!searchUrl) {
                continue;
              }

              try {
                const html = await fetchWithHeaders(searchUrl, src === "waybien" ? 0 : 2, 1000, srcExtraHeaders, src === "waybien" ? 8000 : 15000);
                const baseUrl = getBaseUrlForSource(src);
                let parsedResults: any[] = [];

                if (mode === "fast") {
                  parsedResults = parseWithSelectors(html, src, baseUrl);
                  if (parsedResults.length === 0 && p === 1 && process.env.GEMINI_API_KEY) {
                    addLog(`[Fallback] Page 1 selectors empty on ${src}. Trying smart AI parser...`);
                    try {
                      parsedResults = await parseWithAI(html, src, q);
                    } catch (aiErr: any) {
                      addLog(`[Fallback Warning] Gemini AI failed: ${aiErr.message || aiErr}`);
                    }
                  }
                } else {
                  try {
                    parsedResults = await parseWithAI(html, src, q);
                  } catch (aiErr: any) {
                    addLog(`[AI Error] Gemini AI failed on page ${p}: ${aiErr.message || aiErr}`);
                  }
                }

                if (src === "tgramsearch" && parsedResults.length > 0) {
                  const chunkSize = 5;
                  for (let i = 0; i < parsedResults.length; i += chunkSize) {
                    const chunk = parsedResults.slice(i, i + chunkSize);
                    await Promise.all(chunk.map(async (r: any) => {
                      if (r.detailUrl && r.detailUrl.includes("/join/")) {
                        try {
                          const controller = new AbortController();
                          const timeoutId = setTimeout(() => controller.abort(), 5000);
                          const detRes = await fetch(r.detailUrl, {
                            headers: { "User-Agent": CHROME_USER_AGENT, ...srcExtraHeaders },
                            signal: controller.signal
                          });
                          clearTimeout(timeoutId);
                          if (detRes.ok) {
                            const dhtml = await detRes.text();
                            const $d = cheerio.load(dhtml);
                            let btnHref: string | undefined;
                            $d("a").each((_, el) => {
                              const href = $d(el).attr("href") || "";
                              if (href.startsWith("tg://resolve?domain=") || href.startsWith("tg://join?invite=")) {
                                btnHref = href;
                                return false;
                              }
                            });
                            if (btnHref) {
                              r.telegramUrl = btnHref;
                              r.extractionStatus = "success";
                              if (btnHref.includes("resolve?domain=")) r.username = btnHref.split("domain=")[1];
                              else if (btnHref.includes("join?invite=")) r.username = btnHref.split("invite=")[1];
                            }
                          }
                        } catch {}
                      }
                    }));
                  }
                }

                if (src === "tgsearch" && parsedResults.length > 0) {
                  const chunkSize = 5;
                  for (let i = 0; i < parsedResults.length; i += chunkSize) {
                    const chunk = parsedResults.slice(i, i + chunkSize);
                    await Promise.all(chunk.map(async (r: any) => {
                      if (r.detailUrl && r.detailUrl.includes("/channel/")) {
                        try {
                          const controller = new AbortController();
                          const timeoutId = setTimeout(() => controller.abort(), 5000);
                          const detRes = await fetch(r.detailUrl, {
                            headers: { "User-Agent": CHROME_USER_AGENT },
                            signal: controller.signal
                          });
                          clearTimeout(timeoutId);
                          if (detRes.ok) {
                            const dhtml = await detRes.text();
                            const $d = cheerio.load(dhtml);
                            const titleLink = $d(".channel-detail__title a").attr("href") || "";
                            if (titleLink.startsWith("tg://")) {
                              r.telegramUrl = titleLink;
                              r.extractionStatus = "success";
                              if (titleLink.includes("domain=")) r.username = titleLink.split("domain=")[1];
                              else if (titleLink.includes("invite=")) r.username = titleLink.split("invite=")[1];
                            }
                          }
                        } catch {}
                      }
                    }));
                  }
                }

                if (src === "tgramcat" && parsedResults.length > 0) {
                  const chunkSize = 5;
                  for (let i = 0; i < parsedResults.length; i += chunkSize) {
                    const chunk = parsedResults.slice(i, i + chunkSize);
                    await Promise.all(chunk.map(async (r: any) => {
                      if (r.detailUrl && r.detailUrl.includes("/channel/")) {
                        try {
                          const controller = new AbortController();
                          const timeoutId = setTimeout(() => controller.abort(), 5000);
                          const detRes = await fetch(r.detailUrl, {
                            headers: { "User-Agent": CHROME_USER_AGENT },
                            signal: controller.signal
                          });
                          clearTimeout(timeoutId);
                          if (detRes.ok) {
                            const dhtml = await detRes.text();
                            const tMeMatch = dhtml.match(/href="(https?:\/\/t\.me\/[a-zA-Z0-9_+]+)"/i);
                            if (tMeMatch) {
                              r.telegramUrl = tMeMatch[1];
                              r.extractionStatus = "success";
                              const userMatch = tMeMatch[1].match(/t\.me\/([a-zA-Z0-9_]+)/i);
                              if (userMatch) r.username = userMatch[1];
                            }
                          }
                        } catch {}
                      }
                    }));
                  }
                }

                let rawCardCount = parsedResults.length;
                if (html) {
                  const $ = cheerio.load(html);
                  let cardSelector = ".search-result, .card, .channel-card, .search-item, .list-group-item, .tg-channel, .main-search-button-result-item, .main-search-button-result-item-wrapper";
                  if (src === "lyzem") cardSelector = ".search-result";
                  else if (src === "tgramsearch") cardSelector = ".tg-channel";
                  else if (src === "tgramcat") cardSelector = ".col:has(a[href^='/channel/'])";
                  rawCardCount = Math.max(parsedResults.length, $(cardSelector).length);
                }

                searchStats[src].pagesFetched++;
                if (searchStats[src].rawCardsFound === undefined) searchStats[src].rawCardsFound = 0;
                searchStats[src].rawCardsFound += rawCardCount;
                searchStats[src].totalFound += parsedResults.length;

                const tgLinksCount = parsedResults.filter((r: any) =>
                  r.telegramUrl && (r.telegramUrl.includes("t.me") || r.telegramUrl.includes("telegram.me") || r.telegramUrl.includes("tgramsearch.com/join/") || r.telegramUrl.startsWith("tg://"))
                ).length;
                searchStats[src].tgLinksFound = (searchStats[src].tgLinksFound || 0) + tgLinksCount;

                const pageAddedResults: any[] = [];
                for (const item of parsedResults) {
                  let dupKey = "";
                  if (item.username) dupKey = `user:${item.username.toLowerCase()}`;
                  else if (item.telegramUrl) {
                    const m = item.telegramUrl.match(/(?:t\.me|telegram\.me|domain=|invite=)([a-zA-Z0-9_+-]+)/i);
                    dupKey = m ? `link:${m[1].toLowerCase()}` : `url:${item.telegramUrl.toLowerCase()}`;
                  } else if (item.detailUrl) dupKey = `detail:${item.detailUrl.toLowerCase()}`;
                  else dupKey = `title:${item.title.toLowerCase()}`;

                  if (!seenTitlesAndUrls.has(dupKey)) {
                    seenTitlesAndUrls.add(dupKey);
                    pageAddedResults.push(item);
                  } else {
                    searchStats[src].duplicatesFiltered++;
                  }
                }

                if (pageAddedResults.length > 0) {
                  const { relevant, discardedCount } = filterAndRankByRelevance(pageAddedResults, q);
                  if (discardedCount > 0) {
                    addLog(`[Relevance Engine] Filtered out ${discardedCount} non-relevant channels on ${src}.`);
                  }
                  if (relevant.length > 0) {
                    saveResults(searchId, relevant);
                    newResultsInBatchCount += relevant.length;
                    searchStats[src].uniqueAdded += relevant.length;
                    hasAnySuccess = true;
                    addLog(`[Page] [Saved] ${relevant.length} highly relevant channels saved from ${src}.`);
                    void enrichResultsBatch(userId, searchId, relevant.slice(0, 10));
                  }
                } else if (rawCardCount === 0) {
                  consecutiveEmptyPages++;
                  addLog(`[Page] [${p}] empty (${consecutiveEmptyPages} consecutive empty)`);
                } else {
                  addLog(`[Page] [${p}] ${src}: all results are duplicates`);
                }

                if (rawCardCount > 0) {
                  consecutiveEmptyPages = 0;
                  allPagesInBatchEmpty = false;
                }

                touchSearch(searchId, Math.min(99, Math.round(((sIdx + p / Math.max(maxPages, 1)) / sources.length) * 100)), src, searchStats, logs);
              } catch (err: any) {
                addLog(`[Error] ${src} (Page ${p}): ${err.message}`);
                if (src === "waybien" || src === "tgramsearch" || /UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|timeout|timed out|Failed to fetch/i.test(err.message)) {
                  addLog(`[Offline] ${src} appears to be unreachable. Skipping remaining pages.`);
                  sourceUnavailable = true;
                  break;
                }
              }
              if (isSearchCancelRequested(searchId)) {
                addLog(`[Search] Cancel requested.`);
                return;
              }
            }

            addLog(`[Scanning] ${src} batch done: +${newResultsInBatchCount} new, ${searchStats[src].duplicatesFiltered} dupes removed (total: ${searchStats[src].uniqueAdded})`);

            if (sourceUnavailable) {
              addLog(`[Scanning] ${src}: source unavailable; skipping remaining pages.`);
              hasMore = false;
              searchStats[src].error = "Source unavailable";
              searchStats[src].status = "failed";
            } else if (consecutiveEmptyPages >= 3 || allPagesInBatchEmpty) {
              addLog(`[Scanning] ${src}: end of directory reached (3+ empty pages). Stopping.`);
              hasMore = false;
            } else if (newResultsInBatchCount === 0 && !allPagesInBatchEmpty) {
              addLog(`[Scanning] ${src}: only duplicates in batch. End of unique content. Stopping.`);
              hasMore = false;
            } else {
              page += batchSize;
            }
          } catch (batchErr: any) {
            addLog(`[Error] Batch starting at page ${page} failed: ${batchErr.message}`);
            hasMore = false;
          }
        }

        if (searchStats[src].status !== "failed") {
          searchStats[src]._completedQueries = searchStats[src]._completedQueries || [];
          if (!searchStats[src]._completedQueries.includes(q)) searchStats[src]._completedQueries.push(q);
          if (subQueries.every(sq => searchStats[src]._completedQueries.includes(sq))) {
            searchStats[src].status = "completed";
          }
        }
      }
    }
  } catch (fatalErr: any) {
    console.error(`[Fatal] /api/search crashed while processing sources:`, fatalErr);
    searchFailed = true;
    addLog(`[Fatal Error] Search crashed: ${fatalErr.message || fatalErr}. Returning partial results collected so far.`);
  } finally {
    const isCancelled = isSearchCancelRequested(searchId);
    const currentStatus = getSearchStatus(userId, searchId)?.status;
    if (isCancelled || currentStatus === "cancelled") {
      completeSearch(searchId, userId, searchStats, logs, "cancelled");
    } else {
      const allFailed = Object.values(searchStats).length > 0 && Object.values(searchStats).every((s: any) => s.status === "failed");
      const finalStatus = searchFailed || allFailed ? "failed" : "completed";
      completeSearch(searchId, userId, searchStats, logs, finalStatus, searchFailed ? "Search worker failed." : (allFailed ? "All sources failed." : null));
    }
    activeSearches.delete(userId);
    activeGlobalJobCount = Math.max(0, activeGlobalJobCount - 1);
    startQueuedSearches();
  }
}

export function startQueuedSearches() {
  while (activeGlobalJobCount < MAX_GLOBAL_CONCURRENT_SEARCHES) {
    const queued = listQueuedSearches();
    const next = queued.find(j => !activeSearches.has(j.user_id));
    if (!next) break;
    if (!claimSearch(next.id)) continue;
    activeGlobalJobCount++;
    void runSearchJob(next.user_id, next.id, { query: next.query, source: next.source, mode: next.mode, limitPages: next.limit_pages })
      .catch((error: any) => completeSearch(next.id, next.user_id, {}, [`[${new Date().toISOString()}] [Fatal Error] ${error.message}`], "failed", error.message));
  }
}

// Endpoint to Search Catalogs
app.post("/api/search", requireUser, (req: AuthenticatedRequest, res: express.Response) => {
  let input: { query: string; source: string; mode: "fast" | "ai"; limitPages: number };
  try { input = safeSearchInput(req.body); } catch (error: any) {
    res.status(400).json({ error: error.message });
    return;
  }
  const requestId = typeof req.body?.requestId === "string" ? req.body.requestId.slice(0, 100) : undefined;
  const searchId = createSearch(req.user!.id, { ...input, requestId });
  const status = getSearchStatus(req.user!.id, searchId)!;
  if (status.status === "queued" && activeGlobalJobCount < MAX_GLOBAL_CONCURRENT_SEARCHES && !activeSearches.has(req.user!.id)) {
    if (claimSearch(searchId)) {
      activeGlobalJobCount++;
      void (async () => {
        try {
          await runSearchJob(req.user!.id, searchId, input);
        } catch (error: any) {
          console.error(`[Worker] Search ${searchId} failed before execution:`, error);
          completeSearch(searchId, req.user!.id, {}, [`[${new Date().toISOString()}] [Fatal Error] ${error.message}`], "failed", error.message);
        }
      })();
    }
  } else if (status.status === "queued") {
    startQueuedSearches();
  }
  const currentStatus = getSearchStatus(req.user!.id, searchId)!;
  res.status(202).json({ searchId: String(searchId), status: currentStatus.status });
});

app.get("/api/searches/:id/status", requireUser, (req: AuthenticatedRequest, res) => {
  const status = getSearchStatus(req.user!.id, Number(req.params.id));
  if (!status) return res.status(404).json({ error: "Search was not found." });
  res.json(status);
});

app.post("/api/searches/:id/cancel", requireUser, (req: AuthenticatedRequest, res) => {
  if (!requestSearchCancel(req.user!.id, Number(req.params.id))) return res.status(404).json({ error: "Active search was not found." });
  res.status(202).json({ status: "cancelling" });
});

// Gemini-powered search scraper parser
async function parseWithAI(html: string, source: string, query: string): Promise<any[]> {
  const cleaned = cleanHtmlForAI(html);
  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are an expert AI scraper. Analyze this cleaned HTML of a Telegram catalog search result for "${query}".
Extract all listed channel/group cards.

Output must be a JSON array containing objects matching this schema:
{
  "title": "Channel/Group Name",
  "description": "Short description snippet, tags, category or other context",
  "subscribers": "Subscriber count (e.g., '14.2k' or '5 000') or null if not shown",
  "detailUrl": "Absolute or relative link to this channel's detailed page inside the directory",
  "imageUrl": "Avatar/cover image URL or null if not shown",
  "source": "${source}"
}

Cleaned HTML content:
${cleaned}

Return ONLY the raw JSON array. Do not put markdown blocks or any conversational text around it.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            subscribers: { type: Type.STRING },
            detailUrl: { type: Type.STRING },
            imageUrl: { type: Type.STRING },
            source: { type: Type.STRING },
          },
          required: ["title", "detailUrl", "source"],
        },
      },
    },
  });

  const text = response.text?.trim() || "[]";
  try {
    const rawResults = JSON.parse(text);
    const baseUrl = getBaseUrlForSource(source);
    return rawResults.map((item: any) => {
      const detailUrl = item.detailUrl ? (item.detailUrl.startsWith("http") ? item.detailUrl : new URL(item.detailUrl, baseUrl).toString()) : "";
      const imageUrl = item.imageUrl ? (item.imageUrl.startsWith("http") ? item.imageUrl : (item.imageUrl.startsWith("/") ? new URL(item.imageUrl, baseUrl).toString() : item.imageUrl)) : null;
      const deduced = deduceTelegramUrl(detailUrl, item.title, item.description || "");
      const finalTelegramUrl = item.telegramUrl || deduced.telegramUrl;
      return {
        ...item,
        detailUrl,
        imageUrl,
        telegramUrl: finalTelegramUrl,
        username: item.username || deduced.username,
        extractionStatus: item.telegramUrl ? "success" : (deduced.telegramUrl ? "guessed" : "pending"),
        chatType: detectChatType(finalTelegramUrl, item.title, item.description || "", detailUrl, item.subscribers || null)
      };
    });
  } catch (err) {
    console.error("Failed to parse Gemini JSON search results:", err, text);
    return [];
  }
}

// Endpoint to Extract Telegram Links
app.post("/api/extract-link", requireUser, async (req: AuthenticatedRequest, res: express.Response) => {
  const resultId = Number(req.body?.resultId);
  const existing = Number.isInteger(resultId) ? getResult(req.user!.id, resultId) : null;
  if (!existing) {
    res.status(404).json({ error: "Saved result was not found." });
    return;
  }
  const { detailUrl } = existing;
  const mode = req.body?.mode === "ai" ? "ai" : "fast";

  const logs: string[] = [`Extracting direct Telegram link for: ${detailUrl}`];

  try {
    const html = await fetchWithHeaders(detailUrl);
    let result: any = null;

    if (mode === "fast") {
      logs.push("Parsing detail page with regex & CSS selectors (Fast Mode)");
      result = extractLinkWithSelectors(html);

      if ((!result || !result.telegramUrl) && process.env.GEMINI_API_KEY) {
        logs.push("Selector parse failed or returned empty. Auto-falling back to AI extraction");
        try {
          result = await extractLinkWithAI(html);
        } catch (aiErr: any) {
          console.error("Gemini API error during fallback link extraction:", aiErr);
          logs.push(`[AI Extraction Fallback Warning] Gemini AI failed (e.g., 503 high demand): ${aiErr.message || aiErr}`);
        }
      }
    } else {
      logs.push("Parsing detail page using Gemini AI (AI Scraper Mode)");
      try {
        result = await extractLinkWithAI(html);
      } catch (aiErr: any) {
        console.error("Gemini API error during AI link extraction:", aiErr);
        logs.push(`[AI Extraction Error] Gemini AI failed (e.g., 503 high demand): ${aiErr.message || aiErr}`);
      }
    }

    const similarChannels = extractSimilarChannelsFromHtml(html, detailUrl);
    const resolvedUrl = normalizeTelegramLink(result?.telegramUrl) || normalizeTelegramLink(existing.telegramUrl);
    const resolvedUsername = resolvedUrl && !resolvedUrl.includes("/+") ? resolvedUrl.split("/").pop() : null;
    let preview: any = null;
    if (resolvedUrl) {
      try { preview = await enrichTelegramPreview(resolvedUrl); logs.push("Telegram preview: metadata updated."); }
      catch (previewError: any) { logs.push(`Telegram preview unavailable: ${previewError.message}`); }
    }
    const savedResult = updateResult(req.user!.id, resultId, {
      title: preview?.title || existing.title,
      description: preview?.description || result?.channelDescription || existing.description,
      imageUrl: preview?.imageUrl || existing.imageUrl || null,
      subscribers: preview?.subscribers || existing.subscribers || null,
      chatType: preview?.chatType || existing.chatType || "unknown",
      telegramUrl: resolvedUrl || existing.telegramUrl || null,
      username: resolvedUsername || result?.username || existing.username || null,
      channelDescription: result?.channelDescription || null,
      stats: result?.stats || null,
      similarChannels,
      extractionStatus: resolvedUrl ? "success" : "failed",
      error: resolvedUrl ? null : "No link found on page",
    });
    res.json({
      success: !!result?.telegramUrl,
      result: savedResult,
      logs,
    });
  } catch (err: any) {
    console.error(`Error extracting link for ${detailUrl}:`, err);
    res.status(500).json({ error: err.message, logs });
  }
});

// Robust Regex + Selector based Telegram link extractor
function extractLinkWithSelectors(html: string): { telegramUrl: string | null; username: string | null; channelDescription: string | null; stats: any } {
  const $ = cheerio.load(html);
  
  // 1. Try to find links matching Telegram patterns: t.me, tg://, telegram.me
  const tgPatterns = [
    /https?:\/\/t\.me\/[a-zA-Z0-9_+]{3,}/i,
    /https?:\/\/telegram\.me\/[a-zA-Z0-9_+]{3,}/i,
    /tg:\/\/resolve\?domain=[a-zA-Z0-9_+]{3,}/i,
    /tg:\/\/join\?invite=[a-zA-Z0-9_+]+/i
  ];

  let telegramUrl: string | null = null;
  let username: string | null = null;

  // Search in all hrefs
  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    for (const pat of tgPatterns) {
      if (pat.test(href)) {
        telegramUrl = href;
        break;
      }
    }
    if (telegramUrl) return false; // break loop
  });

  // 2. If not found in anchors, do a global body text regex match
  if (!telegramUrl) {
    const bodyText = $("body").text();
    const tMeMatch = bodyText.match(/t\.me\/([a-zA-Z0-9_]{3,})/i);
    if (tMeMatch) {
      username = tMeMatch[1];
      telegramUrl = `https://t.me/${username}`;
    }
  }

  // 3. Extract username from telegram URL if we have one
  if (telegramUrl && !username) {
    const match = telegramUrl.match(/(?:t\.me|telegram\.me|domain=)\/([a-zA-Z0-9_]{3,})/i) || telegramUrl.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{3,})/i);
    if (match) {
      username = match[1];
    }
  }

  // 4. Try to get metadata description or core detail text
  const channelDescription = $("meta[name='description']").attr("content") || $(".channel-description, .description, .desc, p").first().text().trim() || null;

  // 5. Gather statistics if available
  const stats: any = {};
  $("[class*='stat'], [class*='info'], td, li").each((_, el) => {
    const text = $(el).text().trim();
    if (text.includes(":") || text.match(/\d+/)) {
      const parts = text.split(":");
      if (parts.length === 2) {
        const key = parts[0].trim();
        const val = parts[1].trim();
        if (key.length < 30 && val.length < 50) {
          stats[key] = val;
        }
      }
    }
  });

  return {
    telegramUrl,
    username,
    channelDescription,
    stats: Object.keys(stats).length > 0 ? stats : null,
  };
}

// AI-powered Telegram link extractor
async function extractLinkWithAI(html: string): Promise<any> {
  const cleaned = cleanHtmlForAI(html);
  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are a precise AI web scraper. Your job is to extract the direct Telegram channel/group subscription/joining link from this catalog detail page.
Look for any t.me links, telegram.me links, or tg:// links, or extract the channel's username.

Output must be a JSON object matching this schema:
{
  "telegramUrl": "Direct Telegram link (e.g. 'https://t.me/username' or 'tg://resolve?domain=username') or null if not found",
  "username": "The username of the channel or null if not found",
  "channelDescription": "Brief description of the channel from this page, or null",
  "stats": {
    "subscribers": "Number of subscribers if shown, or null",
    "additionalInfo": "Any other helpful statistics extracted, or null"
  }
}

Page Content:
${cleaned}

Return ONLY the raw JSON object. Do not wrap in markdown or any conversational text.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          telegramUrl: { type: Type.STRING },
          username: { type: Type.STRING },
          channelDescription: { type: Type.STRING },
          stats: {
            type: Type.OBJECT,
            properties: {
              subscribers: { type: Type.STRING },
              additionalInfo: { type: Type.STRING },
            },
          },
        },
      },
    },
  });

  const text = response.text?.trim() || "{}";
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("Failed to parse Gemini detail extraction:", err, text);
    return null;
  }
}

function extractSimilarChannelsFromHtml(html: string, detailUrl: string): any[] {
  const $ = cheerio.load(html);
  const similarChannels: any[] = [];
  
  // Generic card scanners
  const cardSels = [".channel-card", ".tg-channel", ".search-result", ".catalog-item", ".similar-channel", ".related-item"];
  
  cardSels.forEach(sel => {
    $(sel).each((_, cardEl) => {
      const $card = $(cardEl);
      const $link = $card.find("a").filter((_, aEl) => {
        const href = $(aEl).attr("href") || "";
        return href.includes("/channel/") || href.includes("/details/") || href.includes("/join/") || href.includes("t.me/");
      }).first();
      
      if ($link.length > 0) {
        const rawHref = $link.attr("href") || "";
        // Resolve URL relative to the current detail page
        let resolved = rawHref;
        if (!rawHref.startsWith("http")) {
          try {
            resolved = new URL(rawHref, detailUrl).toString();
          } catch (e) {
            resolved = rawHref;
          }
        }
        
        if (resolved && resolved !== detailUrl) {
          const title = $card.find("h3, h4, h5, h2, .title, .name, strong, .search_title, .channel-title, .tg-channel__link, .tg-channel__info, .search-result-title").first().text().trim() || $link.text().trim();
          const subs = $card.find(".subscribers, .subs, .members, .count, .tg-stat__user-count, [class*='subscribers']").first().text().trim() || null;
          if (title && !similarChannels.some(sc => sc.detailUrl === resolved)) {
            similarChannels.push({
              title,
              detailUrl: resolved,
              subscribers: subs || null
            });
          }
        }
      }
    });
  });

  // If we found none, check headings containing similar/related/recommend
  if (similarChannels.length === 0) {
    $("h1, h2, h3, h4, h5, .title, strong").each((_, headingEl) => {
      const text = $(headingEl).text().toLowerCase();
      if (text.includes("similar") || text.includes("related") || text.includes("похож") || text.includes("рекоменд") || text.includes("recom")) {
        // Find links in parent or siblings
        const $container = $(headingEl).parent();
        $container.find("a").each((_, aEl) => {
          const href = $(aEl).attr("href") || "";
          const title = $(aEl).text().trim();
          if (title && (href.includes("/channel/") || href.includes("/details/") || href.includes("/join/") || href.includes("t.me/"))) {
            let resolved = href;
            if (!href.startsWith("http")) {
              try {
                resolved = new URL(href, detailUrl).toString();
              } catch (e) {
                resolved = href;
              }
            }
            if (resolved && resolved !== detailUrl && !similarChannels.some(sc => sc.detailUrl === resolved)) {
              similarChannels.push({
                title,
                detailUrl: resolved,
                subscribers: null
              });
            }
          }
        });
      }
    });
  }

  return similarChannels;
}

function runStartupHeuristics() {
  try {
    // Purge all bots from channels and search_results tables
    db.prepare(`DELETE FROM channels WHERE 
      chat_type = 'bot' 
      OR telegram_url LIKE '%_bot' 
      OR username LIKE '%_bot' 
      OR LOWER(telegram_url) GLOB '*bot' 
      OR LOWER(username) GLOB '*bot'
      OR LOWER(title) GLOB '* bot'
      OR LOWER(title) LIKE 'telegram: contact @%bot'
    `).run();

    db.prepare(`DELETE FROM search_results WHERE 
      chat_type = 'bot' 
      OR telegram_url LIKE '%_bot' 
      OR username LIKE '%_bot' 
      OR LOWER(telegram_url) GLOB '*bot' 
      OR LOWER(username) GLOB '*bot'
      OR LOWER(title) GLOB '* bot'
      OR LOWER(title) LIKE 'telegram: contact @%bot'
    `).run();

    db.prepare("UPDATE channels SET chat_type = 'closed' WHERE (chat_type = 'unknown' OR chat_type IS NULL) AND (telegram_url LIKE '%+%' OR telegram_url LIKE '%/joinchat/%')").run();
    db.prepare("UPDATE channels SET chat_type = 'group' WHERE (chat_type = 'unknown' OR chat_type IS NULL) AND (LOWER(title) LIKE '%чат%' OR LOWER(title) LIKE '%chat%' OR LOWER(title) LIKE '%группа%' OR LOWER(title) LIKE '%group%' OR LOWER(title) LIKE '%беседка%' OR LOWER(title) LIKE '%болталка%' OR LOWER(telegram_url) LIKE '%chat%' OR LOWER(telegram_url) LIKE '%group%')").run();
    db.prepare("UPDATE channels SET chat_type = 'channel' WHERE (chat_type = 'unknown' OR chat_type IS NULL) AND (LOWER(title) LIKE '%канал%' OR LOWER(title) LIKE '%channel%')").run();

    db.prepare("UPDATE search_results SET chat_type = 'closed' WHERE (chat_type = 'unknown' OR chat_type IS NULL) AND (telegram_url LIKE '%+%' OR telegram_url LIKE '%/joinchat/%')").run();
    db.prepare("UPDATE search_results SET chat_type = 'group' WHERE (chat_type = 'unknown' OR chat_type IS NULL) AND (LOWER(title) LIKE '%чат%' OR LOWER(title) LIKE '%chat%' OR LOWER(title) LIKE '%группа%' OR LOWER(title) LIKE '%group%' OR LOWER(title) LIKE '%беседка%' OR LOWER(title) LIKE '%болталка%' OR LOWER(telegram_url) LIKE '%chat%' OR LOWER(telegram_url) LIKE '%group%')").run();
    db.prepare("UPDATE search_results SET chat_type = 'channel' WHERE (chat_type = 'unknown' OR chat_type IS NULL) AND (LOWER(title) LIKE '%канал%' OR LOWER(title) LIKE '%channel%')").run();
  } catch (e) {
    console.warn("[Heuristics] Startup notice:", e);
  }
}

// ---------------- SERVER AND VITE DEV SETUP ----------------

async function startServer() {
  await bootstrapOwner();
  runStartupHeuristics();
  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

if (process.env.NODE_ENV !== "test") {
  startServer();
}
