# Telegram Catalog Scraper

A private multi-user tool for finding Telegram channels, groups and invite-only chats through public catalogues, saving each account's searches, and exporting results for other services.

## Run locally

**Prerequisites:** Node.js 22+.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set an initial owner account. The owner password must be at least 12 characters.
3. Start the application:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000` and sign in as the bootstrap owner. The owner can create, disable, and remove user accounts from **Manage users**.

## VPS deployment

The included `Dockerfile` and `docker-compose.yml` run the app as an isolated `search-tg` container on the existing external `proxy_network`. Copy `.env.example` to `.env` on the VPS, fill in secrets there, then run `docker compose up -d --build` from the project directory. In Nginx Proxy Manager, point `tgsearch.team-big.ru` to hostname `search-tg`, port `3000`; request the Let's Encrypt certificate only after HTTP forwarding works.

The database defaults to `data/search-tg.sqlite`; set `DATABASE_PATH` to a persistent VPS directory and back it up. The bootstrap credentials are used only when the database has no users, but remove `BOOTSTRAP_OWNER_PASSWORD` after the owner account exists.

## Data and exports

- Every account can see only its own saved searches and results.
- **TXT links** exports one direct Telegram URL per line for imports.
- **TXT report** exports title, type, catalogue page, and Telegram URL for review.
- CSV and JSON exports remain available.

The application reads public catalogues. A `closed` result means the catalogue exposed an invite-only link; it does not grant access to private Telegram content.

## Live searches

Search creation returns HTTP 202. Results and timestamped logs are saved after each page; the UI refreshes every two seconds, retries connection failures, and restores the latest search after reload. A multi-phrase input is one saved job. Cancellation keeps saved results. At most two jobs run globally and one per account. After an unexpected restart, stale jobs become eligible after two minutes and resume at saved source/page cursors. This deployment supports one Node process per SQLite database, not multiple replicas.

TXT exports normalize public links, preserve case-sensitive invite hashes, remove duplicates, and exclude guessed/unresolved links. An extracted link is not a guarantee the community is still active or relevant.

## Catalog sources

`all` includes tgsearch, tgramcat, tgramsearch, waybien, lyzem, TG-Cat, Catalog Telegram and TGLib.

- **TG-Cat**: uses the same public JSON endpoint as its website, fetching both supergroups and channels; ads and bots are excluded. The public response is limited (observed 50 records per category), even when the displayed catalog count is larger. No undocumented pagination is assumed.
- **catalog-telegram.site**: parses paginated search cards and resolves their Telegram redirect headers without following custom `tg://` schemes.
- **TGLib**: its website search is powered by Yandex site search; only TGLib community pages are accepted, then their explicit community buttons are extracted. CAPTCHA or blocking is surfaced as a source error, never bypassed.

The sources share saved history, live logs, cancellation and normalized TXT export. Public-source availability and index completeness are not guaranteed; unknown community types remain `unknown` rather than guessed from names.

## Optional Telegram discovery

The `telegram` source uses the maintained MIT-licensed [teleproto](https://github.com/sanyok12345/teleproto) client and Telegram's public search. It does not join chats, send messages, collect members, or reuse another project's session. `all` includes it only when configured; an explicit unconfigured Telegram search reports an error.

Configure `TG_API_ID`, `TG_API_HASH`, and `TG_SESSION_FILE` on the server. The session file must contain a separately authorized teleproto StringSession and be readable inside the container (for example `/app/data/telegram.session`, mode 600). Obtain app credentials from my.telegram.org and authorize a dedicated account locally:

```bash
node scripts/telegram-login.mjs
```

The helper asks for the phone locally and hides the login code and two-step password. It never overwrites an existing session file. Do not paste the session, login code or password into chat. No credentials are provisioned automatically. API limits/FLOOD_WAIT remain applicable, and coverage is not exhaustive. This optional source has not been live-tested without owner-supplied credentials.

Run regression tests:

```bash
npm test
```

Development: use `NODE_ENV=development` locally; production cookies require HTTPS. Keep the production data mount unchanged across releases. Back up SQLite through its backup API, not by copying a live WAL file independently.
