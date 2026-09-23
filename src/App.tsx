import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { 
  Search, Globe, Database, Cpu, Settings, Play, ArrowDownToLine, 
  RefreshCw, CheckCircle, XCircle, AlertCircle, Copy, Check, 
  ExternalLink, Trash2, ListFilter, HelpCircle, Info, ChevronRight, ChevronLeft,
  ChevronsLeft, ChevronsRight, X, Download,
  Eye, FileSpreadsheet, FileJson, FileText, Layers, MessageSquare, Lock, Hash, Users, BookOpen, LogOut, ShieldCheck,
  Loader2, Sparkles
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { CurrentUser, ScrapedChannel, SearchQueryHistory, ParseMode, SearchSource, SearchStats } from "./types";
import Header from "./components/Header";
import LogsPanel from "./components/LogsPanel";
import AuthScreen from "./components/AuthScreen";
import OwnerPanel from "./components/OwnerPanel";
import ChangePasswordPanel from "./components/ChangePasswordPanel";
import SearchTips from "./components/SearchTips";

function getCleanMonogram(title: string): string {
  if (!title) return "TG";
  const clean = title.replace(/^[«"'\s@#]+/, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words[0] && words[1]) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || "TG";
}

function getAvatarBgColor(title: string): string {
  const colors = [
    "bg-gradient-to-br from-blue-600 to-indigo-700 text-white",
    "bg-gradient-to-br from-emerald-600 to-teal-700 text-white",
    "bg-gradient-to-br from-purple-600 to-violet-800 text-white",
    "bg-gradient-to-br from-amber-600 to-orange-700 text-white",
    "bg-gradient-to-br from-rose-600 to-pink-700 text-white",
    "bg-gradient-to-br from-cyan-600 to-blue-700 text-white",
  ];
  let hash = 0;
  for (let i = 0; i < (title || "").length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
  const idx = Math.abs(hash) % colors.length;
  return colors[idx];
}

function GlobalDatabaseView() {
  const [data, setData] = useState<{
    channels: ScrapedChannel[];
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
    stats: { total: number; channels: number; groups: number; closed: number; unknown: number };
  }>({
    channels: [],
    totalCount: 0,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    stats: { total: 0, channels: 0, groups: 0, closed: 0, unknown: 0 }
  });

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchField, setSearchField] = useState<"all" | "title" | "description">("all");
  const [chatType, setChatType] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enrichStatus, setEnrichStatus] = useState<any>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/database/channels?page=${page}&pageSize=${pageSize}&query=${encodeURIComponent(searchQuery)}&searchField=${searchField}&chatType=${chatType}`
      );
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to fetch database channels:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 250);
    return () => clearTimeout(timer);
  }, [page, pageSize, searchQuery, searchField, chatType]);

  // Reset page to 1 when filters change
  const handleQueryChange = (val: string) => {
    setSearchQuery(val);
    setPage(1);
  };

  const handleFieldChange = (val: "all" | "title" | "description") => {
    setSearchField(val);
    setPage(1);
  };

  const handleTypeChange = (val: string) => {
    setChatType(val);
    setPage(1);
  };

  const handlePageSizeChange = (val: number) => {
    setPageSize(val);
    setPage(1);
  };

  // Poll enrichment status
  useEffect(() => {
    let timer: any = null;
    const checkStatus = async () => {
      try {
        const res = await fetch("/api/database/enrich/status");
        if (res.ok) {
          const json = await res.json();
          setEnrichStatus(json);
          if (json.running) {
            timer = setTimeout(checkStatus, 2000);
          }
        }
      } catch {
        // ignore
      }
    };
    checkStatus();
    return () => clearTimeout(timer);
  }, []);

  const startEnrichment = async () => {
    try {
      const res = await fetch("/api/database/enrich", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        setEnrichStatus(json);
      }
    } catch (e) {
      console.error("Enrichment start error:", e);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAllPage = () => {
    if (data.channels.length === 0) return;
    const allSelected = data.channels.every(c => selectedIds.has(c.id));
    const next = new Set(selectedIds);
    if (allSelected) {
      data.channels.forEach(c => next.delete(c.id));
    } else {
      data.channels.forEach(c => next.add(c.id));
    }
    setSelectedIds(next);
  };

  const copyChannelLink = (url: string, id: string) => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleExport = async (format: "txt" | "txt_report" | "csv" | "json") => {
    setIsExporting(true);
    try {
      const body: any = {
        format,
        query: searchQuery,
        searchField,
        chatType
      };
      if (selectedIds.size > 0) {
        body.ids = Array.from(selectedIds);
      }

      const res = await fetch("/api/database/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const contentDisposition = res.headers.get("content-disposition");
      let filename = `telegram_export_${new Date().toISOString().split("T")[0]}.${format === "csv" ? "csv" : format === "json" ? "json" : "txt"}`;
      if (contentDisposition && contentDisposition.includes("filename=")) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match?.[1]) filename = match[1];
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error(e);
      alert("Ошибка при экспорте данных.");
    } finally {
      setIsExporting(false);
    }
  };

  const isAllPageSelected = data.channels.length > 0 && data.channels.every(c => selectedIds.has(c.id));

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-4">
      {/* Top Banner / Actions */}
      <div className="bg-[#15181E] border border-slate-800 rounded-lg p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center text-white shadow-[0_0_15px_rgba(147,51,234,0.3)]">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight">Глобальная база Telegram</h2>
              <span className="bg-purple-950/70 border border-purple-500/30 text-purple-300 font-mono text-[11px] font-semibold px-2 py-0.5 rounded-full">
                {data.stats.total.toLocaleString()} записей
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Единый реестр проверенных каналов, чатов и групп с поиском, ручной проверкой и выгрузкой
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href="/#database"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white rounded text-xs font-semibold transition-colors"
            title="Открыть базу в новой вкладке"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>В новой вкладке</span>
          </a>

          <button
            onClick={startEnrichment}
            disabled={enrichStatus?.running}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-semibold transition-all shadow-[0_0_12px_rgba(37,99,235,0.2)] ${
              enrichStatus?.running
                ? "bg-blue-600/40 text-blue-200 cursor-not-allowed border border-blue-500/30"
                : "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${enrichStatus?.running ? "animate-spin" : ""}`} />
            <span>{enrichStatus?.running ? "Идет обогащение..." : "Проверить типы (обогатить)"}</span>
          </button>
        </div>
      </div>

      {/* Live Enrichment Progress Bar (if active) */}
      {enrichStatus?.running && (
        <div className="bg-blue-950/40 border border-blue-500/30 rounded-lg p-3 flex flex-col gap-2 shrink-0 animate-in fade-in">
          <div className="flex items-center justify-between text-xs text-blue-300 font-mono">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
              <span>Фоновое обогащение базы данных...</span>
            </span>
            <span>
              {enrichStatus.processed} / {enrichStatus.total} ({enrichStatus.total > 0 ? Math.round((enrichStatus.processed / enrichStatus.total) * 100) : 0}%)
            </span>
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${enrichStatus.total > 0 ? (enrichStatus.processed / enrichStatus.total) * 100 : 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>Обновлено: <strong className="text-green-400">{enrichStatus.enriched}</strong></span>
            <span>Ошибок/Пропущено: <strong className="text-amber-400">{enrichStatus.failed}</strong></span>
          </div>
        </div>
      )}

      {/* Type Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 shrink-0 scrollbar-thin">
        {[
          { key: "all", label: "Все", count: data.stats.total },
          { key: "channel", label: "Каналы", count: data.stats.channels },
          { key: "group", label: "Группы / Чаты", count: data.stats.groups },
          { key: "closed", label: "Приватные ссылки", count: data.stats.closed },
          { key: "unknown", label: "Неизвестно", count: data.stats.unknown },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => handleTypeChange(tab.key)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
              chatType === tab.key
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-[#15181E] border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                chatType === tab.key ? "bg-blue-800 text-blue-100" : "bg-slate-800 text-slate-400"
              }`}
            >
              {tab.count.toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      {/* Search and Filters Controls */}
      <div className="bg-[#15181E] border border-slate-800 rounded-lg p-3 flex flex-col md:flex-row items-stretch md:items-center gap-3 shrink-0">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Поиск по базе (по ключевым словам: тайланд, крипта, бизнес, ремонт)..."
            className="w-full bg-[#0F1117] border border-slate-700 rounded-lg pl-9 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => handleQueryChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-[#0F1117] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
            <span className="text-slate-500 whitespace-nowrap">Где:</span>
            <select
              value={searchField}
              onChange={(e) => handleFieldChange(e.target.value as any)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-slate-900 text-white">Везде (название + описание + @)</option>
              <option value="title" className="bg-slate-900 text-white">Только в названии и @</option>
              <option value="description" className="bg-slate-900 text-white">Только в описании</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-[#0F1117] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
            <span className="text-slate-500 whitespace-nowrap">Показывать:</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
            >
              <option value={50} className="bg-slate-900 text-white">50 / стр</option>
              <option value={100} className="bg-slate-900 text-white">100 / стр</option>
              <option value={200} className="bg-slate-900 text-white">200 / стр</option>
              <option value={500} className="bg-slate-900 text-white">500 / стр</option>
            </select>
          </div>
        </div>
      </div>

      {/* Bulk Operations Toolbar */}
      <div className="bg-[#15181E] border border-slate-800 rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSelectAllPage}
            className="flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white"
          >
            <input
              type="checkbox"
              checked={isAllPageSelected}
              onChange={toggleSelectAllPage}
              className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
            />
            <span>{isAllPageSelected ? "Снять выбор со страницы" : "Выбрать все на странице"}</span>
          </button>

          <span className="text-xs text-slate-400 border-l border-slate-800 pl-3">
            Выбрано: <strong className="text-blue-400 font-mono">{selectedIds.size}</strong>{" "}
            {selectedIds.size === 0 && <span className="text-slate-500">(для выгрузки всего списка используйте кнопки справа)</span>}
          </span>
          {selectedIds.size > 0 && (
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-rose-400 hover:text-rose-300 underline font-medium"
            >
              Сбросить
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 mr-1 hidden sm:inline">Экспорт:</span>
          <button
            onClick={() => handleExport("txt")}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0F1117] hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white rounded text-xs font-semibold transition-colors disabled:opacity-50"
            title="Выгрузить прямые ссылки в TXT"
          >
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span>TXT ссылки</span>
          </button>

          <button
            onClick={() => handleExport("txt_report")}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0F1117] hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white rounded text-xs font-semibold transition-colors disabled:opacity-50"
            title="Выгрузить подробный отчет с описаниями в TXT"
          >
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
            <span>TXT отчёт</span>
          </button>

          <button
            onClick={() => handleExport("csv")}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0F1117] hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white rounded text-xs font-semibold transition-colors disabled:opacity-50"
            title="Выгрузить в таблицу CSV (для Excel)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>CSV Excel</span>
          </button>

          <button
            onClick={() => handleExport("json")}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0F1117] hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white rounded text-xs font-semibold transition-colors disabled:opacity-50"
            title="Выгрузить в JSON"
          >
            <FileJson className="w-3.5 h-3.5 text-amber-400" />
            <span>JSON</span>
          </button>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="flex-1 overflow-auto min-h-0 bg-[#0F1117] border border-slate-800 rounded-lg shadow-inner">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <p className="text-xs text-slate-400 font-mono">Загрузка данных из реестра...</p>
          </div>
        ) : data.channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-slate-500">
            <Database className="w-10 h-10 text-slate-600 stroke-[1.5]" />
            <p className="text-sm font-semibold text-slate-400">Ничего не найдено</p>
            <p className="text-xs text-slate-500">Попробуйте изменить поисковый запрос или фильтр типа</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#15181E] border-b border-slate-800 sticky top-0 z-10 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllPageSelected}
                    onChange={toggleSelectAllPage}
                    className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
                  />
                </th>
                <th className="p-3">Канал / Чат</th>
                <th className="p-3 hidden md:table-cell">Описание</th>
                <th className="p-3 whitespace-nowrap">Аудитория</th>
                <th className="p-3 whitespace-nowrap">Тип</th>
                <th className="p-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40 text-xs">
              {data.channels.map((channel) => {
                const isSelected = selectedIds.has(channel.id);
                return (
                  <tr
                    key={channel.id}
                    className={`hover:bg-slate-800/30 transition-colors ${
                      isSelected ? "bg-blue-950/20" : ""
                    }`}
                  >
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(channel.id)}
                        className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
                      />
                    </td>

                    {/* Channel / Chat Avatar & Details */}
                    <td className="p-3">
                      <div className="flex items-center gap-3 max-w-[280px]">
                        {channel.imageUrl ? (
                          <img
                            src={channel.imageUrl}
                            alt=""
                            className="w-10 h-10 rounded-full object-cover shrink-0 border border-slate-700/50 shadow-sm"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0 shadow-inner ${getAvatarBgColor(
                              channel.title
                            )}`}
                          >
                            {getCleanMonogram(channel.title)}
                          </div>
                        )}

                        <div className="min-w-0">
                          <div
                            className="font-semibold text-white truncate text-xs"
                            title={channel.title}
                          >
                            {channel.title || "Без названия"}
                          </div>
                          {channel.telegramUrl ? (
                            <a
                              href={channel.telegramUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 text-[11px] truncate flex items-center gap-1 mt-0.5"
                            >
                              <span>
                                {channel.username ? `@${channel.username}` : channel.telegramUrl.replace("https://t.me/", "")}
                              </span>
                              <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                            </a>
                          ) : (
                            <span className="text-[11px] text-slate-500">Нет ссылки</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Description */}
                    <td className="p-3 hidden md:table-cell max-w-md">
                      <div
                        className="text-slate-400 text-xs line-clamp-2 leading-relaxed"
                        title={channel.description}
                      >
                        {channel.description || (
                          <span className="text-slate-600 italic">Описание отсутствует</span>
                        )}
                      </div>
                    </td>

                    {/* Audience / Subscribers */}
                    <td className="p-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 font-mono text-slate-300">
                        <Users className="w-3.5 h-3.5 text-slate-500" />
                        <span>{channel.subscribers || "—"}</span>
                      </div>
                    </td>

                    {/* Chat Type Badge */}
                    <td className="p-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          channel.chatType === "channel"
                            ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                            : channel.chatType === "group"
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                            : channel.chatType === "closed"
                            ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                            : channel.chatType === "bot"
                            ? "bg-purple-500/15 text-purple-300 border border-purple-500/30"
                            : channel.chatType === "contact"
                            ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                            : "bg-slate-800 text-slate-400 border border-slate-700"
                        }`}
                      >
                        {channel.chatType === "channel"
                          ? "Канал"
                          : channel.chatType === "group"
                          ? "Группа / Чат"
                          : channel.chatType === "closed"
                          ? "Приватный"
                          : channel.chatType === "bot"
                          ? "Бот"
                          : channel.chatType === "contact"
                          ? "Контакт"
                          : "Неизвестно"}
                      </span>
                    </td>

                    {/* Action buttons */}
                    <td className="p-3 text-right whitespace-nowrap">
                      {channel.telegramUrl && (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => copyChannelLink(channel.telegramUrl!, channel.id)}
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                            title="Копировать ссылку в буфер"
                          >
                            {copiedId === channel.id ? (
                              <Check className="w-3.5 h-3.5 text-green-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <a
                            href={channel.telegramUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-blue-400 transition-colors"
                            title="Открыть в Telegram"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="bg-[#15181E] border border-slate-800 rounded-lg p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shrink-0">
        <div className="text-slate-400">
          Показано{" "}
          <strong className="text-white font-mono">
            {data.totalCount > 0 ? (page - 1) * pageSize + 1 : 0}
          </strong>{" "}
          -{" "}
          <strong className="text-white font-mono">
            {Math.min(page * pageSize, data.totalCount)}
          </strong>{" "}
          из <strong className="text-white font-mono">{data.totalCount.toLocaleString()}</strong> записей
        </div>

        <div className="flex items-center gap-1.5">
          <button
            disabled={page <= 1}
            onClick={() => setPage(1)}
            className="p-1.5 rounded bg-[#0F1117] border border-slate-700 text-slate-300 hover:text-white disabled:opacity-40 disabled:pointer-events-none"
            title="Первая страница"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#0F1117] border border-slate-700 text-slate-300 hover:text-white disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Назад</span>
          </button>

          <span className="px-3 py-1 font-mono text-slate-300 bg-slate-900 border border-slate-800 rounded">
            Стр {page} из {data.totalPages || 1}
          </span>

          <button
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#0F1117] border border-slate-700 text-slate-300 hover:text-white disabled:opacity-40 disabled:pointer-events-none"
          >
            <span>Вперед</span>
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            disabled={page >= data.totalPages}
            onClick={() => setPage(data.totalPages)}
            className="p-1.5 rounded bg-[#0F1117] border border-slate-700 text-slate-300 hover:text-white disabled:opacity-40 disabled:pointer-events-none"
            title="Последняя страница"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [viewMode, setViewMode] = useState<"dashboard" | "database">(window.location.hash === "#database" ? "database" : "dashboard");
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [activeSearchStatus, setActiveSearchStatus] = useState<any | null>(null);
  const [isOwnerPanelOpen, setIsOwnerPanelOpen] = useState(false);

  useEffect(() => {
    const handleHash = () => {
      setViewMode(window.location.hash === "#database" ? "database" : "dashboard");
    };
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  // Scraper State
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SearchSource>("all");
  const [mode, setMode] = useState<ParseMode>("fast");
  const [limitPages, setLimitPages] = useState<number>(500); // Max pages to scan per catalog, default to 500
  const [channels, setChannels] = useState<ScrapedChannel[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(true);
  const [lastDuplicateCount, setLastDuplicateCount] = useState<number>(0);
  
  // Last search stats
  const [lastSearchStats, setLastSearchStats] = useState<SearchStats | null>(null);

  // Filters & Searching inside Scraped Results
  const [textFilter, setTextFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | SearchSource>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "guessed" | "pending" | "failed">("all");
  const [chatTypeFilter, setChatTypeFilter] = useState<"all" | "channel" | "group" | "closed" | "unknown">("all");

  // Client-side pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50); // Default to 50 channels per page

  // Selection & Details Modal State
  const [selectedChannel, setSelectedChannel] = useState<ScrapedChannel | null>(null);
  const [modalTab, setModalTab] = useState<"info" | "similar">("info");
  const [history, setHistory] = useState<SearchQueryHistory[]>([]);

  // Bulk Extraction Queue State
  const [isExtractingBulk, setIsExtractingBulk] = useState(false);
  const [bulkQueue, setBulkQueue] = useState<string[]>([]); // Array of channel IDs
  const [currentBulkIndex, setCurrentBulkIndex] = useState(0);
  const [bulkDelay, setBulkDelay] = useState(1500); // 1.5s delay to mimic human behavior and avoid catalog bans

  // Clipboard Copied Indicator State
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedChannelId, setCopiedChannelId] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  // Check if GEMINI_API_KEY is available in metadata or backend
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  // Load the authenticated user's persisted workspace.
  const loadSearches = async () => {
    const response = await fetch("/api/searches");
    if (!response.ok) return;
    const data = await response.json();
    setHistory(data.searches.map((search: any) => ({
      id: search.id,
      query: search.query,
      source: search.source,
      mode: search.mode,
      limitPages: search.limitPages,
      status: search.status,
      resultCount: search.resultCount,
      timestamp: search.createdAt,
    })));
  };

  const loadSearch = async (searchId: string) => {
    const response = await fetch(`/api/searches/${searchId}`);
    if (!response.ok) throw new Error("Saved search could not be loaded.");
    const data = await response.json();
    setActiveSearchId(data.id);
    setQuery(data.query);
    setSource(data.source);
    setMode(data.mode);
    setLimitPages(data.limitPages);
    setChannels(data.results);
    setLogs(data.logs || []);
    setLastSearchStats(data.searchStats || null);
    setSourceFilter("all");
    setTextFilter("");
    setStatusFilter("all");
    setChatTypeFilter("all");
    setCurrentPage(1);
  };

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (response) => {
        const data = await response.json();
        setCurrentUser(data.user);
        setNeedsBootstrap(Boolean(data.needsBootstrap));
      })
      .catch(() => setCurrentUser(null))
      .finally(() => setIsAuthLoading(false));
  }, []);

  useEffect(() => {
    if (currentUser) void loadSearches();
  }, [currentUser]);

  useEffect(() => {
    if (!activeSearchId || !currentUser) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/searches/${activeSearchId}/status`);
        if (!response.ok || stopped) return;
        const status = await response.json();
        setActiveSearchStatus(status);

        // Fetch progressive results and logs dynamically
        const saved = await fetch(`/api/searches/${activeSearchId}`);
        if (saved.ok && !stopped) {
          const data = await saved.json();
          setChannels(data.results || []);
          setLogs(data.logs || []);
          if (data.searchStats) setLastSearchStats(data.searchStats);
        }

        if (["completed", "failed", "cancelled"].includes(status.status)) {
          setIsSearching(false);
          await loadSearches();
          return;
        }
      } catch {}
      if (!stopped) {
        window.setTimeout(refresh, 1500);
      }
    };
    void refresh();
    return () => { stopped = true; };
  }, [activeSearchId, currentUser]);

  // Always-fresh mirror of `channels`, used by async flows (extractLink, bulk queue)
  // so they never act on a stale closure snapshot of the array.
  const channelsRef = useRef<ScrapedChannel[]>(channels);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  // Functional client update. Persistent writes are performed by protected API routes.
  const updateChannels = (updater: (prev: ScrapedChannel[]) => ScrapedChannel[]) => {
    setChannels((prev) => updater(prev));
  };

  // Real-time logger wrapper
  const addLog = (message: string) => {
    setLogs((prev) => [...prev, message]);
  };

  // Perform Scraper Search API request
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    setIsLogsOpen(true);
    setLastSearchStats(null);
    setChannels([]);
    setActiveSearchId(null);
    setActiveSearchStatus(null);
    setLogs([`[${new Date().toISOString()}] Initiating search for "${query.trim()}" across ${source === "all" ? "all directories" : source}...`]);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), source, mode, limitPages, requestId: `${Date.now()}` }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const data = await response.json();
      setActiveSearchId(String(data.searchId));
      setActiveSearchStatus({ status: data.status, progress: 0, currentSource: null });
      await loadSearches();
    } catch (err: any) {
      setIsSearching(false);
      addLog(`[Error] Failed to start search: ${err.message}`);
      if (err.message && err.message.includes("GEMINI_API_KEY")) {
        setApiKeyMissing(true);
      }
    }
  };

  // Perform single Telegram link extraction
  const extractLink = async (channelId: string) => {
    const channel = channelsRef.current.find((c) => c.id === channelId);
    if (!channel) return;

    // Update state to extracting
    updateChannels((prev) => prev.map((c) =>
      c.id === channelId ? { ...c, extractionStatus: "extracting" as const } : c
    ));
    addLog(`[Extraction] Launching parser for "${channel.title}" (${channel.source})...`);

    try {
      const response = await fetch("/api/extract-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultId: Number(channelId) }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error ${response.status}`);
      }

      const data = await response.json();

      // Merge logs
      if (data.logs && Array.isArray(data.logs)) {
        data.logs.forEach((backendLog: string) => addLog(`[Backend] ${backendLog}`));
      }

      if (data.success && data.result) {
        addLog(`[Extraction] Success! Found Telegram link for "${channel.title}": ${data.result.telegramUrl}`);
        updateChannels((prev) => prev.map((c) => c.id === channelId ? data.result : c));
      } else {
        addLog(`[Extraction] Warning: No Telegram link found on catalog page for "${channel.title}".`);
        updateChannels((prev) => prev.map((c) =>
          c.id === channelId ? {
            ...c,
            extractionStatus: "failed" as const,
            error: "No link found on page"
          } : c
        ));
      }
    } catch (err: any) {
      addLog(`[Extraction] Error extracting link for "${channel.title}": ${err.message}`);
      updateChannels((prev) => prev.map((c) =>
        c.id === channelId ? {
          ...c,
          extractionStatus: "failed" as const,
          error: err.message
        } : c
      ));
    }
  };

  const [importStatus, setImportStatus] = useState<{ running: boolean; searchId: number | null; total: number; processed: number; enriched: number; failed: number } | null>(null);

  const pollImportStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/import/enrich/status");
      if (res.ok) {
        const data = await res.json();
        setImportStatus(data);
        if (data.running) {
          if (activeSearchId) void loadSearch(activeSearchId);
          setTimeout(pollImportStatus, 2500);
        } else if (data.total > 0) {
          if (activeSearchId) await loadSearch(activeSearchId);
          await loadSearches();
        }
      }
    } catch {}
  }, [activeSearchId]);

  const enrichImported = async () => {
    addLog("[Import] Запуск массового фонового обогащения импортированных ссылок.");
    try {
      const res = await fetch("/api/import/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchId: activeSearchId ? Number(activeSearchId) : undefined })
      });
      const data = await res.json();
      setImportStatus(data);
      pollImportStatus();
      addLog(`[Import] Фоновое обогащение запущено. Ожидайте прогресса.`);
    } catch (error: any) { addLog(`[Import] Ошибка обогащения: ${error.message}`); }
  };

  // Bulk Extraction Engine / Queue Loop
  useEffect(() => {
    if (!isExtractingBulk || bulkQueue.length === 0 || currentBulkIndex >= bulkQueue.length) {
      if (isExtractingBulk) {
        setIsExtractingBulk(false);
        addLog(`[Bulk Engine] Finished all bulk extractions. Queue completed.`);
      }
      return;
    }

    const nextId = bulkQueue[currentBulkIndex];
    const channel = channelsRef.current.find(c => c.id === nextId);

    if (!channel || channel.extractionStatus === "success" || channel.extractionStatus === "guessed") {
      // Skip if already success
      setCurrentBulkIndex(prev => prev + 1);
      return;
    }

    // Process the next channel after the defined rate-limit delay
    const timer = setTimeout(async () => {
      const current = channelsRef.current.find(c => c.id === nextId);
      addLog(`[Bulk Engine] Processing queue item ${currentBulkIndex + 1}/${bulkQueue.length}: "${current?.title ?? nextId}"`);
      await extractLink(nextId);
      setCurrentBulkIndex(prev => prev + 1);
    }, bulkDelay);

    return () => clearTimeout(timer);
    // NOTE: `channels` is intentionally excluded — extractLink() mutates channels mid-flight,
    // and re-running this effect on every such mutation would reschedule/duplicate the timer
    // for the same queue index (see bug: index skipping / duplicate extraction requests).
  }, [isExtractingBulk, bulkQueue, currentBulkIndex, bulkDelay]);

  // Start Bulk Extraction for all filtered/pending channels
  const startBulkExtraction = () => {
    const selectedSearchChannels = activeSearchId ? filteredChannels.filter((channel) => channel.searchId === activeSearchId) : filteredChannels;
    const pendingIds = selectedSearchChannels
      .filter(c => c.extractionStatus === "pending" || c.extractionStatus === "failed")
      .map(c => c.id);

    if (pendingIds.length === 0) {
      addLog(`[Bulk Engine] No pending channels found to extract.`);
      return;
    }

    addLog(`[Bulk Engine] Starting bulk link extraction. Queued ${pendingIds.length} channels with a ${bulkDelay}ms rate-limit interval...`);
    setBulkQueue(pendingIds);
    setCurrentBulkIndex(0);
    setIsExtractingBulk(true);
  };

  // Stop Bulk Extraction
  const stopBulkExtraction = () => {
    setIsExtractingBulk(false);
    addLog(`[Bulk Engine] Bulk extraction execution paused by user.`);
  };

  // Filter and Search computed array
  const filteredChannels = useMemo(() => {
    return channels.filter((ch) => {
      const matchText = 
        ch.title.toLowerCase().includes(textFilter.toLowerCase()) ||
        ch.description.toLowerCase().includes(textFilter.toLowerCase()) ||
        (ch.username && ch.username.toLowerCase().includes(textFilter.toLowerCase()));
      
      const matchSource = sourceFilter === "all" || ch.source.toLowerCase().includes(sourceFilter.toLowerCase());
      
      const matchStatus = 
        statusFilter === "all" || 
        ch.extractionStatus === statusFilter;

      const chType = ch.chatType || "unknown";
      const matchChatType = 
        chatTypeFilter === "all" || 
        chType === chatTypeFilter;

      return matchText && matchSource && matchStatus && matchChatType;
    });
  }, [channels, textFilter, sourceFilter, statusFilter, chatTypeFilter]);

  // Stats Counters
  const counters = useMemo(() => {
    return {
      total: channels.length,
      filtered: filteredChannels.length,
      success: channels.filter(c => c.extractionStatus === "success").length,
      guessed: channels.filter(c => c.extractionStatus === "guessed").length,
      pending: channels.filter(c => c.extractionStatus === "pending").length,
      failed: channels.filter(c => c.extractionStatus === "failed").length,
      
      // Chat types counters
      channelsCount: channels.filter(c => (c.chatType || "unknown") === "channel").length,
      groupsCount: channels.filter(c => (c.chatType || "unknown") === "group").length,
      closedCount: channels.filter(c => (c.chatType || "unknown") === "closed").length,
      unknownTypeCount: channels.filter(c => (c.chatType || "unknown") === "unknown" || !c.chatType).length,
    };
  }, [channels, filteredChannels]);

  // Client-side pagination calculations
  const paginatedChannels = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return filteredChannels.slice(startIndex, endIndex);
  }, [filteredChannels, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredChannels.length / pageSize) || 1;

  // Reset page when any filter or page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [textFilter, sourceFilter, statusFilter, chatTypeFilter, pageSize]);

    // Export to CSV helper
  const exportToCSV = () => {
    if (filteredChannels.length === 0) return;
    
    // Headers
    const headers = ["Title", "Source Catalog", "Subscribers", "Catalog URL", "Telegram URL", "Username", "Description"];
    
    // Rows
    const rows = filteredChannels.map(c => [
      `"${c.title.replace(/"/g, '""')}"`,
      c.source,
      `"${(c.subscribers || "").replace(/"/g, '""')}"`,
      `"${c.detailUrl}"`,
      `"${c.telegramUrl || ""}"`,
      `"${c.username || ""}"`,
      `"${c.description.replace(/"/g, '""')}"`
    ]);

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(e => e.join(";"))].join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `telegram_channels_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addLog(`[Export] Successfully compiled and downloaded CSV dataset for ${filteredChannels.length} channels.`);
  };

  // Export to JSON helper
  const exportToJSON = () => {
    if (filteredChannels.length === 0) return;
    const jsonStr = JSON.stringify(filteredChannels, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `telegram_channels_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addLog(`[Export] Successfully compiled and downloaded JSON dataset for ${filteredChannels.length} channels.`);
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportLinksToTXT = () => {
    const exportChannels = activeSearchId ? filteredChannels.filter((channel) => channel.searchId === activeSearchId) : filteredChannels;
    const links = Array.from(new Set(exportChannels.map((channel) => channel.telegramUrl).filter((url): url is string => Boolean(url))));
    if (links.length === 0) return addLog("[Export] No direct Telegram links are available for TXT export.");
    downloadFile(links.join("\n") + "\n", `telegram_links_${new Date().toISOString().split("T")[0]}.txt`, "text/plain;charset=utf-8");
    addLog(`[Export] Downloaded ${links.length} unique direct links as TXT.`);
  };

  const exportReportToTXT = () => {
    const exportChannels = activeSearchId ? filteredChannels.filter((channel) => channel.searchId === activeSearchId) : filteredChannels;
    if (exportChannels.length === 0) return;
    const report = exportChannels.map((channel) => [
      `Название: ${channel.title}`,
      `Описание: ${channel.channelDescription || channel.description || "—"}`,
      `Тип: ${channel.chatType || "unknown"}`,
      `Источник: ${channel.source}`,
      `Каталог: ${channel.detailUrl}`,
      `Telegram: ${channel.telegramUrl || "не найдено"}`,
    ].join("\n")).join("\n\n");
    downloadFile(report + "\n", `telegram_report_${new Date().toISOString().split("T")[0]}.txt`, "text/plain;charset=utf-8");
    addLog(`[Export] Downloaded extended TXT report for ${exportChannels.length} records.`);
  };

  // Copy all extracted links to clipboard
  const copyAllLinks = () => {
    const links = filteredChannels
      .map(c => c.telegramUrl)
      .filter((url): url is string => !!url);

    if (links.length === 0) {
      addLog(`[Clipboard] No extracted Telegram links available to copy.`);
      return;
    }

    navigator.clipboard.writeText(links.join("\n"));
    setCopiedAll(true);
    addLog(`[Clipboard] Copied ${links.length} Telegram links to clipboard.`);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  // Copy single link
  const copySingleLink = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedChannelId(id);
    setTimeout(() => setCopiedChannelId(null), 1500);
  };

  const clearDatabase = async () => {
    if (!activeSearchId) return;
    if (!isConfirmingClear) {
      setIsConfirmingClear(true);
      addLog("[Database] Click Clear Search again to confirm deletion.");
      return;
    }
    const response = await fetch(`/api/searches/${activeSearchId}`, { method: "DELETE" });
    if (!response.ok) return addLog("[Database] The selected saved search could not be deleted.");
    setChannels([]);
    setLogs([]);
    setActiveSearchId(null);
    setLastSearchStats(null);
    setIsConfirmingClear(false);
    await loadSearches();
    addLog("[Database] Deleted the selected saved search and its records.");
  };

  const deleteChannel = async (channel: ScrapedChannel) => {
    const response = await fetch(`/api/results/${channel.id}`, { method: "DELETE" });
    if (!response.ok) return addLog(`[Database] Could not delete "${channel.title}".`);
    setChannels((current) => current.filter((item) => item.id !== channel.id));
    addLog(`[Database] Deleted channel "${channel.title}" from this search.`);
    await loadSearches();
  };

  const deleteSearchFromHistory = async (searchId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Удалить этот поиск и все его результаты?")) return;
    const res = await fetch(`/api/searches/${searchId}`, { method: "DELETE" });
    if (!res.ok) { addLog(`[History] Не удалось удалить поиск: HTTP ${res.status}`); return; }
    if (activeSearchId === searchId) { setActiveSearchId(null); setChannels([]); setLogs([]); setLastSearchStats(null); }
    await loadSearches();
    addLog(`[History] Поиск ${searchId} удален.`);
  };

  // Click on a past history item to load its persisted results
  const applyHistoryQuery = async (h: SearchQueryHistory) => {
    try {
      await loadSearch(h.id);
    } catch (error: any) {
      addLog(`[History] ${error.message}`);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
    setChannels([]);
    setHistory([]);
    setActiveSearchId(null);
  };

  const handlePasswordChanged = () => {
    setCurrentUser((user) => user ? { ...user, mustChangePassword: false } : user);
  };

  if (isAuthLoading) return <div className="min-h-screen bg-[#0A0B0E]" />;
  if (!currentUser) return <AuthScreen needsBootstrap={needsBootstrap} onAuthenticated={setCurrentUser} />;

  return (
    <div className="flex flex-col lg:flex-row h-screen w-full bg-[#0A0B0E] font-sans text-slate-300 overflow-hidden text-sm">
      {/* Sidebar Navigation */}
      <aside className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-slate-800 bg-[#0F1117] flex flex-col flex-shrink-0">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between lg:block">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold text-white shadow-[0_0_12px_rgba(37,99,235,0.4)]">
              S
            </div>
            <div>
              <h1 className="text-white font-bold tracking-tight text-base">GraphParser</h1>
              <p className="text-[10px] text-slate-500 font-mono leading-none">ScrapeGraphAI Core</p>
            </div>
          </div>
          <div className="lg:hidden flex items-center gap-2">
            <button
              onClick={() => {
                const nextMode = viewMode === "dashboard" ? "database" : "dashboard";
                setViewMode(nextMode);
                window.location.hash = nextMode === "database" ? "#database" : "";
              }}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors border border-slate-700"
            >
              {viewMode === "dashboard" ? (
                <>
                  <Database className="w-3.5 h-3.5 text-purple-400" />
                  <span>База</span>
                </>
              ) : (
                <>
                  <Layers className="w-3.5 h-3.5 text-blue-400" />
                  <span>Поиск</span>
                </>
              )}
            </button>
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></div>
            <span className="text-[10px] font-mono text-slate-400">Active</span>
          </div>
        </div>

        <nav className="hidden lg:flex flex-1 flex-col px-4 py-4 space-y-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 pb-2">Разделы</div>
            <div className="space-y-1">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setViewMode("dashboard");
                  window.location.hash = "";
                }}
                className={`flex items-center gap-3 px-3 py-2 rounded text-xs font-semibold transition-colors ${
                  viewMode === "dashboard" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                }`}
              >
                <Layers className={`w-4 h-4 ${viewMode === "dashboard" ? "text-blue-500" : "text-slate-500"}`} />
                <span>Поиск и парсинг</span>
              </a>
              <a
                href="#database"
                onClick={(e) => {
                  e.preventDefault();
                  setViewMode("database");
                  window.location.hash = "#database";
                }}
                className={`flex items-center justify-between px-3 py-2 rounded text-xs font-semibold transition-colors ${
                  viewMode === "database" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Database className={`w-4 h-4 ${viewMode === "database" ? "text-purple-500" : "text-slate-500"}`} />
                  <span>Глобальная база</span>
                </div>
                <div className="bg-slate-900 text-[10px] px-1.5 py-0.5 rounded text-slate-300 font-mono">
                  {counters.total > 0 ? (counters.total >= 1000 ? (counters.total / 1000).toFixed(1) + "k" : counters.total) : "..."}
                </div>
              </a>
            </div>
          </div>

          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 pb-2">Database Stats</div>
            <div className="bg-[#0A0B0E] rounded p-3 border border-slate-800 space-y-2.5 text-xs">
              <div className="flex justify-between items-center text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  Total Scraped:
                </span>
                <span className="font-mono text-white font-bold">{counters.total}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  Resolved Links:
                </span>
                <span className="font-mono text-green-400 font-bold">{counters.success}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                  Guessed Links:
                </span>
                <span className="font-mono text-yellow-400 font-bold">{counters.guessed}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  Pending:
                </span>
                <span className="font-mono text-amber-400 font-bold">{counters.pending}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                  Failed:
                </span>
                <span className="font-mono text-rose-400 font-bold">{counters.failed}</span>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={clearDatabase}
              onMouseLeave={() => setIsConfirmingClear(false)}
              disabled={channels.length === 0}
              className={`w-full text-xs font-semibold px-3 py-2 rounded border transition-all flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed justify-center ${
                isConfirmingClear
                  ? "bg-rose-900 text-rose-100 border-rose-500 animate-pulse"
                  : "text-rose-400 hover:text-rose-300 disabled:text-slate-600 hover:bg-rose-950/20 border-transparent hover:border-rose-900/40 disabled:border-transparent"
              }`}
            >
              {isConfirmingClear ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5" />
                  Confirm Clear Search?
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Search
                </>
              )}
            </button>
          </div>
        </nav>

        <div className="hidden lg:block p-4 border-t border-slate-800 bg-[#0A0B0E]">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></div>
            <span className="text-xs font-mono text-slate-300 font-semibold">Parser: Active</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono truncate">{currentUser.email}</div>
          {currentUser.role === "owner" && <button onClick={() => setIsOwnerPanelOpen(true)} className="mt-2 text-[10px] text-blue-400 hover:text-blue-300 font-mono flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Manage users</button>}
          <button onClick={logout} className="mt-2 text-[10px] text-slate-500 hover:text-rose-400 font-mono flex items-center gap-1"><LogOut className="w-3 h-3" /> Sign out</button>
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Header apiKeyMissing={apiKeyMissing} />

        {viewMode === "database" ? (
          <div className="flex-1 p-4 md:p-6 flex flex-col min-h-0 overflow-hidden">
            <GlobalDatabaseView />
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          <ChangePasswordPanel required={currentUser.mustChangePassword} onChanged={handlePasswordChanged} />
          {activeSearchStatus && ["queued", "running", "cancelling"].includes(activeSearchStatus.status) && (
            <section className="bg-[#15181E] border border-blue-500/30 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-blue-300 font-mono">
                <span>Search {activeSearchStatus.status} {activeSearchStatus.currentSource ? `· ${activeSearchStatus.currentSource}` : ""}</span>
                <span>{activeSearchStatus.progress || 0}%</span>
              </div>
              <div className="h-1.5 rounded bg-slate-800 overflow-hidden"><div className="h-full bg-blue-500 transition-all" style={{ width: `${activeSearchStatus.progress || 3}%` }} /></div>
              <button onClick={() => activeSearchId && fetch(`/api/searches/${activeSearchId}/cancel`, { method: "POST" })} className="text-[10px] text-rose-400 hover:text-rose-300">Cancel search</button>
            </section>
          )}
          {isOwnerPanelOpen && currentUser.role === "owner" && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setIsOwnerPanelOpen(false)}>
              <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg bg-[#0F1117] p-4" onClick={e=>e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-white">Manage users</span>
                  <button onClick={() => setIsOwnerPanelOpen(false)} className="text-slate-400 hover:text-white">✕</button>
                </div>
                <OwnerPanel isOpen={true} />
              </div>
            </div>
          )}
          {/* Layout Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Column (Forms & Settings) - Col-span-4 */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              
              {/* Scraper Parameters Card */}
              <div className="bg-[#15181E] border border-slate-800 rounded-lg p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2 text-sm uppercase tracking-wider font-sans">
                  <Settings className="w-4 h-4 text-blue-500" />
                  Scraper Parameters
                </h3>

                <form onSubmit={handleSearch} className="space-y-4">
                  <div>
                    <span className="text-xs text-slate-500 block mb-1.5 uppercase font-semibold font-mono tracking-wider">Target Search Query</span>
                    <div className="relative">
                      <input 
                        type="text" 
                        placeholder="Например: бизнес тайланд, ремонт пхукет, крипта дубай..." 
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (!isSearching && query.trim()) {
                              void handleSearch();
                            }
                          }
                        }}
                        className="w-full bg-[#0A0B0E] border border-slate-700 rounded p-2.5 pl-9 text-xs text-slate-300 focus:outline-none focus:border-blue-500 font-medium transition-all"
                      />
                      <Search className="absolute left-3 top-3 text-slate-500 w-3.5 h-3.5" />
                    </div>

                    {/* Quick suggestion chips */}
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-slate-500 mr-0.5">Примеры:</span>
                      {[
                        "бизнес тайланд, бизнес пхукет",
                        "крипта дубай чат",
                        "недвижимость бали",
                        "it вакансии удаленка"
                      ].map((sample) => (
                        <button
                          key={sample}
                          type="button"
                          onClick={() => setQuery(sample)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 hover:bg-blue-600/20 text-slate-400 hover:text-blue-300 border border-slate-700/60 hover:border-blue-500/40 transition-colors"
                        >
                          {sample}
                        </button>
                      ))}
                    </div>

                    {/* Helpful tips and multi-query info */}
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-slate-500 leading-none">Разделяйте запросы через запятую</span>
                      <SearchTips onSelectQuery={(template) => setQuery(template)} />
                    </div>

                    <div className="mt-2 p-2 rounded bg-blue-500/10 border border-blue-500/20 text-[11px] text-slate-300 leading-snug">
                      <span className="text-amber-400 font-semibold mr-1">💡 Подсказка:</span>
                      Указывайте конкретное гео или тему (напр. <i>бизнес тайланд</i>). Сервис сохраняет всё в базу и отсекает нерелевантный спам.
                    </div>
                  </div>

                  {/* Target Catalog Select */}
                  <div>
                    <span className="text-xs text-slate-500 block mb-1.5 uppercase font-semibold font-mono tracking-wider">Target Catalog</span>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                      {(["all", "tgsearch", "tgramcat", "tgramsearch", "waybien", "lyzem", "tgcat", "catalogTelegram", "tglib", "telegram"] as const).map((src) => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => setSource(src)}
                          className={`py-1.5 px-2 rounded text-[10px] font-mono border transition-all ${
                            source === src 
                              ? "bg-blue-600/10 border-blue-500 text-blue-400 font-bold" 
                              : "bg-[#0A0B0E] border-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-700"
                          }`}
                        >
                          {src}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Extraction mode select */}
                  <div>
                    <span className="text-xs text-slate-500 block mb-1.5 uppercase font-semibold font-mono tracking-wider">Parsing Engine Mode</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setMode("fast")}
                        className={`py-1.5 px-2 rounded text-[11px] font-mono border flex items-center justify-center gap-1 transition-all ${
                          mode === "fast" 
                            ? "bg-blue-600/10 border-blue-500 text-blue-400 font-bold" 
                            : "bg-[#0A0B0E] border-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-700"
                        }`}
                      >
                        <Database className="w-3.5 h-3.5" />
                        Fast Selector
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("ai")}
                        className={`py-1.5 px-2 rounded text-[11px] font-mono border flex items-center justify-center gap-1 transition-all ${
                          mode === "ai" 
                            ? "bg-blue-600/10 border-blue-500 text-blue-400 font-bold" 
                            : "bg-[#0A0B0E] border-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-700"
                        }`}
                      >
                        <Cpu className="w-3.5 h-3.5 animate-pulse" />
                        AI Scraper
                      </button>
                    </div>
                  </div>

                  {/* Max Pages to Scan */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs text-slate-500 uppercase font-semibold font-mono tracking-wider">Max Pages to Scan</span>
                      <span className="text-[10px] font-mono text-blue-400 font-bold">{limitPages} pages</span>
                    </div>
                    <select
                      value={limitPages}
                      onChange={(e) => setLimitPages(parseInt(e.target.value, 10))}
                      className="w-full bg-[#0A0B0E] border border-slate-700 rounded p-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500 font-medium font-mono"
                    >
                      <option value="10">10 pages (Quick Scan)</option>
                      <option value="25">25 pages (Fast Scan)</option>
                      <option value="50">50 pages (Standard Scan)</option>
                      <option value="100">100 pages (Deep Scan)</option>
                      <option value="200">200 pages (Very Deep Scan)</option>
                      <option value="500">500 pages (Thorough Scan)</option>
                      <option value="1000">1000 pages (Complete Audit)</option>
                    </select>
                  </div>

                  {/* Run Button */}
                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isSearching || !query.trim()}
                      className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-xs py-2 rounded transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed uppercase tracking-wider"
                    >
                      {isSearching ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Searching...
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          Execute Scraper
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* Import list */}
              <div className="bg-[#15181E] border border-slate-800 rounded-lg p-5">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider font-sans">Импорт списка</h3>
                <textarea id="import-links" placeholder="Вставьте t.me ссылки — по одной на строку" className="w-full h-24 bg-[#0A0B0E] border border-slate-700 rounded p-2 text-xs text-slate-300" />
                <button onClick={async()=>{
                  setImportSummary(null);
                  setIsImporting(true);
                  setImportProgress(8);
                  const el=document.getElementById("import-links") as HTMLTextAreaElement;
                  const raw=el?.value||"";
                  if(!raw.trim()) { setIsImporting(false); return; }
                  try {
                    setImportProgress(25);
                    const r=await fetch("/api/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({links: raw})});
                    const d=await r.json();
                    if(!r.ok){ addLog(`[Import] ${d.error}`); setImportSummary(`Ошибка: ${d.error}`); return; }
                    setImportProgress(80);
                    el.value="";
                    if (d.id) {
                      await loadSearch(d.id);
                      await loadSearches();
                      pollImportStatus();
                    }
                    setImportProgress(100);
                    const summary = `Получено: ${d.inputCount} · Уникальных: ${d.uniqueCount} · Дубликатов: ${d.duplicateCount} · Из базы: ${d.alreadyStored || 0} · Новых: ${d.added || 0}`;
                    setImportSummary(summary);
                    addLog(`[Import] ${summary}. Фоновое обогащение запущено.`);
                  } catch (error: any) {
                    setImportSummary(`Ошибка импорта: ${error.message}`);
                  } finally { setIsImporting(false); }
                }} disabled={isImporting} className="mt-2 w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs py-2 rounded">{isImporting ? `Загрузка ${importProgress}%...` : "Загрузить в базу"}</button>
                {isImporting && <div className="mt-2 h-1.5 rounded bg-slate-800 overflow-hidden"><div className="h-full bg-blue-500 transition-all" style={{width:`${importProgress}%`}} /></div>}
                {importSummary && <p className="mt-2 text-xs text-blue-300 break-words">{importSummary}</p>}
                
                <button 
                  onClick={enrichImported} 
                  disabled={Boolean(importStatus?.running)} 
                  className="mt-2 w-full border border-slate-700 hover:border-blue-500 disabled:opacity-50 text-slate-300 text-xs py-2 rounded flex items-center justify-center gap-1.5 transition-colors"
                >
                  {importStatus?.running ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                      <span>Идет обогащение списка...</span>
                    </>
                  ) : (
                    "Проверить тип, описание и аватар импортированных"
                  )}
                </button>

                {importStatus?.running && (
                  <div className="mt-3 p-2.5 rounded bg-blue-950/60 border border-blue-500/30 text-xs text-blue-200 space-y-1.5">
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="flex items-center gap-1.5 text-blue-300">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        Фоновая проверка
                      </span>
                      <span>{importStatus.processed} / {importStatus.total} ({importStatus.total ? Math.round((importStatus.processed / importStatus.total) * 100) : 0}%)</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${importStatus.total ? (importStatus.processed / importStatus.total) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Обогащено: {importStatus.enriched}</span>
                      <span>Ошибок: {importStatus.failed}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Niche Search History (Styled to look like the Target JSON Schema box) */}
              <div className="bg-[#15181E] border border-slate-800 rounded-lg p-5 flex flex-col">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider font-sans">
                  <HelpCircle className="w-4 h-4 text-blue-500" />
                  Query Index
                </h3>
                <div className="bg-[#0A0B0E] rounded p-3 border border-slate-800 font-mono text-xs leading-relaxed text-blue-400 overflow-y-auto max-h-48 space-y-1.5 scrollbar-thin">
                  {history.length === 0 ? (
                    <div className="text-slate-600 italic text-[11px] text-center py-4">
                      {"// No search history yet."}
                    </div>
                  ) : (
                    history.map((h, idx) => (
                      <div
                        key={h.id}
                        onClick={() => applyHistoryQuery(h)}
                        className="cursor-pointer hover:bg-slate-800/60 p-1.5 rounded transition-colors flex items-center justify-between text-[11px] text-slate-300 border border-slate-900 hover:border-slate-800"
                      >
                        <span className="truncate max-w-[110px] font-semibold text-blue-400">"{h.query}"</span>
                        <span className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-500 font-mono bg-[#15181E] px-1 rounded uppercase">{h.source} · {h.status} · {h.resultCount}</span>
                          <button onClick={(e) => deleteSearchFromHistory(h.id, e)} className="p-0.5 hover:bg-rose-900/30 rounded text-slate-500 hover:text-rose-400" title="Удалить поиск"><Trash2 className="w-3 h-3" /></button>
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-3 text-[10px] text-slate-500 leading-relaxed font-mono">
                  {"* Fast Selector retrieves catalog rows. AI Scraper resolves hidden direct links directly via automated LLM selectors."}
                </div>
              </div>

            </div>

            {/* Right Column (Live Table Feed) - Col-span-8 */}
            <div className="lg:col-span-8 flex flex-col gap-6">

              {/* Bulk Extraction control bar directly in right grid */}
              {channels.length > 0 && (
                <div className="bg-[#15181E] border border-slate-800 rounded-lg p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="space-y-1 text-center md:text-left">
                    <h3 className="font-bold text-sm tracking-wide uppercase text-blue-400">Bulk Link Extraction Engine</h3>
                    <p className="text-[11px] text-slate-400 max-w-xl">
                      Iterates and automatically extracts direct Telegram links from the listing pages. Runs asynchronously with human latency imitation.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 bg-[#0A0B0E] border border-slate-800 rounded px-2.5 py-1 text-xs">
                      <span className="text-slate-500 text-[10px] uppercase font-bold">Delay:</span>
                      <select 
                        value={bulkDelay} 
                        onChange={(e) => setBulkDelay(Number(e.target.value))}
                        disabled={isExtractingBulk}
                        className="bg-transparent border-none focus:outline-none text-slate-200 font-mono font-bold cursor-pointer text-xs"
                      >
                        <option value={1000} className="bg-[#15181E]">1.0s (Fast)</option>
                        <option value={1500} className="bg-[#15181E]">1.5s (Mid)</option>
                        <option value={2500} className="bg-[#15181E]">2.5s (Safe)</option>
                        <option value={4000} className="bg-[#15181E]">4.0s (Slow)</option>
                      </select>
                    </div>

                    {isExtractingBulk ? (
                      <div className="flex items-center gap-3 bg-[#0A0B0E] border border-slate-800 rounded px-3 py-1">
                        <span className="text-[10px] text-slate-400 font-mono">
                          Queue: <strong className="text-blue-400">{currentBulkIndex}/{bulkQueue.length}</strong>
                        </span>
                        <button
                          onClick={stopBulkExtraction}
                          className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] px-3 py-1 rounded transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                          Pause
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={startBulkExtraction}
                        disabled={counters.pending === 0}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-[11px] px-4 py-2 rounded transition-all flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed uppercase tracking-wider"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Extract All Pending
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Live Channels Results List Feed */}
              <div className="bg-[#15181E] border border-slate-800 rounded-lg overflow-hidden flex flex-col">
                
                {/* Header row inside table */}
                <div className="bg-[#1C1F26] px-4 py-3 border-b border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-white text-xs font-bold uppercase tracking-wider">Extracted Channels (Live Feed)</h3>
                    <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded font-mono font-bold">
                      {filteredChannels.length} Channels Listed
                    </span>
                  </div>

                  {/* Action buttons */}
                  {filteredChannels.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={exportToCSV}
                        title="Export to CSV"
                        className="p-1.5 hover:bg-slate-800 border border-slate-700 rounded text-slate-300 bg-[#0A0B0E] transition-all cursor-pointer"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={exportToJSON}
                        title="Export to JSON"
                        className="p-1.5 hover:bg-slate-800 border border-slate-700 rounded text-slate-300 bg-[#0A0B0E] transition-all cursor-pointer"
                      >
                        <FileJson className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={exportLinksToTXT}
                        title="Export direct links as TXT"
                        className="p-1.5 hover:bg-slate-800 border border-slate-700 rounded text-slate-300 bg-[#0A0B0E] transition-all cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={exportReportToTXT}
                        title="Export extended TXT report"
                        className="p-1.5 hover:bg-slate-800 border border-slate-700 rounded text-slate-300 bg-[#0A0B0E] transition-all cursor-pointer"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={copyAllLinks}
                        title="Copy direct links"
                        className="px-2.5 py-1.5 hover:bg-slate-800 border border-slate-700 rounded text-slate-300 hover:text-white bg-[#0A0B0E] transition-all flex items-center gap-1 cursor-pointer font-bold text-[10px] uppercase font-mono"
                      >
                        {copiedAll ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                        <span>Copy All</span>
                      </button>
                    </div>
                  )}
                </div>

                {lastDuplicateCount > 0 && (
                  <div className="bg-blue-500/10 border-b border-blue-500/20 px-4 py-2.5 flex items-center justify-between text-xs text-blue-400">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      <span>
                        <strong>Deduplication Engine:</strong> Merged <strong>{lastDuplicateCount} duplicate channels</strong> across different catalog listings!
                      </span>
                    </div>
                    <button 
                      onClick={() => setLastDuplicateCount(0)}
                      className="text-[10px] text-slate-500 hover:text-slate-300 font-mono"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Last Search Statistics per Catalog */}
                {lastSearchStats && (
                  <div className="bg-[#11141B] border-b border-slate-800 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300">
                        <Cpu className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
                        <span>Real-time Search Session Statistics</span>
                      </div>
                      <button 
                        onClick={() => {
                          setLastSearchStats(null);
                        }}
                        className="text-[10px] text-slate-500 hover:text-slate-300 font-mono"
                      >
                        Clear Stats
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                      {Object.keys(lastSearchStats).map((src) => {
                        const stats = lastSearchStats[src];
                        const isSearched = !!stats;
                        return (
                          <div 
                            key={src}
                            onClick={() => setSourceFilter(src)}
                            className={`p-3 rounded border transition-all cursor-pointer select-none ${
                              sourceFilter === src 
                                ? "bg-blue-500/10 border-blue-500/50 shadow-md shadow-blue-500/5" 
                                : isSearched 
                                  ? "bg-[#0F1117] border-slate-800 hover:border-slate-700" 
                                  : "bg-[#0A0B0E]/50 border-slate-900 opacity-40 hover:opacity-60"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                {src}
                              </span>
                              <span className={`w-1.5 h-1.5 rounded-full ${isSearched ? "bg-green-500 animate-pulse" : "bg-slate-700"}`} />
                            </div>

                            {isSearched ? (
                              <div className="space-y-1 font-mono text-[11px]">
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Pages:</span>
                                  <span className="text-slate-200 font-bold">{stats.pagesFetched}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Found:</span>
                                  <span className="text-slate-200 font-bold">{stats.totalFound}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Duplicates:</span>
                                  <span className="text-rose-400 font-bold">{stats.duplicatesFiltered}</span>
                                </div>
                                <div className="flex justify-between border-t border-slate-800/60 pt-0.5 mt-0.5">
                                  <span className="text-blue-400 font-bold">Added:</span>
                                  <span className="text-blue-400 font-bold">{stats.uniqueAdded}</span>
                                </div>
                              </div>
                            ) : (
                              <div className="py-2 text-center text-[10px] text-slate-600 italic font-mono">
                                Skipped / No data
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Filtering bar inside live table feed container */}
                <div className="p-3 bg-[#0F1117] border-b border-slate-800 flex flex-col xl:flex-row gap-3">
                  <div className="relative flex-1">
                    <input 
                      type="text" 
                      placeholder="Быстрый фильтр по таблице ниже (по названию или описанию)..."
                      value={textFilter}
                      onChange={(e) => setTextFilter(e.target.value)}
                      className="w-full bg-[#0A0B0E] pl-9 pr-3 py-1.5 text-xs rounded border border-slate-700 text-slate-300 focus:outline-none focus:border-blue-500 font-medium font-mono"
                    />
                    <ListFilter className="absolute left-3 top-2.5 w-3 h-3 text-slate-500" />
                  </div>

                  <div className="flex flex-wrap gap-2 items-center">
                    {/* Source Filters */}
                    <div className="flex bg-[#0A0B0E] border border-slate-800 p-0.5 rounded text-[10px] font-mono">
                      {(["all", "import", "tgsearch", "tgramcat", "tgramsearch", "waybien", "lyzem", "tgcat", "catalogTelegram", "tglib", "telegram"] as const).map((sf) => (
                        <button
                          key={sf}
                          onClick={() => setSourceFilter(sf)}
                          className={`px-2 py-0.5 rounded ${sourceFilter === sf ? "bg-slate-800 text-white font-bold" : "text-slate-500 hover:text-slate-300"}`}
                        >
                          {sf}
                        </button>
                      ))}
                    </div>

                    {/* Status Filters */}
                    <div className="flex bg-[#0A0B0E] border border-slate-800 p-0.5 rounded text-[10px] font-mono">
                      {(["all", "success", "guessed", "pending", "failed"] as const).map((stf) => (
                        <button
                          key={stf}
                          onClick={() => setStatusFilter(stf)}
                          className={`px-2 py-0.5 rounded ${statusFilter === stf ? "bg-slate-800 text-white font-bold" : "text-slate-500 hover:text-slate-300"}`}
                        >
                          {stf === "all" ? "all" : stf === "success" ? "resolved" : stf === "guessed" ? "guessed" : stf}
                        </button>
                      ))}
                    </div>

                    {/* Chat Type Filters */}
                    <div className="flex bg-[#0A0B0E] border border-slate-800 p-0.5 rounded text-[10px] font-mono">
                      {(["all", "channel", "group", "closed", "unknown"] as const).map((ct) => {
                        const count = ct === "all" ? channels.length : 
                          ct === "channel" ? counters.channelsCount : 
                          ct === "group" ? counters.groupsCount : 
                          ct === "closed" ? counters.closedCount : 
                          counters.unknownTypeCount;
                        return (
                          <button
                            key={ct}
                            onClick={() => setChatTypeFilter(ct)}
                            className={`px-2 py-0.5 rounded ${chatTypeFilter === ct ? "bg-slate-800 text-white font-bold" : "text-slate-500 hover:text-slate-300"}`}
                          >
                            {ct === "all" ? "all types" : ct === "channel" ? "channels" : ct === "group" ? "groups" : ct === "closed" ? "closed/private" : "unknown"}
                            <span className="text-[8px] opacity-60 ml-1">({count})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Table list */}
                <div className="overflow-x-auto overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs" style={{ tableLayout: "fixed", width: "100%" }}>
                    <colgroup>
                      <col style={{ width: "35%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "8%" }} />
                      <col style={{ width: "32%" }} />
                      <col style={{ width: "15%" }} />
                    </colgroup>
                    <thead className="bg-[#0A0B0E] text-slate-500 text-[10px] uppercase font-mono font-bold border-b border-slate-800 sticky top-0">
                      <tr>
                        <th className="px-4 py-3">Channel Name & Description</th>
                        <th className="px-4 py-3">Source</th>
                        <th className="px-4 py-3">Subs</th>
                        <th className="px-4 py-3">Extracted Link</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-300">
                      {filteredChannels.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-slate-500 italic">
                            <div className="space-y-3 flex flex-col items-center justify-center">
                              <span>
                                {channels.length === 0 
                                  ? "No channels scraped yet. Submit a query to load directory list." 
                                  : `В текущей выборке ничего не найдено по фильтру "${textFilter}".`
                                }
                              </span>
                              {channels.length > 0 && textFilter.trim() && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setQuery(textFilter.trim());
                                    setTextFilter("");
                                    void handleSearch();
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors cursor-pointer not-italic font-sans"
                                >
                                  <Search className="w-3.5 h-3.5" />
                                  <span>Запустить глубокий поиск по всем каталогам: "{textFilter.trim()}"</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        paginatedChannels.map((channel) => (
                          <tr key={channel.id} className="hover:bg-slate-800/40 transition-colors group">
                            
                            {/* Name & Desc */}
                            <td className="px-4 py-3">
                              <div className="flex items-start gap-2.5">
                                {channel.imageUrl ? (
                                  <img 
                                    src={channel.imageUrl} 
                                    alt={channel.title}
                                    referrerPolicy="no-referrer"
                                    className="w-8 h-8 rounded-lg bg-slate-900 object-cover flex-shrink-0 border border-slate-700/60 shadow-sm"
                                    onError={(e) => {
                                      (e.target as HTMLElement).style.display = "none";
                                      const fallback = (e.target as HTMLElement).nextElementSibling;
                                      if (fallback) (fallback as HTMLElement).classList.remove("hidden");
                                    }}
                                  />
                                ) : null}
                                <div 
                                  className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 uppercase font-mono shadow-sm border border-white/10 ${getAvatarBgColor(channel.title)} ${channel.imageUrl ? "hidden" : "flex"}`}
                                >
                                  {getCleanMonogram(channel.title)}
                                </div>
                                <div className="space-y-0.5">
                                  <div className="font-semibold text-white group-hover:text-blue-400 transition-colors flex items-center gap-1.5 flex-wrap">
                                    <span>{channel.title}</span>
                                    {channel.username && (
                                      <span className="font-mono text-[10px] text-blue-400">@{channel.username}</span>
                                    )}
                                    {/* Global DB badge */}
                                    {(channel.isCached || (channel.source && channel.source.startsWith("cached"))) && (
                                      <span className="text-[8px] font-mono px-1.5 py-0.5 rounded leading-none font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                                        💾 Из базы
                                      </span>
                                    )}
                                    {/* Chat Type Badge */}
                                    <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded leading-none uppercase font-bold tracking-wider ${
                                      (channel.chatType || "unknown") === "closed" ? "bg-rose-500/15 text-rose-400 border border-rose-500/20" :
                                      (channel.chatType || "unknown") === "group" ? "bg-purple-500/15 text-purple-400 border border-purple-500/20" :
                                      (channel.chatType || "unknown") === "channel" ? "bg-green-500/15 text-green-400 border border-green-500/20" :
                                      "bg-slate-500/10 text-slate-400 border border-slate-700/30"
                                    }`}>
                                      {(channel.chatType || "unknown") === "closed" ? "Private" : (channel.chatType || "unknown") === "group" ? "Group" : (channel.chatType || "unknown") === "channel" ? "Channel" : "Unknown"}
                                    </span>
                                  </div>
                                  <p className="text-slate-400 text-[11px] font-normal break-words" title={channel.channelDescription || channel.description}>
                                    {(channel.channelDescription || channel.description || "").slice(0,180)}
                                  </p>
                                </div>
                              </div>
                            </td>

                            {/* Source */}
                            <td className="px-4 py-3 whitespace-nowrap align-middle">
                              <span className="text-[10px] font-mono font-bold bg-[#0A0B0E] text-slate-400 border border-slate-800 px-2 py-0.5 rounded">
                                {channel.source}
                              </span>
                            </td>

                            {/* Audience */}
                            <td className="px-4 py-3 whitespace-nowrap font-mono font-semibold text-slate-400 align-middle">
                              {channel.subscribers || "N/A"}
                            </td>

                            {/* Status / Link */}
                            <td className="px-4 py-3 align-middle">
                              {channel.extractionStatus === "success" && channel.telegramUrl ? (
                                <span className="text-green-500 font-mono font-medium truncate max-w-[150px] block" title={channel.telegramUrl}>
                                  {channel.telegramUrl.replace("https://t.me/", "t.me/")}
                                </span>
                              ) : channel.extractionStatus === "guessed" && channel.telegramUrl ? (
                                <div className="flex flex-col" title="Guessed link from detailed page URL. Click Extract to verify / search for direct invite link.">
                                  <span className="text-yellow-500/85 font-mono truncate max-w-[150px] block">
                                    {channel.telegramUrl.replace("https://t.me/", "t.me/")}
                                  </span>
                                  <span className="text-[9px] text-slate-500 italic block leading-none mt-0.5">guessed</span>
                                </div>
                              ) : channel.extractionStatus === "extracting" ? (
                                <span className="text-amber-500 font-mono text-[11px] flex items-center gap-1 animate-pulse">
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                  extracting...
                                </span>
                              ) : channel.extractionStatus === "failed" ? (
                                <span className="text-rose-500 font-mono text-[11px]" title={channel.error || "No link found"}>
                                  failed
                                </span>
                              ) : (
                                <span className="text-slate-500 font-mono text-[11px]">
                                  pending
                                </span>
                              )}
                            </td>

                            {/* Actions */}
                            <td className="px-4 py-3 whitespace-nowrap text-right align-middle">
                              <div className="flex items-center justify-end gap-1">
                                {(channel.extractionStatus === "success" || channel.extractionStatus === "guessed") && channel.telegramUrl ? (
                                  <>
                                    <button
                                      onClick={() => copySingleLink(channel.id, channel.telegramUrl!)}
                                      className="p-1 hover:bg-[#0A0B0E] border border-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                                      title={channel.extractionStatus === "guessed" ? "Copy guessed link" : "Copy direct link"}
                                    >
                                      {copiedChannelId === channel.id ? (
                                        <Check className="w-3.5 h-3.5 text-green-500" />
                                      ) : (
                                        <Copy className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                    <a
                                      href={channel.telegramUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="p-1 hover:bg-[#0A0B0E] border border-slate-800 rounded text-slate-400 hover:text-blue-400 transition-colors"
                                      title={channel.extractionStatus === "guessed" ? "Open guessed link in new tab" : "Open Telegram Channel"}
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                    {channel.extractionStatus === "guessed" && (
                                      <button
                                        onClick={() => extractLink(channel.id)}
                                        disabled={channel.extractionStatus === "extracting" || isExtractingBulk}
                                        className="bg-blue-600/15 border border-blue-500/30 hover:border-blue-500 text-blue-400 hover:text-blue-300 font-semibold text-[9px] px-1.5 py-0.5 rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed uppercase tracking-wider ml-1"
                                        title="Guessed link. Click Extract to parse actual page and find verified/invite link."
                                      >
                                        Extract
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    onClick={() => extractLink(channel.id)}
                                    disabled={channel.extractionStatus === "extracting" || isExtractingBulk}
                                    className="bg-[#0A0B0E] border border-slate-700 hover:border-blue-500 disabled:opacity-30 text-slate-300 hover:text-blue-400 font-semibold text-[10px] px-2.5 py-1 rounded transition-colors disabled:cursor-not-allowed uppercase tracking-wider"
                                  >
                                    Extract
                                  </button>
                                )}

                                <button
                                  onClick={() => {
                                    setSelectedChannel(channel);
                                    setModalTab("info");
                                  }}
                                  className="p-1 hover:bg-[#0A0B0E] border border-slate-800 rounded text-slate-500 hover:text-slate-300 transition-colors"
                                  title="Inspect metadata details"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  onClick={() => deleteChannel(channel)}
                                  className="p-1 hover:bg-rose-950/20 border border-transparent hover:border-rose-900 rounded text-slate-500 hover:text-rose-400 transition-colors"
                                  title="Delete record"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>

                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Table summary bar */}
                <div className="p-3.5 bg-[#0F1117] border-t border-slate-800 text-[10px] text-slate-500 flex flex-col sm:flex-row justify-between gap-2 font-mono">
                  <span>Showing {counters.filtered} of {counters.total} scraped database records</span>
                  <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /> {counters.success} Extracted</span>
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-500" /> {counters.guessed} Guessed</span>
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> {counters.pending} Pending</span>
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> {counters.failed} Failed</span>
                  </span>
                </div>

                {/* Client-side Pagination Panel */}
                {filteredChannels.length > 0 && (
                  <div className="px-4 py-3 bg-[#11141A] border-t border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
                    {/* Page size configuration */}
                    <div className="flex items-center gap-2 text-slate-400">
                      <span>Channels per page:</span>
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                        className="bg-[#0A0B0E] border border-slate-750 rounded px-2.5 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={200}>200</option>
                      </select>
                    </div>

                    {/* Pagination buttons */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                        className="px-2 py-1 bg-[#0A0B0E] border border-slate-700 hover:border-slate-550 disabled:opacity-40 rounded text-[11px] font-mono text-slate-300 disabled:cursor-not-allowed"
                      >
                        &lt;&lt; First
                      </button>
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-2.5 py-1 bg-[#0A0B0E] border border-slate-700 hover:border-slate-550 disabled:opacity-40 rounded text-[11px] font-mono text-slate-300 disabled:cursor-not-allowed"
                      >
                        &lt; Prev
                      </button>
                      
                      <div className="px-3 py-1 bg-slate-900 border border-slate-800 text-slate-300 font-mono font-medium rounded text-[11px]">
                        Page <strong className="text-white">{currentPage}</strong> of <strong className="text-white">{totalPages}</strong>
                      </div>

                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-2.5 py-1 bg-[#0A0B0E] border border-slate-700 hover:border-slate-550 disabled:opacity-40 rounded text-[11px] font-mono text-slate-300 disabled:cursor-not-allowed"
                      >
                        Next &gt;
                      </button>
                      <button
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                        className="px-2 py-1 bg-[#0A0B0E] border border-slate-700 hover:border-slate-550 disabled:opacity-40 rounded text-[11px] font-mono text-slate-300 disabled:cursor-not-allowed"
                      >
                        Last &gt;&gt;
                      </button>
                    </div>

                    {/* Showing range indicator */}
                    <div className="text-slate-500 font-mono text-[10px]">
                      Showing {Math.min(filteredChannels.length, (currentPage - 1) * pageSize + 1)}-{Math.min(filteredChannels.length, currentPage * pageSize)} of {filteredChannels.length} listed
                    </div>
                  </div>
                )}

              </div>

            </div>

          </div>

          {/* Real-time logging console */}
          <LogsPanel 
            logs={logs} 
            onClearLogs={() => setLogs([])} 
            isOpen={isLogsOpen} 
            onToggle={() => setIsLogsOpen(!isLogsOpen)} 
          />

        </div>
        )}

        {/* Footer block matching Geometric Balance */}
        <footer className="h-12 border-t border-slate-800 bg-[#0F1117] px-8 flex items-center justify-between text-[10px] text-slate-500 font-mono flex-shrink-0">
          <div className="flex items-center gap-6">
            <span>NODE_CLUSTER: default-us-east</span>
            <span>ENGINE: SmartScraperGraph</span>
            <span>LLM: Gemini-3.5-Flash</span>
          </div>
          <div>LATENCY: 421ms</div>
        </footer>
      </main>

      {/* Detail Inspector dialog / modal */}
      <AnimatePresence>
        {selectedChannel && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#15181E] rounded-lg max-w-xl w-full border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header section */}
              <div className="p-5 border-b border-slate-800 bg-[#0F1117] flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-[#0A0B0E] border border-slate-800 flex items-center justify-center text-white font-bold text-lg uppercase font-mono">
                    {selectedChannel.title.substring(0, 2)}
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-white leading-tight">
                      {selectedChannel.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="px-1.5 py-0.5 rounded bg-[#0A0B0E] border border-slate-800 text-[10px] text-slate-400 font-bold uppercase font-mono">
                        {selectedChannel.source}
                      </span>
                      {selectedChannel.subscribers && (
                        <span className="text-[10px] text-slate-500 font-semibold font-mono">
                          {selectedChannel.subscribers} Subscribers
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedChannel(null)}
                  className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* Tabs Section */}
              <div className="flex border-b border-slate-800 bg-[#0F1117] text-xs px-5">
                <button
                  onClick={() => setModalTab("info")}
                  className={`py-3 px-4 border-b-2 font-semibold transition-colors flex items-center gap-1.5 ${
                    modalTab === "info"
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  General Metadata
                </button>
                <button
                  onClick={() => setModalTab("similar")}
                  className={`py-3 px-4 border-b-2 font-semibold transition-colors flex items-center gap-1.5 ${
                    modalTab === "similar"
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  Similar Channels
                  <span className="bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded-full text-[9px] font-mono">
                    {selectedChannel.similarChannels?.length || 0}
                  </span>
                </button>
              </div>

              {/* Body Section */}
              <div className="p-6 space-y-5 overflow-y-auto flex-1">
                {modalTab === "info" ? (
                  <>
                    {/* Real-time description */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono">Description</span>
                      <p className="text-xs text-slate-300 leading-relaxed bg-[#0A0B0E] border border-slate-800 p-3 rounded font-normal">
                        {selectedChannel.channelDescription || selectedChannel.description || "No detailed description extracted."}
                      </p>
                    </div>

                    {/* Direct Telegram links */}
                    <div className="space-y-2">
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono">Direct Access Details</span>
                      {selectedChannel.telegramUrl ? (
                        <div className="bg-green-500/5 border border-green-500/20 p-3 rounded flex items-center justify-between gap-4">
                          <div>
                            <div className="text-xs font-bold text-white">Extracted Telegram Link</div>
                            <a 
                              href={selectedChannel.telegramUrl} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="text-xs font-semibold text-green-400 hover:underline font-mono truncate max-w-sm block mt-0.5"
                            >
                              {selectedChannel.telegramUrl}
                            </a>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => copySingleLink(selectedChannel.id, selectedChannel.telegramUrl!)}
                              className="bg-[#0A0B0E] border border-slate-700 hover:border-slate-600 text-slate-300 p-2 rounded transition-colors"
                              title="Copy Link"
                            >
                              {copiedChannelId === selectedChannel.id ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                            <a
                              href={selectedChannel.telegramUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-[#0A0B0E] border border-slate-800 p-4 rounded text-center space-y-2">
                          <div className="text-xs text-slate-500">Telegram link has not been extracted yet.</div>
                          <button
                            onClick={() => {
                              extractLink(selectedChannel.id);
                              setSelectedChannel(null);
                            }}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] px-3.5 py-1.5 rounded transition-all uppercase tracking-wider"
                          >
                            Extract Link Now
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Directory Catalog links */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono">Directory Meta Detail Link</span>
                      <div className="flex items-center justify-between p-3 border border-slate-800 rounded bg-[#0A0B0E] text-xs">
                        <span className="font-medium text-slate-400 truncate max-w-xs">{selectedChannel.detailUrl}</span>
                        <a 
                          href={selectedChannel.detailUrl} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 font-semibold"
                        >
                          Visit Directory
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>

                    {/* Additional Stats parsed */}
                    {selectedChannel.stats && (
                      <div className="space-y-2">
                        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono">Extracted Channel Statistics</span>
                        <div className="grid grid-cols-2 gap-3">
                          {Object.entries(selectedChannel.stats).map(([k, v]) => (
                            <div key={k} className="p-2.5 border border-slate-800 bg-[#0A0B0E] rounded text-xs">
                              <div className="text-slate-500 text-[10px] uppercase font-bold tracking-wider font-mono">{k}</div>
                              <div className="font-bold text-white mt-0.5">{v}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-4">
                    <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono">
                      Similar Channels listed on source directory
                    </div>
                    {selectedChannel.similarChannels && selectedChannel.similarChannels.length > 0 ? (
                      <div className="divide-y divide-slate-800/80 max-h-[50vh] overflow-y-auto pr-1">
                        {selectedChannel.similarChannels.map((ch, idx) => (
                          <div key={idx} className="py-3 flex items-center justify-between gap-3 text-xs">
                            <div className="truncate">
                              <div className="font-semibold text-white truncate">{ch.title}</div>
                              {ch.subscribers && (
                                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{ch.subscribers}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <a
                                href={ch.detailUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 hover:bg-[#0A0B0E] border border-slate-800 hover:border-slate-700 rounded text-slate-400 hover:text-blue-400 transition-colors flex items-center gap-1 text-[10px] px-2.5 font-medium"
                              >
                                Visit Page
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-[#0A0B0E] border border-slate-800 p-8 rounded text-center space-y-2.5">
                        <Users className="w-8 h-8 text-slate-600 mx-auto" />
                        <div className="text-xs text-slate-400 font-medium">No similar channels are cached for this record.</div>
                        <p className="text-[11px] text-slate-500 leading-relaxed max-w-sm mx-auto">
                          Try running <strong>Extract</strong> first on this channel from the main list. Similar channels are discovered and extracted dynamically when parsing the detail page.
                        </p>
                      </div>
                    )}
                  </div>
                )}

              </div>

              {/* Footer action button */}
              <div className="p-4 border-t border-slate-800 bg-[#0F1117] flex justify-end">
                <button
                  onClick={() => setSelectedChannel(null)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs px-4 py-2 rounded transition-colors"
                >
                  Close Metadata
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
