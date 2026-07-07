import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import * as cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

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
    if (!excluded.includes(username.toLowerCase())) {
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

  // Generic card scanners
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

// Helper to make a fetch request with randomized mobile/desktop browser headers and automatic retry
async function fetchWithHeaders(url: string, retries = 2, delayMs = 1000): Promise<string> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
  };

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
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
      console.warn(`[Fetch Attempt ${attempt}/${retries + 1}] Failed for ${url}: ${error.message}`);
      if (attempt <= retries) {
        await new Promise(r => setTimeout(r, delayMs * attempt));
      } else {
        throw new Error(`Failed to fetch page content after ${retries + 1} attempts: ${error.message}`);
      }
    }
  }
  throw new Error("Failed to fetch page content: unknown error");
}

// ---------------- API ENDPOINTS ----------------

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

// Get the base URL for a given source
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

// Endpoint to Search Catalogs
app.post("/api/search", async (req: express.Request, res: express.Response) => {
  const { query, source = "all", mode = "fast", limitPages } = req.body;

  if (!query) {
    res.status(400).json({ error: "Search query is required." });
    return;
  }

  const sources: string[] = [];
  if (source === "all") {
    sources.push("tgsearch", "tgramcat", "tgramsearch", "waybien", "lyzem");
  } else {
    sources.push(source);
  }

  const results: any[] = [];
  const logs: string[] = [];
  const searchStats: Record<string, { pagesFetched: number; totalFound: number; tgLinksFound?: number; rawCardsFound?: number; duplicatesFiltered: number; uniqueAdded: number }> = {};

  logs.push(`Starting automated deep search across sources: [${sources.join(", ")}] for "${query}"...`);

  for (const src of sources) {
    searchStats[src] = {
      pagesFetched: 0,
      totalFound: 0,
      tgLinksFound: 0,
      duplicatesFiltered: 0,
      uniqueAdded: 0
    };
    let page = 1;
    let hasMore = true;
    let consecutiveEmptyPages = 0;
    const batchSize = 5; // Parallel/sequential stagger batch size to stay fast but be respectful
    const maxPages = limitPages ? parseInt(limitPages as string, 10) : 500; // Customizable limit, default to 500
    const seenTitlesAndUrls = new Set<string>();

    logs.push(`[Pagination Engine] Commencing automated paging for ${src} (limit: ${maxPages} pages)`);

    while (hasMore && page <= maxPages) {
      const batchPages: number[] = [];
      for (let i = 0; i < batchSize && (page + i) <= maxPages; i++) {
        batchPages.push(page + i);
      }

      logs.push(`[Pagination Engine] Fetching ${src} batch: pages ${batchPages.join(", ")}`);

      try {
        const batchResults: any[] = [];
        // Stagger requests within the batch sequentially with a tiny sleep to be extremely friendly and bypass rate-limiters
        for (let idx = 0; idx < batchPages.length; idx++) {
          const p = batchPages[idx];
          if (idx > 0) {
            await new Promise((resolve) => setTimeout(resolve, 250)); // 250ms stagger delay
          }
          const searchUrl = getSearchUrlForSource(src, query, p);
          if (!searchUrl) {
            batchResults.push({ page: p, results: [] });
            continue;
          }

          try {
            const html = await fetchWithHeaders(searchUrl, 2, 1000); // 2 retries with 1000ms delay
            const baseUrl = getBaseUrlForSource(src);
            let parsedResults: any[] = [];

            if (mode === "fast") {
              parsedResults = parseWithSelectors(html, src, baseUrl);
              
              if (parsedResults.length === 0 && p === 1 && process.env.GEMINI_API_KEY) {
                logs.push(`[Fallback] Page 1 selectors empty on ${src}. Trying smart AI parser...`);
                try {
                  parsedResults = await parseWithAI(html, src, query);
                } catch (aiErr: any) {
                  console.error("Gemini API error during fallback parsing:", aiErr);
                  logs.push(`[Fallback Warning] Gemini AI failed: ${aiErr.message || aiErr}`);
                }
              }
            } else {
              try {
                parsedResults = await parseWithAI(html, src, query);
              } catch (aiErr: any) {
                console.error("Gemini API error during AI search parsing:", aiErr);
                logs.push(`[AI Error] Gemini AI failed on page ${p}: ${aiErr.message || aiErr}`);
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
                       const timeoutId = setTimeout(() => controller.abort(), 3000);
                       const detRes = await fetch(r.detailUrl, {
                         headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
                         signal: controller.signal
                       });
                       clearTimeout(timeoutId);
                       if (detRes.ok) {
                          const dhtml = await detRes.text();
                          const $d = cheerio.load(dhtml);
                          const btnHref = $d(".tg-channel__btn a").attr("href");
                          if (btnHref && (btnHref.startsWith("tg://") || btnHref.includes("t.me/"))) {
                             r.telegramUrl = btnHref;
                             r.extractionStatus = "success";
                             if (btnHref.includes("resolve?domain=")) {
                                 r.username = btnHref.split("domain=")[1];
                             } else if (btnHref.includes("join?invite=")) {
                                 r.username = btnHref.split("invite=")[1];
                             }
                          }
                       }
                     } catch (e) {
                       // ignore timeouts to not crash the whole batch
                     }
                   }
                 }));
               }
            }

            let rawCardCount = 0;
            if (html) {
              const $ = cheerio.load(html);
              let cardSelector = ".search-result, .card, .channel-card, .search-item, .list-group-item, .tg-channel, .main-search-button-result-item, .main-search-button-result-item-wrapper";
              if (src === "lyzem") {
                cardSelector = ".search-result";
              } else if (src === "tgramsearch") {
                cardSelector = ".tg-channel";
              }
              rawCardCount = Math.max(
                parsedResults.length,
                $(cardSelector).length
              );
            }
            batchResults.push({ page: p, results: parsedResults, rawCardCount });
          } catch (err: any) {
            console.error(`Error processing ${src} page ${p}:`, err);
            logs.push(`[Error] ${src} (Page ${p}): ${err.message}`);
            batchResults.push({ page: p, results: [], rawCardCount: 0 });
          }
        }

        // Sort batch results by page number to keep them in order
        batchResults.sort((a, b) => a.page - b.page);

        let newResultsInBatchCount = 0;
        let allPagesInBatchEmpty = true;

        for (const pageRes of batchResults) {
          searchStats[src].pagesFetched++;

          if (searchStats[src].rawCardsFound === undefined) {
             searchStats[src].rawCardsFound = 0;
          }
          searchStats[src].rawCardsFound += pageRes.rawCardCount || 0;

          const isPageEmpty = pageRes.rawCardCount !== undefined ? pageRes.rawCardCount === 0 : pageRes.results.length === 0;

          if (isPageEmpty) {
            consecutiveEmptyPages++;
            logs.push(`[Pagination Engine] Page ${pageRes.page} of ${src} returned 0 results. (Consecutive empty: ${consecutiveEmptyPages})`);
            continue;
          }

          // Reset consecutiveEmptyPages since we found valid items
          consecutiveEmptyPages = 0;
          allPagesInBatchEmpty = false;

          let uniqueOnPage = 0;
          const pageAddedResults: any[] = [];

          searchStats[src].totalFound += pageRes.results.length;
          const tgLinksCount = pageRes.results.filter((r: any) => 
            r.telegramUrl && (r.telegramUrl.includes("t.me") || r.telegramUrl.includes("telegram.me") || r.telegramUrl.includes("tgramsearch.com/join/") || r.telegramUrl.startsWith("tg://"))
          ).length;
          searchStats[src].tgLinksFound = (searchStats[src].tgLinksFound || 0) + tgLinksCount;

          for (const item of pageRes.results) {
            const dupKey = `${item.title.toLowerCase()}_${item.detailUrl.toLowerCase()}`;
            if (!seenTitlesAndUrls.has(dupKey)) {
              seenTitlesAndUrls.add(dupKey);
              uniqueOnPage++;
              pageAddedResults.push(item);
            } else {
              searchStats[src].duplicatesFiltered++;
            }
          }

          if (uniqueOnPage > 0) {
            results.push(...pageAddedResults);
            newResultsInBatchCount += uniqueOnPage;
            searchStats[src].uniqueAdded += uniqueOnPage;
          } else {
            logs.push(`[Pagination Engine] Page ${pageRes.page} of ${src} has only duplicates.`);
            // Note: we don't immediately abort if we got duplicates because subsequent pages might still have unique content
          }
        }

        logs.push(`[Pagination Engine] Batch results: ${newResultsInBatchCount} unique channels added from ${src} (Pages ${batchPages.join("-")})`);

        if (consecutiveEmptyPages >= 3 || allPagesInBatchEmpty) {
          logs.push(`[Pagination Engine] Reached end of directory or reached consecutive empty page limit (consecutive empty: ${consecutiveEmptyPages}). Stopping ${src}.`);
          hasMore = false;
        } else {
          page += batchSize;
        }
      } catch (batchErr: any) {
        console.error(`Error during batch processing of ${src}:`, batchErr);
        logs.push(`[Error] Batch starting at page ${page} failed: ${batchErr.message}`);
        hasMore = false;
      }
    }
  }

  res.json({ results, logs, searchStats });
});

// Gemini-powered search scraper parser
async function parseWithAI(html: string, source: string, query: string): Promise<any[]> {
  const cleaned = cleanHtmlForAI(html);
  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
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
app.post("/api/extract-link", async (req: express.Request, res: express.Response) => {
  const { detailUrl, mode = "fast" } = req.body;

  if (!detailUrl) {
    res.status(400).json({ error: "Detail URL is required." });
    return;
  }

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

    res.json({
      success: !!result?.telegramUrl,
      telegramUrl: result?.telegramUrl || null,
      username: result?.username || null,
      channelDescription: result?.channelDescription || null,
      stats: result?.stats || null,
      similarChannels: extractSimilarChannelsFromHtml(html, detailUrl),
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
    model: "gemini-3.5-flash",
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

// ---------------- SERVER AND VITE DEV SETUP ----------------

async function startServer() {
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

startServer();
