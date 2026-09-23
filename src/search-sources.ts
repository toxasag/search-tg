export const CATALOG_SOURCES = ["tgsearch", "tgramcat", "tgramsearch", "waybien", "lyzem", "tgcat", "catalogTelegram", "tglib"] as const;
export const SEARCH_SOURCES = ["all", "import", ...CATALOG_SOURCES, "telegram"] as const;
export const SOURCE_LABELS: Record<typeof SEARCH_SOURCES[number], string> = {
  all: "all", import: "import", tgsearch: "tgsearch", tgramcat: "tgramcat", tgramsearch: "tgramsearch",
  waybien: "waybien", lyzem: "lyzem", tgcat: "tg-cat.com", catalogTelegram: "catalog-telegram.site",
  tglib: "tglib.net", telegram: "Telegram",
};
export type SearchSource = typeof SEARCH_SOURCES[number];
