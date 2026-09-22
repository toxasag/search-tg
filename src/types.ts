export interface ScrapedChannel {
  id: string;
  searchId?: string;
  title: string;
  description: string;
  subscribers: string | null;
  detailUrl: string;
  imageUrl: string | null;
  source: string;
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
    rawCardsFound?: number;
    totalFound: number;
    tgLinksFound?: number;
    duplicatesFiltered: number;
    uniqueAdded: number;
  };
}

export interface SearchQueryHistory {
  id: string;
  query: string;
  source: SearchSource;
  mode: ParseMode;
  limitPages?: number;
  status?: "running" | "completed" | "failed";
  resultCount?: number;
  timestamp: string;
}

export interface CurrentUser {
  id: number;
  email: string;
  role: "owner" | "user";
  mustChangePassword: boolean;
}

export interface ManagedUser {
  id: number;
  email: string;
  role: "owner" | "user";
  is_active: number;
  must_change_password: number;
  created_at: string;
}

export type ParseMode = "fast" | "ai";
export type SearchSource = "all" | "tgsearch" | "tgramcat" | "tgramsearch" | "waybien" | "lyzem" | "tgcat" | "catalogTelegram" | "tglib" | "telegram";
