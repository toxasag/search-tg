import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  Search, Globe, Database, Cpu, Settings, Play, ArrowDownToLine, 
  RefreshCw, CheckCircle, XCircle, AlertCircle, Copy, Check, 
  ExternalLink, Trash2, ListFilter, HelpCircle, Info, ChevronRight,
  Eye, FileSpreadsheet, FileJson, Layers, MessageSquare, Lock, Hash, Users, BookOpen
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ScrapedChannel, SearchQueryHistory, ParseMode, SearchSource, SearchStats } from "./types";
import Header from "./components/Header";
import LogsPanel from "./components/LogsPanel";

export default function App() {
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
  const [lastSearchStats, setLastSearchStats] = useState<SearchStats | null>(() => {
    const saved = localStorage.getItem("last_search_stats");
    return saved ? JSON.parse(saved) : null;
  });

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
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  // Check if GEMINI_API_KEY is available in metadata or backend
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  // Load state from LocalStorage on mount
  useEffect(() => {
    const savedChannels = localStorage.getItem("scraped_channels");
    if (savedChannels) {
      try {
        setChannels(JSON.parse(savedChannels));
      } catch (e) {
        console.error("Failed to parse saved channels", e);
      }
    }

    const savedHistory = localStorage.getItem("scraped_history");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse saved history", e);
      }
    }
  }, []);

  // Save channels to LocalStorage whenever they change
  const saveChannels = (updatedChannels: ScrapedChannel[]) => {
    setChannels(updatedChannels);
    localStorage.setItem("scraped_channels", JSON.stringify(updatedChannels));
  };

  // Always-fresh mirror of `channels`, used by async flows (extractLink, bulk queue)
  // so they never act on a stale closure snapshot of the array.
  const channelsRef = useRef<ScrapedChannel[]>(channels);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  // Functional update variant: reads/writes the latest state instead of a captured `channels` closure.
  const updateChannels = (updater: (prev: ScrapedChannel[]) => ScrapedChannel[]) => {
    setChannels((prev) => {
      const next = updater(prev);
      localStorage.setItem("scraped_channels", JSON.stringify(next));
      return next;
    });
  };

  // Save history to LocalStorage
  const saveHistory = (updatedHistory: SearchQueryHistory[]) => {
    setHistory(updatedHistory);
    localStorage.setItem("scraped_history", JSON.stringify(updatedHistory));
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
    localStorage.removeItem("last_search_stats");

    const rawQueries = query.split(/[,;\n]+/).map(q => q.trim()).filter(Boolean);
    if (rawQueries.length === 0) {
      setIsSearching(false);
      return;
    }

    addLog(`Initiating multi-query search for [${rawQueries.join(", ")}] on ${source === "all" ? "all directories" : source} using ${mode === "fast" ? "Fast Selector Mode" : "AI Scraper Mode"}...`);

    try {
      let accumulatedChannels: ScrapedChannel[] = [...channels];
      const combinedStats: SearchStats = {};
      let duplicatesTotal = 0;

      for (let i = 0; i < rawQueries.length; i++) {
        const subQuery = rawQueries[i];
        addLog(`[Engine] Running search query ${i + 1}/${rawQueries.length}: "${subQuery}"...`);

        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: subQuery, source, mode, limitPages }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP error ${response.status}`);
        }

        const data = await response.json();
        
        // Merge stats if available
        if (data.searchStats) {
          Object.keys(data.searchStats).forEach((srcKey) => {
            if (!combinedStats[srcKey]) {
              combinedStats[srcKey] = { pagesFetched: 0, rawCardsFound: 0, totalFound: 0, tgLinksFound: 0, duplicatesFiltered: 0, uniqueAdded: 0 };
            }
            combinedStats[srcKey].pagesFetched += data.searchStats[srcKey].pagesFetched || 0;
            combinedStats[srcKey].rawCardsFound = (combinedStats[srcKey].rawCardsFound || 0) + (data.searchStats[srcKey].rawCardsFound || 0);
            combinedStats[srcKey].totalFound += data.searchStats[srcKey].totalFound || 0;
            combinedStats[srcKey].tgLinksFound = (combinedStats[srcKey].tgLinksFound || 0) + (data.searchStats[srcKey].tgLinksFound || 0);
            combinedStats[srcKey].duplicatesFiltered += data.searchStats[srcKey].duplicatesFiltered || 0;
            combinedStats[srcKey].uniqueAdded += data.searchStats[srcKey].uniqueAdded || 0;

            const st = data.searchStats[srcKey];
            addLog(`[Report] Найдено ${st.rawCardsFound || st.totalFound} (из них ${st.tgLinksFound !== undefined ? st.tgLinksFound : st.totalFound} содержат t.me), уникальных: ${st.uniqueAdded} именно для ${srcKey}.`);
          });
        }

        // Merge logs returned from backend
        if (data.logs && Array.isArray(data.logs)) {
          data.logs.forEach((backendLog: string) => addLog(`[Backend: "${subQuery}"] ${backendLog}`));
        }

        if (data.results && Array.isArray(data.results)) {
          // Formulate new results
          const newChannels: ScrapedChannel[] = data.results.map((item: any) => ({
            id: `${item.source.replace(/[\s,]+/g, "-")}-${encodeURIComponent(item.detailUrl)}`,
            title: item.title,
            description: item.description,
            subscribers: item.subscribers,
            detailUrl: item.detailUrl,
            imageUrl: item.imageUrl,
            source: item.source,
            telegramUrl: item.telegramUrl || null,
            username: item.username || null,
            channelDescription: item.channelDescription || null,
            stats: item.stats || null,
            extractionStatus: item.extractionStatus || "pending",
            chatType: item.chatType || "unknown",
            timestamp: new Date().toISOString(),
          }));

          addLog(`[Engine] Query "${subQuery}" retrieved ${newChannels.length} channel records.`);

          // Deduplication & Merging engine
          const getDeduplicationKey = (ch: ScrapedChannel): string => {
            if (ch.telegramUrl) {
              const m = ch.telegramUrl.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{3,})/i);
              if (m) return m[1].toLowerCase();
            }
            const detailMatch = ch.detailUrl.match(/(?:\/(?:channel|group|chat|cat|catalog|c|g|show|tg|t)\/|@)([a-zA-Z0-9_]{3,100})/i);
            if (detailMatch && detailMatch[1]) {
              const u = detailMatch[1].toLowerCase();
              const excluded = ["search", "about", "contact", "privacy", "terms", "faq", "help", "channels", "groups", "add", "catalog", "category", "categories", "en", "ru", "feedback", "show", "tg", "t", "pages", "page"];
              if (!excluded.includes(u)) {
                return u;
              }
            }
            return "title_" + ch.title.toLowerCase().replace(/[^a-z0-9а-яё]/gi, "");
          };

          const mergedMap = new Map<string, ScrapedChannel>();

          // Process current accumulated list first
          accumulatedChannels.forEach((ch) => {
            const key = getDeduplicationKey(ch);
            mergedMap.set(key, ch);
          });

          // Merge new channels on top of accumulated ones
          newChannels.forEach((ch) => {
            const key = getDeduplicationKey(ch);
            if (mergedMap.has(key)) {
              duplicatesTotal++;
              const existing = mergedMap.get(key)!;
              const isExistingBetter = existing.extractionStatus === "success";
              
              const existingSources = (existing.source || "").split(",").map(s => s.trim());
              const newSources = (ch.source || "").split(",").map(s => s.trim());
              const combinedSources = Array.from(new Set([...existingSources, ...newSources])).filter(Boolean).join(", ");

              mergedMap.set(key, {
                ...existing,
                ...ch,
                extractionStatus: isExistingBetter ? "success" : ch.extractionStatus,
                telegramUrl: existing.telegramUrl || ch.telegramUrl,
                username: existing.username || ch.username,
                channelDescription: existing.channelDescription || ch.channelDescription,
                stats: existing.stats || ch.stats,
                subscribers: existing.subscribers || ch.subscribers,
                source: combinedSources,
                chatType: ch.chatType && ch.chatType !== "unknown" ? ch.chatType : (existing.chatType || "unknown"),
                timestamp: existing.timestamp || ch.timestamp
              });
            } else {
              mergedMap.set(key, ch);
            }
          });

          accumulatedChannels = Array.from(mergedMap.values());
        }
      }

      setLastDuplicateCount(duplicatesTotal);
      saveChannels(accumulatedChannels);
      
      if (Object.keys(combinedStats).length > 0) {
        setLastSearchStats(combinedStats);
        localStorage.setItem("last_search_stats", JSON.stringify(combinedStats));
      }

      if (duplicatesTotal > 0) {
        addLog(`[Engine] Scrape merged. Found and merged ${duplicatesTotal} duplicate entries based on unique identifiers.`);
      }

      // Add to history
      const newHistoryItem: SearchQueryHistory = {
        query: query.trim(),
        source,
        mode,
        timestamp: new Date().toISOString(),
      };
      const updatedHistory = [newHistoryItem, ...history.filter(h => h.query !== query.trim())].slice(0, 10);
      saveHistory(updatedHistory);

    } catch (err: any) {
      addLog(`Error performing search: ${err.message}`);
      if (err.message.includes("GEMINI_API_KEY")) {
        setApiKeyMissing(true);
      }
    } finally {
      setIsSearching(false);
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
        body: JSON.stringify({ detailUrl: channel.detailUrl, mode }),
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

      if (data.success && data.telegramUrl) {
        addLog(`[Extraction] Success! Found Telegram link for "${channel.title}": ${data.telegramUrl}`);
        updateChannels((prev) => prev.map((c) =>
          c.id === channelId ? {
            ...c,
            telegramUrl: data.telegramUrl,
            username: data.username,
            channelDescription: data.channelDescription,
            stats: data.stats,
            similarChannels: data.similarChannels || null,
            extractionStatus: "success" as const
          } : c
        ));
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

    if (!channel || channel.extractionStatus === "success") {
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
    const pendingIds = filteredChannels
      .filter(c => c.extractionStatus !== "success")
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

  // Clear current scraped channels list
  const clearDatabase = () => {
    if (!isConfirmingClear) {
      setIsConfirmingClear(true);
      addLog(`[Database] Click "Clear Database" again to confirm deletion.`);
      return;
    }
    saveChannels([]);
    setLastSearchStats(null);
    addLog(`[Database] Cleared all scraped channel records and stats from memory.`);
    setIsConfirmingClear(false);
  };

  // Click on a past history item to re-search
  const applyHistoryQuery = (h: SearchQueryHistory) => {
    setQuery(h.query);
    setSource(h.source);
    setMode(h.mode);
  };

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
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></div>
            <span className="text-[10px] font-mono text-slate-400">Active</span>
          </div>
        </div>

        <nav className="hidden lg:flex flex-1 flex-col px-4 py-4 space-y-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 pb-2">Operations</div>
            <div className="space-y-1">
              <a href="#" className="flex items-center gap-3 px-3 py-2 bg-slate-800 text-white rounded text-xs font-semibold">
                <Layers className="w-4 h-4 text-blue-500" />
                <span>Dashboard Feed</span>
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
                  Confirm Clear?
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Database
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
          <div className="text-[10px] text-slate-500 font-mono">v1.2.4-stable</div>
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Header apiKeyMissing={apiKeyMissing} />

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
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
                        placeholder="e.g. freelance, crypto..." 
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="w-full bg-[#0A0B0E] border border-slate-700 rounded p-2.5 pl-9 text-xs text-slate-300 focus:outline-none focus:border-blue-500 font-medium transition-all"
                      />
                      <Search className="absolute left-3 top-3 text-slate-500 w-3.5 h-3.5" />
                    </div>
                    <div className="mt-2.5 flex items-center justify-end">
                      <span className="text-[9px] font-mono text-slate-500 leading-none">Multi-query (split by comma)</span>
                    </div>
                  </div>

                  {/* Target Catalog Select */}
                  <div>
                    <span className="text-xs text-slate-500 block mb-1.5 uppercase font-semibold font-mono tracking-wider">Target Catalog</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["all", "tgsearch", "tgramcat", "tgramsearch", "waybien", "lyzem"] as const).map((src) => (
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
                        key={idx}
                        onClick={() => applyHistoryQuery(h)}
                        className="cursor-pointer hover:bg-slate-800/60 p-1.5 rounded transition-colors flex items-center justify-between text-[11px] text-slate-300 border border-slate-900 hover:border-slate-800"
                      >
                        <span className="truncate max-w-[130px] font-semibold text-blue-400">"{h.query}"</span>
                        <span className="text-[10px] text-slate-500 font-mono bg-[#15181E] px-1 rounded uppercase">{h.source}</span>
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
                          localStorage.removeItem("last_search_stats");
                        }}
                        className="text-[10px] text-slate-500 hover:text-slate-300 font-mono"
                      >
                        Clear Stats
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                      {(["tgsearch", "tgramcat", "tgramsearch", "waybien", "lyzem"] as const).map((src) => {
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
                      placeholder="Filter results by keyword or description..."
                      value={textFilter}
                      onChange={(e) => setTextFilter(e.target.value)}
                      className="w-full bg-[#0A0B0E] pl-9 pr-3 py-1.5 text-xs rounded border border-slate-700 text-slate-300 focus:outline-none focus:border-blue-500 font-medium font-mono"
                    />
                    <ListFilter className="absolute left-3 top-2.5 w-3 h-3 text-slate-500" />
                  </div>

                  <div className="flex flex-wrap gap-2 items-center">
                    {/* Source Filters */}
                    <div className="flex bg-[#0A0B0E] border border-slate-800 p-0.5 rounded text-[10px] font-mono">
                      {(["all", "tgsearch", "tgramcat", "tgramsearch", "waybien", "lyzem"] as const).map((sf) => (
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
                            {channels.length === 0 
                              ? "No channels scraped yet. Submit a query to load directory list." 
                              : "No channels match the filter query."
                            }
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
                                    className="w-8 h-8 rounded bg-slate-900 object-cover flex-shrink-0 border border-slate-800"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(channel.title)}`;
                                    }}
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-bold text-xs flex-shrink-0 uppercase font-mono">
                                    {channel.title.substring(0, 2)}
                                  </div>
                                )}
                                <div className="space-y-0.5">
                                  <div className="font-semibold text-white group-hover:text-blue-400 transition-colors flex items-center gap-1.5 flex-wrap">
                                    <span>{channel.title}</span>
                                    {channel.username && (
                                      <span className="font-mono text-[10px] text-blue-400">@{channel.username}</span>
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
                                  <p className="text-slate-400 text-[11px] line-clamp-1 font-normal">
                                    {channel.channelDescription || channel.description}
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
                                  onClick={() => {
                                    saveChannels(channels.filter(c => c.id !== channel.id));
                                    addLog(`[Database] Deleted channel "${channel.title}" from dataset.`);
                                  }}
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
