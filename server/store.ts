import { db, getCachedChannel, putCachedChannel } from "./db.js";
import { normalizeTelegramLink } from "../src/telegram-links.js";
import { calculateRelevance, tokenize } from "./relevance.js";

export interface StoredChannelInput {
  title: string;
  description?: string;
  subscribers?: string | null;
  detailUrl: string;
  imageUrl?: string | null;
  source: string;
  telegramUrl?: string | null;
  username?: string | null;
  channelDescription?: string | null;
  stats?: Record<string, string> | null;
  extractionStatus?: string;
  chatType?: string;
  error?: string | null;
  similarChannels?: unknown[] | null;
}

function parseJson(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function resultKey(item: StoredChannelInput) {
  const link = normalizeTelegramLink(item.telegramUrl);
  if (link) return `telegram:${link}`;
  return `detail:${item.detailUrl}`;
}

function mapResult(row: any) {
  return {
    id: String(row.id),
    searchId: String(row.search_id),
    title: row.title,
    description: row.description,
    subscribers: row.subscribers,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    source: row.source,
    telegramUrl: row.telegram_url,
    username: row.username,
    channelDescription: row.channel_description,
    stats: parseJson(row.stats),
    extractionStatus: row.extraction_status,
    chatType: row.chat_type,
    error: row.error,
    timestamp: row.created_at,
    similarChannels: parseJson(row.similar_channels),
  };
}

export function createSearch(userId: number, input: { query: string; source: string; mode: string; limitPages: number; requestId?: string }) {
  const existing = input.requestId
    ? db.prepare("SELECT id FROM searches WHERE user_id = ? AND request_id = ?").get(userId, input.requestId) as { id?: number } | undefined
    : undefined;
  if (existing?.id) return existing.id;
  const result = db.prepare(`
    INSERT INTO searches (user_id, query, source, mode, limit_pages, status, request_id, heartbeat_at)
    VALUES (@userId, @query, @source, @mode, @limitPages, 'queued', @requestId, CURRENT_TIMESTAMP)
  `).run({ userId, ...input, requestId: input.requestId || null });
  return Number(result.lastInsertRowid);
}

export function listQueuedSearches() {
  return db.prepare(`SELECT id, user_id, query, source, mode, limit_pages FROM searches WHERE status = 'queued' ORDER BY id ASC`).all() as { id: number; user_id: number; query: string; source: string; mode: "fast" | "ai"; limit_pages: number }[];
}

export function getSearchStatus(userId: number, searchId: number) {
  const row = db.prepare(`SELECT id, query, source, mode, status, progress, current_source, search_stats, logs, error, heartbeat_at, cancel_requested, created_at, completed_at FROM searches WHERE id = ? AND user_id = ?`).get(searchId, userId) as any;
  if (!row) return null;
  const countRow = db.prepare("SELECT COUNT(*) AS count FROM search_results WHERE search_id = ?").get(searchId) as { count: number } | undefined;
  return {
    ...row,
    id: String(row.id),
    currentSource: row.current_source,
    limitPages: row.limit_pages,
    searchStats: parseJson(row.search_stats),
    logs: parseJson(row.logs) || [],
    cancelRequested: Boolean(row.cancel_requested),
    resultCount: countRow?.count ?? 0,
    heartbeatAt: row.heartbeat_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function mapCachedRow(row: any) {
  return {
    id: `cached:${row.dedup_key}`,
    title: row.title,
    description: row.description,
    subscribers: row.subscribers,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    source: `cached (${row.source})`,
    telegramUrl: row.telegram_url,
    username: row.username,
    channelDescription: row.channel_description,
    stats: parseJson(row.stats),
    extractionStatus: row.extraction_status,
    chatType: row.chat_type,
    error: row.error,
    timestamp: row.updated_at,
    similarChannels: parseJson(row.similar_channels),
    isCached: true,
  };
}

export function searchCachedChannels(query: string, limit = 100) {
  const trimmed = query.trim();
  if (!trimmed) {
    const rows = db.prepare(`SELECT * FROM channels ORDER BY updated_at DESC LIMIT ?`).all(limit) as any[];
    return rows.map(mapCachedRow);
  }

  // Tokenize query words (longer than 2 characters)
  const tokens = tokenize(trimmed).filter(t => t.length > 2);
  let candidates: any[] = [];

  if (tokens.length > 0) {
    const conditions = tokens.map(() => `(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(username) LIKE ?)`).join(" OR ");
    const params: string[] = [];
    for (const t of tokens) {
      const p = `%${t.toLowerCase()}%`;
      params.push(p, p, p);
    }
    candidates = db.prepare(`
      SELECT * FROM channels
      WHERE ${conditions}
      LIMIT 1000
    `).all(...params) as any[];
  } else {
    const normalized = `%${trimmed.toLowerCase()}%`;
    candidates = db.prepare(`
      SELECT * FROM channels
      WHERE LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(username) LIKE ?
      LIMIT 500
    `).all(normalized, normalized, normalized) as any[];
  }

  // Deduplicate candidates by dedup_key
  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter(r => {
    if (seen.has(r.dedup_key)) return false;
    seen.add(r.dedup_key);
    return true;
  });

  // Score candidates with relevance engine
  const scored = uniqueCandidates.map(row => {
    const mapped = mapCachedRow(row);
    const rel = calculateRelevance(mapped, trimmed);
    return {
      ...mapped,
      relevanceScore: rel.score,
      isRelevant: rel.isRelevant,
      isCached: true,
    };
  }).filter(c => c.isRelevant);

  // Sort descending by relevance score, then by updated_at
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return scored.slice(0, limit);
}

export function claimSearch(searchId: number) {
  const result = db.prepare(`UPDATE searches SET status = 'running', heartbeat_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'queued'`).run(searchId);
  return result.changes > 0;
}

export function touchSearch(searchId: number, progress: number, currentSource: string, stats: unknown, logs: string[]) {
  db.prepare(`UPDATE searches SET progress = ?, current_source = ?, search_stats = ?, logs = ?, heartbeat_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'running'`).run(progress, currentSource, JSON.stringify(stats), JSON.stringify(logs), searchId);
}

export function requestSearchCancel(userId: number, searchId: number) {
  return db.prepare("UPDATE searches SET cancel_requested = 1 WHERE id = ? AND user_id = ? AND status IN ('queued', 'running')").run(searchId, userId).changes > 0;
}

export function isSearchCancelRequested(searchId: number) {
  return Boolean((db.prepare("SELECT cancel_requested FROM searches WHERE id = ?").get(searchId) as any)?.cancel_requested);
}

export function completeSearch(searchId: number, userId: number, searchStats: unknown, logs: string[], status: "completed" | "failed" | "cancelled" = "completed", error: string | null = null) {
  db.prepare(`UPDATE searches SET status = ?, progress = CASE WHEN ? = 'completed' THEN 100 ELSE progress END, search_stats = ?, logs = ?, error = ?, completed_at = CURRENT_TIMESTAMP, heartbeat_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`).run(status, status, JSON.stringify(searchStats), JSON.stringify(logs), error, searchId, userId);
}

export function isBotTarget(
  url?: string | null,
  username?: string | null,
  title?: string | null,
  chatType?: string | null
): boolean {
  if (chatType === "bot") return true;

  const cleanUser = (username || "").toLowerCase().trim().replace(/^@/, "");
  if (cleanUser.endsWith("bot") && cleanUser.length >= 4) return true;

  const cleanUrl = (url || "").toLowerCase().trim();
  if (/(?:t\.me|telegram\.me)\/[a-z0-9_]{3,32}bot(?:$|\?|\/)/i.test(cleanUrl)) return true;
  if (cleanUrl.endsWith("_bot")) return true;

  const cleanTitle = (title || "").toLowerCase().trim();
  if (/^(?:telegram:\s*)?(?:contact\s+@|start\s+@)[a-z0-9_]{3,32}bot$/i.test(cleanTitle)) return true;

  return false;
}

export function saveResults(searchId: number, items: StoredChannelInput[]) {
  const upsert = db.prepare(`
    INSERT INTO search_results (
      search_id, dedup_key, title, description, subscribers, detail_url, image_url, source,
      telegram_url, username, channel_description, stats, extraction_status, chat_type, error, similar_channels
    ) VALUES (
      @searchId, @dedupKey, @title, @description, @subscribers, @detailUrl, @imageUrl, @source,
      @telegramUrl, @username, @channelDescription, @stats, @extractionStatus, @chatType, @error, @similarChannels
    ) ON CONFLICT(search_id, dedup_key) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      subscribers = COALESCE(excluded.subscribers, search_results.subscribers),
      image_url = COALESCE(excluded.image_url, search_results.image_url),
      source = excluded.source,
      telegram_url = COALESCE(excluded.telegram_url, search_results.telegram_url),
      username = COALESCE(excluded.username, search_results.username),
      channel_description = COALESCE(excluded.channel_description, search_results.channel_description),
      stats = COALESCE(excluded.stats, search_results.stats),
      extraction_status = CASE WHEN search_results.extraction_status = 'success' THEN 'success' ELSE excluded.extraction_status END,
      chat_type = CASE WHEN excluded.chat_type = 'unknown' THEN search_results.chat_type ELSE excluded.chat_type END,
      error = excluded.error,
      similar_channels = COALESCE(excluded.similar_channels, search_results.similar_channels),
      updated_at = CURRENT_TIMESTAMP
  `);
  const searchRow = db.prepare("SELECT query, source FROM searches WHERE id = ?").get(searchId) as { query?: string; source?: string } | undefined;
  const isImport = searchRow?.source === "import";
  const searchQuery = !isImport ? searchRow?.query : undefined;

  db.transaction((records: StoredChannelInput[]) => {
    for (const rawItem of records) {
      if (isBotTarget(rawItem.telegramUrl || rawItem.detailUrl, rawItem.username, rawItem.title, rawItem.chatType)) {
        continue;
      }

      const key = resultKey(rawItem);
      const cached = getCachedChannel(key);
      const item = cached ? {
        ...rawItem,
        title: cached.title || rawItem.title,
        description: cached.description || rawItem.description,
        subscribers: cached.subscribers || rawItem.subscribers,
        imageUrl: cached.imageUrl || rawItem.imageUrl,
        telegramUrl: cached.telegramUrl || rawItem.telegramUrl,
        username: cached.username || rawItem.username,
        channelDescription: cached.channelDescription || rawItem.channelDescription,
        stats: cached.stats || rawItem.stats,
        extractionStatus: cached.extractionStatus === "success" ? "success" : rawItem.extractionStatus,
        chatType: cached.chatType !== "unknown" ? cached.chatType : rawItem.chatType,
      } : rawItem;

      if (isBotTarget(item.telegramUrl || item.detailUrl, item.username, item.title, item.chatType)) {
        continue;
      }

      // If the channel was previously enriched or cached and its true content is not relevant to the query, skip it.
      // Never filter imported channels by search query relevance!
      if (searchQuery && rawItem.source !== "import" && !isImport) {
        const rel = calculateRelevance(item, searchQuery);
        if (!rel.isRelevant) {
          continue;
        }
      }

      putCachedChannel(key, item);
      upsert.run({
        searchId,
        dedupKey: resultKey(item),
        title: item.title,
        description: item.description || "",
        subscribers: item.subscribers || null,
        detailUrl: item.detailUrl,
        imageUrl: item.imageUrl || null,
        source: item.source,
        telegramUrl: item.telegramUrl || null,
        username: item.username || null,
        channelDescription: item.channelDescription || null,
        stats: item.stats ? JSON.stringify(item.stats) : null,
        extractionStatus: item.extractionStatus || "pending",
        chatType: item.chatType || "unknown",
        error: item.error || null,
        similarChannels: item.similarChannels ? JSON.stringify(item.similarChannels) : null,
      });
    }
  })(items);
}

export function listSearches(userId: number) {
  return db.prepare(`
    SELECT s.*, COUNT(r.id) AS result_count
    FROM searches s LEFT JOIN search_results r ON r.search_id = s.id
    WHERE s.user_id = ? GROUP BY s.id ORDER BY s.created_at DESC LIMIT 100
  `).all(userId).map((row: any) => ({
    id: String(row.id),
    query: row.query,
    source: row.source,
    mode: row.mode,
    limitPages: row.limit_pages,
    status: row.status,
    progress: row.progress,
    currentSource: row.current_source,
    error: row.error,
    heartbeatAt: row.heartbeat_at,
    cancelRequested: Boolean(row.cancel_requested),
    searchStats: parseJson(row.search_stats),
    resultCount: row.result_count,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

export function getSearch(userId: number, searchId: number) {
  const search = db.prepare("SELECT * FROM searches WHERE id = ? AND user_id = ?").get(searchId, userId) as any;
  if (!search) return null;
  const results = db.prepare("SELECT * FROM search_results WHERE search_id = ? ORDER BY id DESC").all(searchId).map(mapResult);
  return {
    id: String(search.id),
    query: search.query,
    source: search.source,
    mode: search.mode,
    limitPages: search.limit_pages,
    status: search.status,
    searchStats: parseJson(search.search_stats),
    logs: parseJson(search.logs) || [],
    createdAt: search.created_at,
    completedAt: search.completed_at,
    results,
  };
}

export function updateResult(userId: number, resultId: number, patch: Partial<StoredChannelInput>) {
  const existing = db.prepare(`
    SELECT r.*, s.user_id FROM search_results r JOIN searches s ON s.id = r.search_id
    WHERE r.id = ? AND s.user_id = ?
  `).get(resultId, userId) as any;
  if (!existing) return null;
  const merged = {
    ...mapResult(existing),
    ...patch,
    detailUrl: existing.detail_url,
    source: existing.source,
    title: patch.title && !patch.title.startsWith("@") ? patch.title : existing.title,
    description: patch.description || existing.description,
  };
  db.prepare(`
    UPDATE search_results SET title = ?, description = ?, subscribers = ?, image_url = ?, telegram_url = ?, username = ?, channel_description = ?, stats = ?,
      extraction_status = ?, chat_type = ?, error = ?, similar_channels = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    merged.title,
    merged.description || "",
    merged.subscribers || null,
    merged.imageUrl || null,
    merged.telegramUrl || null,
    merged.username || null,
    merged.channelDescription || null,
    merged.stats ? JSON.stringify(merged.stats) : null,
    merged.extractionStatus || "pending",
    merged.chatType || "unknown",
    merged.error || null,
    merged.similarChannels ? JSON.stringify(merged.similarChannels) : null,
    resultId,
  );
  // Guarantee synchronization with global channels cache
  const key = resultKey(merged as any);
  putCachedChannel(key, merged);
  return getResult(userId, resultId);
}

export function getResult(userId: number, resultId: number) {
  const row = db.prepare(`
    SELECT r.* FROM search_results r JOIN searches s ON s.id = r.search_id
    WHERE r.id = ? AND s.user_id = ?
  `).get(resultId, userId);
  return row ? mapResult(row) : null;
}

export function deleteResult(userId: number, resultId: number) {
  return db.prepare(`
    DELETE FROM search_results WHERE id = ? AND search_id IN (SELECT id FROM searches WHERE user_id = ?)
  `).run(resultId, userId).changes > 0;
}

export function deleteSearch(userId: number, searchId: number) {
  return db.prepare("DELETE FROM searches WHERE id = ? AND user_id = ? AND status NOT IN ('queued', 'running')").run(searchId, userId).changes > 0;
}
