/**
 * Standalone batch enrichment script for Telegram channels.
 * Enriches pending channels directly from Telegram Web Preview
 * with concurrency and rate limiting.
 */
import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "search-tg.sqlite");
console.log(`Connecting to database at ${dbPath}...`);
const db = new Database(dbPath);

const CHROME_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function normalizeTelegramLink(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  const m1 = s.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(\+?[a-zA-Z0-9_]{3,})/i);
  if (m1) return `https://t.me/${m1[1]}`;
  const m2 = s.match(/tg:\/\/resolve\?domain=([a-zA-Z0-9_]{3,})/i);
  if (m2) return `https://t.me/${m2[1]}`;
  const m3 = s.match(/tg:\/\/join\?invite=([a-zA-Z0-9_+]+)/i);
  if (m3) return `https://t.me/+${m3[1]}`;
  return null;
}

async function enrichTelegramPreview(url) {
  const response = await fetch(url, { headers: { "User-Agent": CHROME_USER_AGENT }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const $ = cheerio.load(await response.text());
  
  let title = $("meta[property='og:title']").attr("content") || $(".tgme_page_title").text().trim();
  if (title.startsWith("Telegram: Contact @") || title.startsWith("Telegram: Join Group")) {
    title = url.replace("https://t.me/", "@");
  } else if (title.startsWith("Telegram: ")) {
    title = title.replace(/^Telegram:\s*/, "").trim();
  }

  let description = $("meta[property='og:description']").attr("content") || $(".tgme_page_description").text().trim();
  if (/right away\.$/i.test(description) || /If you have Telegram/i.test(description) || /You can view and join/i.test(description)) {
    description = "";
  }

  let imageUrl = $("meta[property='og:image']").attr("content") || $(".tgme_page_photo_image img").attr("src") || null;
  if (imageUrl && (imageUrl.includes("t_logo") || imageUrl.includes("telegram.org/img"))) {
    imageUrl = null;
  }

  const extra = $(".tgme_page_extra").text().trim();
  const subscribers = extra.match(/[\d.,KMB]+\s+(?:subscribers|members)/i)?.[0] || null;
  const lower = `${extra} ${$(".tgme_page_action").text()}`.toLowerCase();
  const chatType = /members|join group|chat/.test(lower) ? "group" : /subscribers|view channel/.test(lower) ? "channel" : url.includes("+") || url.includes("joinchat") ? "closed" : "unknown";

  return { title: title || url.replace("https://t.me/", "@"), description: description || "", imageUrl, subscribers, chatType };
}

async function run() {
  const rows = db.prepare(`
    SELECT r.id, r.telegram_url, r.title, r.dedup_key
    FROM search_results r
    WHERE r.telegram_url IS NOT NULL 
      AND (r.image_url IS NULL OR r.description = '' OR r.chat_type = 'unknown' OR r.extraction_status = 'pending')
    ORDER BY r.id ASC
  `).all();

  console.log(`Found ${rows.length} pending/incomplete records to enrich.`);
  if (rows.length === 0) {
    console.log("No records need enrichment.");
    return;
  }

  const updateResultStmt = db.prepare(`
    UPDATE search_results SET
      title = ?,
      description = ?,
      image_url = ?,
      subscribers = ?,
      chat_type = ?,
      extraction_status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const updateCacheStmt = db.prepare(`
    UPDATE channels SET
      title = CASE WHEN ? LIKE '@%' THEN channels.title ELSE ? END,
      description = CASE WHEN ? = '' THEN channels.description ELSE ? END,
      image_url = COALESCE(?, channels.image_url),
      subscribers = COALESCE(?, channels.subscribers),
      chat_type = CASE WHEN ? = 'unknown' THEN channels.chat_type ELSE ? END,
      extraction_status = 'success',
      updated_at = CURRENT_TIMESTAMP
    WHERE dedup_key = ?
  `);

  let successCount = 0;
  let failCount = 0;
  const BATCH_SIZE = 5;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (row) => {
      try {
        const url = normalizeTelegramLink(row.telegram_url);
        if (!url) return;
        const preview = await enrichTelegramPreview(url);
        const status = preview.chatType === "unknown" ? "pending" : "success";

        updateResultStmt.run(
          preview.title,
          preview.description,
          preview.imageUrl,
          preview.subscribers,
          preview.chatType,
          status,
          row.id
        );

        updateCacheStmt.run(
          preview.title, preview.title,
          preview.description, preview.description,
          preview.imageUrl,
          preview.subscribers,
          preview.chatType, preview.chatType,
          row.dedup_key
        );

        successCount++;
      } catch (err) {
        failCount++;
      }
    }));

    const progress = Math.min(100, Math.round(((i + batch.length) / rows.length) * 100));
    process.stdout.write(`\rProgress: ${i + batch.length}/${rows.length} (${progress}%) | Enriched: ${successCount} | Failed: ${failCount}`);
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\nDone! Successfully enriched: ${successCount}, Failed: ${failCount}`);
}

run().catch(console.error);
