# Telegram 频道与群组智能检索采集系统 (Telegram Catalog Scraper & Intelligence Suite)

<div align="center">

[![License: MIT](https://img.shields.io/badge/协议-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-cyan.svg)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-支持-2496ED.svg)](https://www.docker.com/)
[![Tests](https://img.shields.io/badge/测试-15%20通过-success.svg)](#测试)

**一款高性能、私有化、多用户的 Telegram 频道、公开群组与私密邀请链接挖掘、清洗、分类、分析与导出系统。**

[English](README.md) | [Русский](README_RU.md) | [中文](README_ZH.md)

</div>

---

## 🌟 核心特性

- 🔎 **多源目录聚合采集**：实时聚合抓取 **8+ 个公开 Telegram 目录站点**（`tgsearch`、`tgramcat`、`tgramsearch`、`waybien`、`lyzem`、`TG-Cat`、`Catalog Telegram`、`TGLib`）。
- 🤖 **零 Bot 保证**：全流程机器人识别与剔除机制（`isBotTarget`），在爬取、批量导入及入库环节彻底拦截 Telegram Bot，仅收录真实人类频道与活跃社群。
- 🎯 **智能相关性与防垃圾算法引擎**：
  - 严谨的**地理位置与细分领域共现验证（Geo + Niche Co-occurrence）**：例如检索“普吉岛 装修”时，结果必须同时满足“装修”主题与“普吉岛”地域，自动过滤不相关的普吉岛交流群或非普吉岛的装修频道。
  - 异地冲突排斥（Negative Geo Clash）：若检索指定地区 A，而频道属于地区 B，则该结果得分为 0 并直接剔除。
  - 复合检索拆分、词干提取、同义词扩展，以及强力过滤成人、博彩与垃圾营销内容。
- 🗄️ **全局数据库中心（Global Database Explorer `#database`）**：
  - 集中管理、多维检索并浏览系统中已积累的数万条 Telegram 资源数据。
  - 精准文本检索支持：**“全字段搜索”**、**“仅按标题”** 或 **“仅按描述”**。
  - 快捷分类切换：**全部**、**广播频道（Channel）**、**交流群组（Group）**、**私密邀请（Private / Invite）**、**未知（Unknown）**。
  - 批量勾选与多格式极速导出：**纯链接文本（TXT Links）**、**结构化报告（TXT Report）**、**Excel 兼容表格（带 UTF-8 BOM 的 CSV）**、**结构化 JSON**。
- ⚡ **异步后台元数据深度富化（Enrichment Worker）**：
  - 自动抓取 Telegram 官方 Web 预览页（`t.me/<username>`）。
  - 精准提取高清头像、真实订阅数/成员数、最新标题、描述以及群组/频道属性，内置并发与限速保护。
- 📥 **批量链接极速导入**：支持一键粘贴成百上千条 Telegram 原始链接（`t.me/...`、`tg://...`），自动去重并进行后台异步富化。
- 🔒 **多用户权限与安全隔离（RBAC）**：
  - 角色访问控制（系统超级管理员与普通用户数据隔离）。
  - 基于安全 HTTP-only Cookie 的会话认证，具备 CSRF 防护与防暴力破解频控。
  - 管理员专有用户管理控制台与敏感操作审计日志。
- 🐳 **生产级 Docker & VPS 开箱即用**：
  - 深度优化的多阶段 Docker 构建。
  - 完整的 `docker-compose.yml`，完美集成 Nginx Proxy Manager 与 Let's Encrypt 自动免费 SSL。

---

## 🏗️ 系统架构图

```
┌────────────────────────────────────────────────────────────────────────┐
│                        前端界面 (React 19 + Tailwind CSS)               │
│         检索与采集中心   │   全局数据库浏览器   │   系统用户管理        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ REST API / SSE 流式通信
┌───────────────────────────────────▼────────────────────────────────────┐
│                    后端服务 (Node.js 22 + Express)                     │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │     多源目录采集引擎   │  │   智能相关性引擎 │  │   元数据富化工作池│  │
│  │   8+ 聚合检索数据源   │  │   地理与行业共现 │  │   Telegram 页面解析 │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │   用户鉴权与 RBAC     │  │   机器人自动拦截 │  │   Telegram 协议端│  │
│  │   安全会话与审计日志  │  │   isBotTarget()   │  │   MTProto (可选)     │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                  SQLite 嵌入式持久化数据库 (WAL 模式 + 高速缓存)        │
│   • channels    • searches    • search_results    • users   • audit    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 快速上手（本地开发）

### 环境要求
- **Node.js** 22.0.0 或更高版本
- **npm** 10.0.0 或更高版本

### 1. 克隆代码仓库
```bash
git clone https://github.com/toxasag/search-tg.git
cd search-tg
```

### 2. 安装项目依赖
```bash
npm install
```

### 3. 配置环境变量
从示例文件复制并创建 `.env`：
```bash
cp .env.example .env
```
编辑 `.env` 设置初始管理员账号（密码长度需不低于 12 位）：
```env
# 初始管理员凭据
BOOTSTRAP_OWNER_EMAIL="owner@example.com"
BOOTSTRAP_OWNER_PASSWORD="your-strong-bootstrap-password"

# 端口与数据库路径
PORT=3000
DATABASE_PATH="./data/search-tg.sqlite"
NODE_ENV="development"
```

### 4. 运行单元测试
```bash
npm test
```

### 5. 启动本地开发服务
```bash
npm run dev
```
在浏览器中访问 [http://localhost:3000](http://localhost:3000)，使用初始管理员账号登录即可。

---

## ⚙️ 环境变量配置说明

| 变量名 | 是否必填 | 默认值 | 说明 |
|---|---|---|---|
| `PORT` | 否 | `3000` | Web 服务监听的 HTTP 端口。 |
| `DATABASE_PATH` | 否 | `./data/search-tg.sqlite` | SQLite 数据库文件存储路径。 |
| `NODE_ENV` | 否 | `development` | 生产环境请设为 `production`（开启安全 Cookie 策略）。 |
| `APP_URL` | 否 | `https://tgsearch.team-big.ru` | 线上公开访问域名（用于日志及上下文标识）。 |
| `BOOTSTRAP_OWNER_EMAIL` | 首次初始化 | `owner@example.com` | 初始管理员登录邮箱。 |
| `BOOTSTRAP_OWNER_PASSWORD` | 首次初始化 | — | 初始管理员密码（需≥12位字符）。系统初始化后建议清空此项。 |
| `GEMINI_API_KEY` | 否 | — | Google Gemini API 密钥（用于 AI 智能语义扩展与分类）。 |
| `HTTPS_PROXY` | 否 | — | 爬虫抓取使用的外部 HTTP/HTTPS 代理（如 `http://127.0.0.1:7890`）。 |
| `TG_API_ID` | 否 | — | Telegram API ID（源自 [my.telegram.org](https://my.telegram.org)）。 |
| `TG_API_HASH` | 否 | — | Telegram API Hash（源自 [my.telegram.org](https://my.telegram.org)）。 |
| `TG_SESSION_FILE` | 否 | `./data/telegram.session` | Teleproto StringSession 凭据文件存储路径。 |

---

## 🌐 目录数据源与抓取能力

| 数据源码 | 来源名称 | 抓取方式 | 特性说明 |
|---|---|---|---|
| `tgsearch` | TGSearch | HTML Search | 俄语区及国际公开 Telegram 频道数据库。 |
| `tgramcat` | TGramCat | HTML 解析 | 结构化分类与丰富频道简介。 |
| `tgramsearch` | TGramSearch | Web Serp | 高覆盖率的主题群组与频道资源。 |
| `waybien` | Waybien | 多语言引擎 | 国际化与本地化区域群组索引。 |
| `lyzem` | Lyzem | 专用搜索引擎 | 知名 Telegram 深度搜索服务。 |
| `tgcat` | TG-Cat | JSON API | 官方公开 API，支持频道与超级群，自动剔除广告与 Bot。 |
| `catalogTelegram` | Catalog Telegram | 分页卡片解析 | 智能提取卡片跳转重定向链接，不调用外部客户端。 |
| `tglib` | TGLib | Yandex Site-Search | 解析详情页，提取标准化标题、高清头像、群简介与加入按钮。 |
| `telegram` | 直连 Telegram | MTProto 协议 | 可选模块，基于独立账号进行 Telegram 官方公开搜索。 |

---

## 🎯 智能相关性引擎原理

在搜索复杂组合词（例如 `"ремонт пхукет"` / “普吉 装修” 或 `"泰国 商务"`）时，通用搜索往往会夹杂海量无关噪音。

系统内置的规则引擎执行以下逻辑：
1. **语义要素细分切分**：
   - **地理限定词（Geo）**：普吉岛、曼谷、泰国、芭提雅、迪拜、莫斯科、巴厘岛等。
   - **行业与主题限定词（Niche）**：装修、商业、房产、签证、加密货币、招聘等。
   - **形态词（Format）**：群、频道、交流群、俱乐部等。
2. **严格共现验证（Strict Co-occurrence）**：
   - 候选频道必须**同时包含**地理与行业关键词。如果只匹配到地理（例如普吉岛机车俱乐部），或者只匹配到装修（例如莫斯科装修建材），均会被精准判定为不相关并丢弃（得分为 0）。
3. **异地冲突排斥（Negative Geo Clash）**：
   - 若检索词包含普吉岛，而候选频道明确标明为巴统或莫斯科，则触发地理冲突，予以剔除。
4. **垃圾与违规信息过滤**：
   - 自动拦截色情、伴游外围、赌博彩票及站群引流垃圾。

---

## 🗄️ 全局数据库浏览器

点击导航栏中的 **“Глобальная база” (Global Database)** 可进入集中数据资产管理工作区：

1. **多维度检索**：可在全量数据中按 **“全部字段”**、**“仅标题”** 或 **“仅描述”** 进行模糊检索。
2. **细分类型筛选**：
   - 📢 **频道（Канал）**
   - 👥 **群组 / 聊天（Группа / Чат）**
   - 🔒 **私密 / 邀请群（Приватный）**（形如 `t.me/+...` 或 `t.me/joinchat/...`）
   - ❓ **待标记（Неизвестно）**
3. **多格式数据批量导出**：
   - **TXT 纯链接**：每行一个标准 Telegram URL，适合导入至自动化营销工具。
   - **TXT 结构化报告**：包含标题、用户名、订阅数、类型、链接及简介的排版报表。
   - **CSV 电子表格**：严格符合 RFC 4180 规范并附带 UTF-8 BOM，双击即可在 Microsoft Excel 中正常显示无乱码。
   - **JSON 数据流**：完整元数据对象数组，便于下游微服务自动化集成。
4. **后台批量深度富化**：
   - 支持一键调起后台异步任务，对库内所有尚未完善头像或类型的记录进行二次解析。

---

## 🐳 VPS 生产环境部署方案

### Docker 容器化部署
项目内建标准化生产级多阶段 `Dockerfile`：

```bash
# 1. 登录 VPS 并拉取代码
git clone https://github.com/toxasag/search-tg.git /opt/search-tg
cd /opt/search-tg

# 2. 生成生产环境变量配置
cp .env.example .env
nano .env

# 3. 构建并启动容器
docker compose up -d --build
```

### 反向代理配置（Nginx Proxy Manager / 原生 Nginx）
使用 **Nginx Proxy Manager** 时：
- Forward Hostname: `search-tg`（或 `127.0.0.1`）
- Forward Port: `3000`
- 开启选项：`Websockets Support`，`Block Common Exploits`
- SSL 证书：申请 Let's Encrypt 证书并勾选 `Force SSL` 与 `HTTP/2 Support`。

原生 **Nginx** 配置文件示例：
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

## 🔒 数据安全与隐私合规

- **敏感信息零提交**：`.env`、本地环境配置、SQLite 数据库文件（`*.sqlite`）、会话文件（`*.session`）及运行日志均已加入 `.gitignore`。
- **数据库冷热备份**：建议使用 SQLite 官方备份机制 `sqlite3 data/search-tg.sqlite ".backup backup.sqlite"` 进行快照，严禁在 WAL 写入期间直接复制正在运行的数据库文件。
- **会话安全性**：密码采用工业级高强度哈希算法加密，Session Cookie 强制启用 HttpOnly 和 SameSite 策略。

---

## 🧪 测试套件验证

运行自动化单元测试，确保解析器、机器人拦截、相关性判定与搜索队列运转正常：

```bash
npm test
```

预期通过结果：
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

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 发布。
