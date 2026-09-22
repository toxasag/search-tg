import React, { useEffect, useState } from "react";
import { Globe, Cpu, AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";

interface HeaderProps {
  apiKeyMissing: boolean;
}

export default function Header({ apiKeyMissing }: HeaderProps) {
  const [serverStatus, setServerStatus] = useState<"checking" | "online" | "offline">("checking");
  const [serverTime, setServerTime] = useState<string>("");

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch("/api/health");
        if (res.ok) {
          const data = await res.json();
          setServerStatus("online");
          setServerTime(new Date(data.time).toLocaleTimeString());
        } else {
          setServerStatus("offline");
        }
      } catch {
        setServerStatus("offline");
      }
    }

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="border-b border-slate-800 bg-[#0F1117] sticky top-0 z-40 px-6 py-4">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="bg-blue-600 p-2 rounded text-white shadow-sm">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white font-sans tracking-tight">
                Telegram Catalog Scraper
              </h1>
              <p className="text-xs text-slate-500 font-sans mt-0.5">
                AI-Powered & Selector-Based Directory Parser for tgramsearch.com & tgramcat.com
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          {/* Server Status Indicator */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#15181E] border border-slate-800 font-mono text-slate-300">
            <span className={`w-2 h-2 rounded-full ${
              serverStatus === "online" ? "bg-green-500 shadow-[0_0_8px_#22c55e]" :
              serverStatus === "offline" ? "bg-rose-500" : "bg-amber-400"
            }`} />
            <span className="font-semibold uppercase tracking-wider text-[10px]">
              Server: {serverStatus}
            </span>
            {serverTime && <span className="text-[10px] text-slate-500 border-l border-slate-800 pl-1.5 ml-0.5">{serverTime}</span>}
          </div>

          {/* AI Mode Capabilities */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#15181E] border border-slate-800 font-mono text-slate-300">
            <Cpu className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-semibold uppercase tracking-wider text-[10px]">
              Engine: Gemini 2.5 Flash
            </span>
          </div>

          {/* API Key Status */}
          {apiKeyMissing ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#15181E] border border-rose-900/30 font-mono text-rose-400 font-semibold text-[10px] uppercase tracking-wider">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
              API Key Not Loaded
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#15181E] border border-emerald-900/30 font-mono text-green-400 font-semibold text-[10px] uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
              AI Parser Active
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
