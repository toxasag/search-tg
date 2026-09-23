import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const databasePath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "search-tg.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'user')),
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
`);

const searchesSql = (table = "searches") => `
  CREATE TABLE ${table} (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    source TEXT NOT NULL,
    mode TEXT NOT NULL,
    limit_pages INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')) DEFAULT 'queued',
    search_stats TEXT,
    logs TEXT NOT NULL DEFAULT '[]',
    progress INTEGER NOT NULL DEFAULT 0,
    current_source TEXT,
    error TEXT,
    heartbeat_at TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    request_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`;

const existingSearchSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'searches'").get() as { sql?: string } | undefined)?.sql || "";
if (!existingSearchSql) {
  db.exec(searchesSql());
} else if (!existingSearchSql.includes("'queued'")) {
  // Older releases used a CHECK constraint without queued/cancelled. Rebuild all
  // dependent tables atomically so existing VPS databases remain usable.
  db.pragma("foreign_keys = OFF");
  db.transaction(() => {
    db.exec("ALTER TABLE search_results RENAME TO search_results_legacy");
    db.exec("ALTER TABLE searches RENAME TO searches_legacy");
    db.exec(searchesSql());
    db.exec(`INSERT INTO searches (id, user_id, query, source, mode, limit_pages, status, search_stats, logs, created_at, completed_at)
      SELECT id, user_id, query, source, mode, limit_pages,
        CASE WHEN status = 'running' THEN 'queued' ELSE status END,
        search_stats, logs, created_at, completed_at FROM searches_legacy`);
    db.exec(`CREATE TABLE search_results (
      id INTEGER PRIMARY KEY,
      search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      dedup_key TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      subscribers TEXT, detail_url TEXT NOT NULL, image_url TEXT, source TEXT NOT NULL,
      telegram_url TEXT, username TEXT, channel_description TEXT, stats TEXT,
      extraction_status TEXT NOT NULL, chat_type TEXT NOT NULL DEFAULT 'unknown',
      error TEXT, similar_channels TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(search_id, dedup_key)
    )`);
    db.exec(`INSERT INTO search_results SELECT * FROM search_results_legacy`);
    db.exec("DROP TABLE search_results_legacy; DROP TABLE searches_legacy;");
  })();
  db.pragma("foreign_keys = ON");
} else {
  db.exec(searchesSql("searches_new").replace("CREATE TABLE searches_new", "CREATE TABLE IF NOT EXISTS searches_new"));
  db.exec("DROP TABLE searches_new");
}

db.exec(`
  CREATE INDEX IF NOT EXISTS searches_user_created_idx ON searches(user_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS searches_request_idx ON searches(user_id, request_id) WHERE request_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS search_results (
    id INTEGER PRIMARY KEY,
    search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    dedup_key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    subscribers TEXT,
    detail_url TEXT NOT NULL,
    image_url TEXT,
    source TEXT NOT NULL,
    telegram_url TEXT,
    username TEXT,
    channel_description TEXT,
    stats TEXT,
    extraction_status TEXT NOT NULL,
    chat_type TEXT NOT NULL DEFAULT 'unknown',
    error TEXT,
    similar_channels TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(search_id, dedup_key)
  );
  CREATE INDEX IF NOT EXISTS search_results_search_idx ON search_results(search_id);
  CREATE TABLE IF NOT EXISTS channels (
    dedup_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    subscribers TEXT,
    detail_url TEXT NOT NULL,
    image_url TEXT,
    source TEXT NOT NULL,
    telegram_url TEXT,
    username TEXT,
    channel_description TEXT,
    stats TEXT,
    extraction_status TEXT NOT NULL DEFAULT 'pending',
    chat_type TEXT NOT NULL DEFAULT 'unknown',
    error TEXT,
    similar_channels TEXT,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS channels_updated_idx ON channels(updated_at DESC);
`);

export function recoverStaleSearches() {
  db.prepare(`UPDATE searches SET status = 'queued', heartbeat_at = NULL WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < datetime('now', '-2 minutes'))`).run();
}


const getCachedChannelStmt = db.prepare("SELECT * FROM channels WHERE dedup_key=?");

export function getCachedChannel(dedupKey: string) {
  const row = getCachedChannelStmt.get(dedupKey) as any;
  if (!row) return null;
  return {
    title: row.title, description: row.description, subscribers: row.subscribers, detailUrl: row.detail_url,
    imageUrl: row.image_url, source: row.source, telegramUrl: row.telegram_url, username: row.username,
    channelDescription: row.channel_description, stats: row.stats ? JSON.parse(row.stats) : null,
    extractionStatus: row.extraction_status, chatType: row.chat_type, error: row.error,
    similarChannels: row.similar_channels ? JSON.parse(row.similar_channels) : null,
  };
}

const putCachedChannelStmt = db.prepare(`INSERT INTO channels (dedup_key,title,description,subscribers,detail_url,image_url,source,telegram_url,username,channel_description,stats,extraction_status,chat_type,error,similar_channels)
  VALUES (@dedupKey,@title,@description,@subscribers,@detailUrl,@imageUrl,@source,@telegramUrl,@username,@channelDescription,@stats,@extractionStatus,@chatType,@error,@similarChannels)
  ON CONFLICT(dedup_key) DO UPDATE SET
    title=CASE WHEN excluded.title LIKE '@%' THEN channels.title ELSE excluded.title END,
    description=CASE WHEN excluded.description='' THEN channels.description ELSE excluded.description END,
    subscribers=COALESCE(excluded.subscribers,channels.subscribers), image_url=COALESCE(excluded.image_url,channels.image_url),
    source=excluded.source, telegram_url=COALESCE(excluded.telegram_url,channels.telegram_url), username=COALESCE(excluded.username,channels.username),
    channel_description=COALESCE(excluded.channel_description,channels.channel_description), stats=COALESCE(excluded.stats,channels.stats),
    extraction_status=CASE WHEN channels.extraction_status='success' THEN 'success' ELSE excluded.extraction_status END,
    chat_type=CASE WHEN excluded.chat_type='unknown' THEN channels.chat_type ELSE excluded.chat_type END,
    error=excluded.error, similar_channels=COALESCE(excluded.similar_channels,channels.similar_channels), updated_at=CURRENT_TIMESTAMP`);

export function putCachedChannel(dedupKey: string, payload: any) {
  putCachedChannelStmt.run({
    dedupKey, title: payload.title, description: payload.description || '', subscribers: payload.subscribers || null,
    detailUrl: payload.detailUrl, imageUrl: payload.imageUrl || null, source: payload.source,
    telegramUrl: payload.telegramUrl || null, username: payload.username || null, channelDescription: payload.channelDescription || null,
    stats: payload.stats ? JSON.stringify(payload.stats) : null, extractionStatus: payload.extractionStatus || 'pending',
    chatType: payload.chatType || 'unknown', error: payload.error || null,
    similarChannels: payload.similarChannels ? JSON.stringify(payload.similarChannels) : null,
  });
}
export function isDatabaseEmpty() {
  return (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count === 0;
}
