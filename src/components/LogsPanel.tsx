import React, { useEffect, useRef } from "react";
import { Terminal, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface LogsPanelProps {
  logs: string[];
  onClearLogs: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export default function LogsPanel({ logs, onClearLogs, isOpen, onToggle }: LogsPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, isOpen]);

  return (
    <div className="border border-slate-800 rounded bg-[#15181E] text-slate-300 shadow-sm overflow-hidden mb-6 font-mono text-xs">
      <div 
        className="flex items-center justify-between px-4 py-3 bg-[#0F1117] border-b border-slate-800 cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-green-500 animate-pulse" />
          <span className="font-semibold text-white">Scraper Operational Logs</span>
          <span className="px-2 py-0.5 rounded bg-[#0A0B0E] text-[10px] text-slate-500 font-normal">
            {logs.length} entries
          </span>
        </div>
        <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
          {logs.length > 0 && (
            <button 
              onClick={onClearLogs}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-rose-400 transition-colors"
              title="Clear operational logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button 
            onClick={onToggle}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition-colors"
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div 
            initial={{ height: 0 }}
            animate={{ height: 200 }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-y-auto p-4 flex flex-col gap-1 bg-[#0A0B0E]"
            ref={containerRef}
          >
            {logs.length === 0 ? (
              <div className="text-slate-500 italic text-center py-10">
                No logs generated yet. Perform a search or extraction to view real-time operations.
              </div>
            ) : (
              logs.map((log, index) => {
                let colorClass = "text-slate-300";
                if (log.includes("Error") || log.includes("Failed")) colorClass = "text-rose-400";
                else if (log.includes("success") || log.includes("Completed") || log.includes("found")) colorClass = "text-green-500";
                else if (log.includes("AI") || log.includes("Gemini")) colorClass = "text-blue-400";
                else if (log.includes("Fetching") || log.includes("Searching")) colorClass = "text-amber-400";

                return (
                  <div key={index} className={`leading-relaxed break-all ${colorClass}`}>
                    <span className="text-slate-500 mr-2">[{new Date().toLocaleTimeString()}]</span>
                    {log}
                  </div>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
