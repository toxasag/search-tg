# Telegram Catalog Scraper & Intelligence Suite

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-cyan.svg)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)
[![Tests](https://img.shields.io/badge/Tests-15%20Passing-success.svg)](#testing)

**A high-performance, private, multi-user web application for discovering, cataloging, filtering, analyzing, and exporting Telegram channels, groups, and invite chats across multiple public catalogs and direct Telegram sources.**

[English](README.md) | [Русский](README_RU.md) | [中文](README_ZH.md)

</div>

---

## 🌟 Key Highlights

- 🔎 **Multi-Catalog Aggregator**: Real-time unified scraping across **8+ public Telegram catalogs** (`tgsearch`, `tgramcat`, `tgramsearch`, `waybien`, `lyzem`, `TG-Cat`, `Catalog Telegram`, `TGLib`).
- 🤖 **Zero-Bot Guarantee**: Automated bot classification and rejection (`isBotTarget`) across scraping, manual importing, and database storage. Only real human channels and groups are cataloged.
- 🎯 **Advanced Relevance & Anti-Spam Engine**:
  - Strict **Geo + Niche co-occurrence** verification (e.g. `"renovation phuket"` requires both renovation topic *and* Phuket location, discarding unrelated Phuket chats or Moscow renovation channels).
  - Negative Geo Clash filtering to eliminate cross-city spam.
  - Multi-query splitting, stemming, synonym expansion, and explicit vulgar/porn filter.
- 🗄️ **Global Database Explorer (`#database`)**:
  - Browse, search, filter, and inspect tens of thousands of accumulated Telegram entities.
  - Granular full-text filtering: "Everywhere", "In Title", or "In Description".
  - One-click filters: **Channels**, **Groups / Chats**, **Private / Invite-only**, **Unknown**.
  - Multi-select batch export to **Plain TXT links**, **Structured TXT Reports**, **CSV** (Excel-compatible with UTF-8 BOM), and **JSON**.
- ⚡ **Background Enrichment Worker**:
  - Automatically fetches live Telegram Web Previews (`t.me/<username>`).
  - Resolves avatars, subscriber/member counts, verified titles, descriptions, and community types with concurrency throttling.
- 📥 **Bulk URL Import**: Paste thousands of raw links (`t.me/...`, `tg://...`), deduplicate them against the database, and enrich them asynchronously.
- 🔒 **Multi-User Security & RBAC**:
  - Role-based isolation (Owner vs. Standard Users).
  - Session-based authentication with secure HTTP-only cookies and CSRF protection.
  - Admin panel for managing users and monitoring audit logs.
- 🐳 **Turnkey Docker & VPS Deployment**:
  - Optimized multi-stage Docker build.
  - Pre-configured `docker-compose.yml` for isolated production deployment behind Nginx / Nginx Proxy Manager with automatic SSL.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Web UI (React 19 + Tailwind)                  │
│       Search / Parser   │   Global Database Explorer   │   User Admin  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ REST / SSE
┌───────────────────────────────────▼────────────────────────────────────┐
│                    Node.js 22 + Express Backend                        │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │  Multi-Catalog Engine │  │ Relevance Engine│  │ Enrichment Worker│  │
│  │  8+ Public Catalogs   │  │ Geo+Niche Logic │  │ Telegram Web     │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │   Auth & RBAC Store   │  │  Bot Detection  │  │ Telegram Client  │  │
│  │   Sessions & Audit    │  │  isBotTarget()  │  │ MTProto Optional │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                 SQLite Database (WAL Mode + Caching)                   │
│   • channels    • searches    • search_results    • users   • audit    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- **Node.js** 22.0.0 or higher
- **npm** 10.0.0 or higher

### 1. Clone the repository
```bash
git clone https://github.com/toxasag/search-tg.git
cd search-tg
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Create a `.env` file from the provided template:
```bash
cp .env.example .env
```
Edit `.env` to configure your initial owner credentials:
```env
# Initial Owner Account (must be at least 12 characters)
BOOTSTRAP_OWNER_EMAIL="owner@example.com"
BOOTSTRAP_OWNER_PASSWORD="your-strong-bootstrap-password"

# Server Port and Database Path
PORT=3000
DATABASE_PATH="./data/search-tg.sqlite"
NODE_ENV="development"
```

### 4. Run tests
```bash
npm test
```

### 5. Start development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser. Log in with your bootstrap owner credentials.

---

## ⚙️ Configuration Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | Optional | `3000` | HTTP port for the web application. |
| `DATABASE_PATH` | Optional | `./data/search-tg.sqlite` | SQLite database file location. |
| `NODE_ENV` | Optional | `development` | Set to `production` in live environments for secure cookies. |
| `APP_URL` | Optional | `https://tgsearch.team-big.ru` | Public-facing URL (used in metadata & logging). |
| `BOOTSTRAP_OWNER_EMAIL` | First boot | `owner@example.com` | Email for the initial admin account. |
| `BOOTSTRAP_OWNER_PASSWORD` | First boot | — | Password for the initial admin (min 12 chars). Remove after first launch. |
| `GEMINI_API_KEY` | Optional | — | Google Gemini API key for AI-assisted semantic query expansion. |
| `HTTPS_PROXY` | Optional | — | Outbound HTTP/HTTPS proxy URL for scraper requests (e.g. `http://127.0.0.1:7890`). |
| `TG_API_ID` | Optional | — | Telegram API ID from [my.telegram.org](https://my.telegram.org) (for direct MTProto discovery). |
| `TG_API_HASH` | Optional | — | Telegram API Hash from [my.telegram.org](https://my.telegram.org). |
| `TG_SESSION_FILE` | Optional | `./data/telegram.session` | File path to authorized Teleproto StringSession. |

---

## 🌐 Catalog Sources & Parsers

| Source ID | Name | Method | Features / Constraints |
|---|---|---|---|
| `tgsearch` | TGSearch | HTML Search | Russian and international channel database. |
| `tgramcat` | TGramCat | HTML Parsing | Rich category listings and descriptions. |
| `tgramsearch` | TGramSearch | Web Serp | High coverage of thematic groups and channels. |
| `waybien` | Waybien | Multi-lingual Serp | Good coverage of international and regional communities. |
| `lyzem` | Lyzem | Search Engine | Specialized Telegram search engine. |
| `tgcat` | TG-Cat | JSON API | Direct JSON endpoint for channels and supergroups; filters ads/bots. |
| `catalogTelegram` | Catalog Telegram | Paginated HTML | Resolves community redirect headers without executing `tg://`. |
| `tglib` | TGLib | Yandex Site-Search | Detail page scraping for title, description, avatar, and join button. |
| `telegram` | Direct Telegram | MTProto Client | Optional direct Telegram search using personal account credentials. |

---

## 🎯 Smart Relevance Engine

When users search for multi-concept queries (such as `"ремонт пхукет"` / `"phuket renovation"` or `"бизнес тайланд"`), simple keyword matching causes massive false-positive noise.

The built-in engine implements:
1. **Semantic Facet Splitting**:
   - **Geo Qualifiers**: `пхукет`, `тайланд`, `бангкок`, `москва`, `дубай`, `бали`, etc.
   - **Topic / Niche Qualifiers**: `ремонт`, `бизнес`, `недвижимость`, `крипта`, `визы`, `работа`, etc.
   - **Format Qualifiers**: `чат`, `канал`, `группа`, `клуб`.
2. **Strict Co-occurrence**:
   - A channel must satisfy **both** the Geo and the Niche requirements. A Phuket motorcycle club will be discarded for `"ремонт пхукет"`, and a Moscow construction channel will also be discarded.
3. **Negative Geo Clash Guard**:
   - If Query specifies Geo $A$ and channel explicitly specifies Geo $B$ ($A \ne B$), the channel is immediately scored 0 and rejected.
4. **Anti-Spam & Profanity Filter**:
   - Automatically drops escort, adult, gambling, and link-farm spam.

---

## 🗄️ Global Database Explorer

The **Глобальная база** (Global Database) tab provides direct management of all cataloged Telegram assets:

1. **Granular Keyword Search**: Search across **All fields**, **Title only**, or **Description only**.
2. **Type Segmentation**:
   - 📢 **Канал** (Broadcast Channels)
   - 👥 **Группа / Чат** (Supergroups & Discussion Chats)
   - 🔒 **Приватный** (Invite-only links like `t.me/+...` or `t.me/joinchat/...`)
   - ❓ **Неизвестно** (Unenriched links)
3. **Batch Export**:
   - **TXT Links**: Pure Telegram URLs (one per line) for direct import into marketing tools.
   - **TXT Report**: Human-readable report with Title, Username, Audience, Type, Link, and Description.
   - **CSV**: Spreadsheet export with RFC 4180 escaping and UTF-8 BOM for Microsoft Excel.
   - **JSON**: Full metadata array for programmatic pipelines.
4. **Background Re-enrichment**:
   - Triggerable worker to refresh avatars, subscriber numbers, and chat types for all pending channels.

---

## 🐳 VPS & Production Deployment

### Docker Deployment
The project includes a production-grade multi-stage `Dockerfile`:

```bash
# 1. On your VPS, clone the project
git clone https://github.com/toxasag/search-tg.git /opt/search-tg
cd /opt/search-tg

# 2. Configure production .env
cp .env.example .env
nano .env

# 3. Build and launch container
docker compose up -d --build
```

### Nginx / Reverse Proxy Configuration
If using **Nginx Proxy Manager**:
- Forward Hostname: `search-tg` (or `127.0.0.1` if using host network)
- Forward Port: `3000`
- Enable: `Websockets Support`, `Block Common Exploits`
- SSL: Request Let's Encrypt certificate with `Force SSL` and `HTTP/2 Support`.

If using standard **Nginx**:
```nginx
server {
    server_name tgsearch.team-big.ru;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

---

## 🔒 Security Best Practices

- **Zero Secrets in Repository**: `.env`, `.env.local`, SQLite databases (`*.sqlite`), session files (`*.session`), and log files are strictly excluded via `.gitignore`.
- **Database Backups**: Use SQLite's online backup API or `sqlite3 data/search-tg.sqlite ".backup backup.sqlite"` rather than copying the active WAL file.
- **Session Protection**: Passwords are securely hashed; sessions use HTTP-only, SameSite cookies.
- **Bot Defense**: Inbound scrapers and imports filter out bot accounts to preserve system integrity.

---

## 🧪 Testing

The test suite covers catalog parsing, redirect extraction, bot detection, relevance scoring, and durable search queues:

```bash
# Run all tests
npm test
```

Expected output:
```
✔ TG-Cat excludes ads/bots and preserves invite hashes and types
✔ Catalog Telegram scopes cards and stops at last page
✔ TGLib restricts search to detail URLs and community buttons
✔ Catalog redirect resolves tg:// without fetching Telegram or arbitrary hosts
✔ isBotTarget detects bot links and usernames while preserving regular channels and groups
✔ Stemming and canonical mapping
✔ Intent parsing separates specific qualifiers from general topic terms
✔ Relevance filtering: 'бизнес тайланд, бизнес пхукет' eliminates spam
✔ Strict Geo + Niche co-occurrence for 'ремонт пхукет'
✔ TXT normalizes protocols, deduplicates usernames and preserves invite case
✔ import list preserves all links without dropping them via relevance filter
...
ℹ pass 15
ℹ fail 0
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
