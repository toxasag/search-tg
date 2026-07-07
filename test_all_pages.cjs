const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const cheerio = require('cheerio');

function parseWithSelectors(html, baseUrl) {
  const $ = cheerio.load(html);
  const results = [];

  const resolveUrl = (urlStr) => {
    if (!urlStr) return "";
    if (urlStr.startsWith("http")) return urlStr;
    return new URL(urlStr, baseUrl).toString();
  };

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
      const $link = $card.find("a").filter((_, aEl) => {
        const href = $(aEl).attr("href") || "";
        return href.includes("/channel/") || href.includes("/group/") || href.includes("/catalog/") || 
               href.includes("/cat/") || href.includes("/chat/") || href.includes("/show/") || 
               href.includes("/t/") || href.includes("/tg/") || href.includes("/details/") || /t\.me\//i.test(href);
      }).first();

      if ($link.length > 0) {
        const detailUrl = resolveUrl($link.attr("href") || "");
        const title = $card.find("h3, h4, h5, h2, .title, .name, strong, .search_title, .channel-title, .search-result-title, .tg-channel__link, .tg-channel__info").first().text().trim() || $link.text().trim();

        if (title && detailUrl && !results.some(r => r.detailUrl === detailUrl)) {
          results.push({ title, detailUrl });
        }
      }
    });
  });

  return results;
}

async function test() {
  const query = "фриланс";
  const encodedQuery = encodeURIComponent(query);
  
  for (let p = 1; p <= 15; p++) {
    const url = `https://lyzem.com/search?q=${encodedQuery}&p=${p}&per-page=100&f=all`;
    
    // 250ms delay between pages like in server.ts
    await new Promise(r => setTimeout(r, 250));
    
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      const html = await res.text();
      const parsed = parseWithSelectors(html, "https://lyzem.com");
      console.log(`Page ${p}: status = ${res.status}, html length = ${html.length}, parsed count = ${parsed.length}`);
      
      if (parsed.length > 0) {
        console.log(`  - First item: "${parsed[0].title}" (${parsed[0].detailUrl})`);
      } else {
        // Log a snippet of HTML to see what is returned
        console.log(`  - HTML Snippet: "${html.slice(0, 300).replace(/\s+/g, ' ')}"`);
      }
    } catch (err) {
      console.error(`Page ${p} failed:`, err.message);
    }
  }
}

test();
