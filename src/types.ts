export interface ScrapedChannel {
  id: string;
  title: string;
  description: string;
  subscribers: string | null;
  detailUrl: string;
  imageUrl: string | null;
  source: string; // Allows merged sources (e.g., "tgsearch, tgramcat")
  telegramUrl: string | null;
  username: string | null;
  channelDescription: string | null;
  stats: Record<string, string> | null;
  extractionStatus: "pending" | "extracting" | "success" | "guessed" | "failed";
  chatType?: "channel" | "group" | "closed" | "unknown";
  error?: string;
  timestamp: string;
  similarChannels?: { title: string; detailUrl: string; subscribers: string | null }[];
}

export interface SearchStats {
  [source: string]: {
    pagesFetched: number;
    totalFound: number;
    duplicatesFiltered: number;
    uniqueAdded: number;
  };
}

export interface SearchQueryHistory {
  query: string;
  source: string;
  mode: "fast" | "ai";
  timestamp: string;
}

export type ParseMode = "fast" | "ai";
export type SearchSource = "all" | "tgsearch" | "tgramcat" | "tgramsearch" | "waybien" | "lyzem";
