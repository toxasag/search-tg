/**
 * Relevance & Search Intent Engine for Telegram Channels & Groups.
 * Accurately matches user query intent, distinguishes specific qualifiers (geography, niche)
 * from general category terms, and eliminates irrelevant spam.
 */

// Common Russian and English stopwords to ignore during matching
const STOP_WORDS = new Set([
  // Russian
  "и", "в", "во", "не", "что", "он", "на", "я", "с", "со", "как", "а", "то", "все", "она",
  "так", "его", "но", "да", "ты", "к", "ко", "у", "же", "вы", "за", "бы", "по", "только",
  "ее", "мне", "было", "вот", "от", "ото", "меня", "еще", "о", "об", "обо", "из", "изо",
  "ему", "теперь", "когда", "даже", "ну", "вдруг", "ли", "если", "уже", "или", "ни", "быть",
  "был", "него", "до", "вас", "нибудь", "опять", "уж", "вам", "ведь", "там", "потом", "себя",
  "ничего", "ей", "может", "они", "тут", "где", "есть", "надо", "ней", "для", "мы", "тебя",
  "их", "чем", "была", "сам", "чтоб", "без", "будто", "чего", "раз", "тоже", "себе", "под",
  "будет", "ж", "тогда", "кто", "этот", "того", "потому", "этого", "какой", "совсем", "ним",
  "здесь", "этом", "один", "почти", "мой", "тем", "чтобы", "нее", "сейчас", "были", "куда",
  "зачем", "всех", "никогда", "можно", "при", "наконец", "два", "общий", "другой", "хоть",
  "после", "над", "больше", "тот", "через", "эти", "нас", "про", "всего", "них", "какая",
  // English
  "the", "a", "an", "and", "or", "in", "on", "at", "for", "of", "to", "with", "by", "from",
  "about", "into", "through", "during", "before", "after", "above", "below", "is", "are", "was",
  "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "can", "could",
  "should", "would", "may", "might", "must", "all", "any", "some", "it", "this", "that"
]);

// Format words indicating chat/group/channel type
export const FORMAT_WORDS = new Set([
  "чат", "чаты", "чата", "чате", "chat", "chats",
  "канал", "каналы", "канала", "канале", "channel", "channels",
  "группа", "группы", "группе", "сообщество", "сообщества", "group", "groups", "community",
  "клуб", "клубы", "клуба", "клубе", "club"
]);

// General category/topic words that frequently appear in queries
export const GENERAL_TOPIC_WORDS = new Set([
  // Business & Entrepreneurship
  "бизнес", "бизнеса", "бизнесе", "бизнесу", "бизнесом", "бизнесы", "бизнесов", "бизнесам",
  "бизнесмен", "бизнесмена", "бизнесмены", "бизнесменов", "бизнесвумен", "бизнеследи",
  "business", "biz", "b2b", "b2c",
  "предприниматель", "предприниматели", "предпринимателей", "предпринимателям", "предпринимателями", "предпринимателях",
  "предпринимательство", "предпринимательства", "предпринимательству", "предпринимательством", "предпринимательстве",
  "предпринимател",
  "стартап", "стартапы", "стартапов", "стартапам", "стартапами", "стартапе", "стартапа",
  "startup", "startups", "entrepreneur", "entrepreneurs",
  "нетворкинг", "networking",
  "коммерция", "коммерческий", "коммерческая", "ecommerce",
  "деловой", "деловая", "деловые", "делового", "деловом", "делов",

  // Chats & Formats
  "чат", "чаты", "чата", "чате", "chat", "chats",
  "канал", "каналы", "канала", "канале", "channel", "channels",
  "группа", "группы", "группе", "сообщество", "сообщества", "group", "groups", "community",
  "новости", "новостей", "новостишка", "news",
  "клуб", "клубы", "клуба", "клубе", "club",
  "общение", "беседа", "флудилка",

  // Jobs
  "работа", "работы", "работу", "вакансии", "вакансий", "job", "jobs", "work", "резюме", "фриланс", "freelance",
  "блог", "блоги", "блога", "blog",

  // Investment & Finance
  "инвестиции", "инвестиций", "инвестор", "инвесторы", "инвесторов", "инвестировать", "инвестици", "invest", "investment", "investor",
  "деньги", "финансы", "финансовый", "finance", "money",
  "маркетинг", "marketing", "реклама", "трафик", "ads", "pr", "пиар",

  // Tech & IT
  "it", "айти", "разработка", "dev", "программирование",

  // Crypto
  "крипта", "крипты", "криптовалюта", "криптовалюты", "crypto", "биткоин", "bitcoin", "btc", "eth", "usdt",

  // Realty
  "недвижимость", "недвижимости", "недвижка", "realty", "realestate", "аренда", "жилье", "apartments", "condo", "вилла", "виллы",

  // Expatriates, Russian diaspora & Community
  "русские", "русский", "русская", "русское", "русских", "русскоязычные", "русскоязычный", "русскоязычная", "русскоязычное",
  "соотечественники", "экспаты", "экспат", "наши", "диаспора", "community", "expats", "russian", "russians"
]);

// Core topics excluding format indicators
export const CORE_TOPIC_WORDS = new Set(
  Array.from(GENERAL_TOPIC_WORDS).filter(w => !FORMAT_WORDS.has(w))
);

// Canonical geographical terms
export const GEO_CANONICAL_WORDS = new Set([
  "thailand", "phuket", "samui", "phangan", "pattaya", "bangkok",
  "bali", "indonesia",
  "dubai",
  "moscow", "spb", "russia",
  "china", "turkey", "georgia", "tbilisi", "batumi", "kazakhstan", "almaty", "astana", "cyprus"
]);

// Adult, spam, gambling, vulgar profanity, and illicit keywords that must never appear in clean search results
export const SPAM_ADULT_WORDS = [
  "порно", "porn", "porno", "порнух", "хентай", "hentai", "инцест", "зоофил", "педофил",
  "секс", "sex", "интим", "шлюх", "проститут", "шкур", "эскорт", "escort",
  "milf", "мамки", "онлифанс", "onlyfans", "эротик", "erotic", "erotica", "nsfw", "ххх", "xxx", "18+",
  "ебля", "ебат", "ебут", "ебет", "ебан", "трах", "выдроч", "дрочк", "дрочит", "конча", "кончил", "сперм",
  "ледибой", "ladyboy", "транс", "трап",
  "сисяст", "сиськ", "сисек", "сиси", "титки", "титьки",
  "анальщ", "анал", "anal", "минет", "куни", "кунилингус", "дилдо", "вибратор", "страпон",
  "член", "пизд", "вагин", "пенис", "хуй", "хуе", "хуя", "хуи", "хуесос",
  "казино", "casino", "1win", "1xbet", "vulkan", "вулкан", "покердом",
  "наркотик", "закладк", "мефедрон", "гашиш", "кокаин", "амфетамин", "hydra", "darknet",
  "сливы 18", "сливы шкур", "приватка 18"
];

// Canonical dictionary mapping synonyms/transliterations to a canonical root
const SYNONYM_MAP: Record<string, string> = {
  // Thailand / Phuket
  "тайланд": "thailand",
  "тайланда": "thailand",
  "тайланде": "thailand",
  "тайланду": "thailand",
  "тайландом": "thailand",
  "таиланд": "thailand",
  "таиланда": "thailand",
  "таиланде": "thailand",
  "таиланду": "thailand",
  "таиландом": "thailand",
  "тай": "thailand",
  "тайск": "thailand",
  "тайский": "thailand",
  "тайская": "thailand",
  "тайское": "thailand",
  "тайские": "thailand",
  "тайских": "thailand",
  "тайскому": "thailand",
  "тайской": "thailand",
  "thailand": "thailand",
  "thai": "thailand",
  "пхукет": "phuket",
  "пхукета": "phuket",
  "пхукете": "phuket",
  "пхукету": "phuket",
  "пхукетом": "phuket",
  "пхукетск": "phuket",
  "пхукетский": "phuket",
  "пхукетская": "phuket",
  "пхукетские": "phuket",
  "пхукетских": "phuket",
  "phuket": "phuket",
  "самуи": "samui",
  "samui": "samui",
  "панган": "phangan",
  "phangan": "phangan",
  "паттайя": "pattaya",
  "паттая": "pattaya",
  "pattaya": "pattaya",
  "бангкок": "bangkok",
  "бангкока": "bangkok",
  "бангкоке": "bangkok",
  "bangkok": "bangkok",
  // Bali / Indonesia
  "бали": "bali",
  "bali": "bali",
  "индонезия": "indonesia",
  "indonesia": "indonesia",
  // Dubai / UAE
  "дубай": "dubai",
  "дубая": "dubai",
  "дубае": "dubai",
  "дубаи": "dubai",
  "оаэ": "dubai",
  "dubai": "dubai",
  "uae": "dubai",
  // Russia / Cities
  "москва": "moscow",
  "москвы": "moscow",
  "москве": "moscow",
  "московск": "moscow",
  "московский": "moscow",
  "мск": "moscow",
  "moscow": "moscow",
  "питер": "spb",
  "петербург": "spb",
  "спб": "spb",
  "spb": "spb",
  "россия": "russia",
  "россии": "russia",
  "российск": "russia",
  "российский": "russia",
  "рф": "russia",
  "russia": "russia",
  // Other regions
  "китай": "china",
  "китая": "china",
  "china": "china",
  "турция": "turkey",
  "турции": "turkey",
  "turkey": "turkey",
  "грузия": "georgia",
  "грузии": "georgia",
  "тбилиси": "tbilisi",
  "georgia": "georgia",
  "батуми": "batumi",
  "казахстан": "kazakhstan",
  "алматы": "almaty",
  "астана": "astana",
  "кипр": "cyprus",
  "cyprus": "cyprus",
  // Business
  "бизнес": "business",
  "бизнеса": "business",
  "бизнесе": "business",
  "бизнесу": "business",
  "бизнесом": "business",
  "бизнесы": "business",
  "бизнесов": "business",
  "бизнесам": "business",
  "бизнесмен": "business",
  "бизнесмена": "business",
  "бизнесмену": "business",
  "бизнесменом": "business",
  "бизнесмены": "business",
  "бизнесменов": "business",
  "бизнесвумен": "business",
  "бизнеследи": "business",
  "business": "business",
  "biz": "business",
  "b2b": "business",
  "b2c": "business",
  "предприниматели": "business",
  "предприниматель": "business",
  "предпринимателей": "business",
  "предпринимателям": "business",
  "предпринимателями": "business",
  "предпринимателях": "business",
  "предпринимателя": "business",
  "предпринимателю": "business",
  "предпринимателем": "business",
  "предпринимател": "business",
  "предпринимательство": "business",
  "предпринимательства": "business",
  "предпринимательству": "business",
  "предпринимательством": "business",
  "предпринимательстве": "business",
  "entrepreneur": "business",
  "entrepreneurs": "business",
  "стартап": "startup",
  "стартапы": "startup",
  "стартапов": "startup",
  "стартапам": "startup",
  "стартапами": "startup",
  "стартапе": "startup",
  "startup": "startup",
  "startups": "startup",
  "нетворкинг": "networking",
  "networking": "networking",
  // Investment
  "инвестиции": "invest",
  "инвестиций": "invest",
  "инвестор": "invest",
  "инвесторы": "invest",
  "инвесторов": "invest",
  "инвестировать": "invest",
  "инвестици": "invest",
  "invest": "invest",
  "investment": "invest",
  "investor": "invest",
  // Crypto
  "крипта": "crypto",
  "крипты": "crypto",
  "криптовалюта": "crypto",
  "криптовалюты": "crypto",
  "crypto": "crypto",
  "bitcoin": "crypto",
  "btc": "crypto",
  // Realty
  "недвижимость": "realty",
  "недвижимости": "realty",
  "недвижка": "realty",
  "риелтор": "realty",
  "риэлтор": "realty",
  "realty": "realty",
  // Expats & Russian diaspora
  "русские": "expats",
  "русский": "expats",
  "русская": "expats",
  "русское": "expats",
  "русских": "expats",
  "русскоязычные": "expats",
  "русскоязычный": "expats",
  "русскоязычная": "expats",
  "русскоязычное": "expats",
  "соотечественники": "expats",
  "экспаты": "expats",
  "экспат": "expats",
  "диаспора": "expats",
  "expats": "expats",
  "expat": "expats",
  "russian": "expats",
  "russians": "expats",
  // Chat / Group formats
  "чат": "chat",
  "чаты": "chat",
  "chat": "chat",
  "сообщество": "chat",
  "клуб": "chat"
};

/**
 * Basic morphological stemmer for Russian words.
 * Strips common inflections and case endings.
 */
export function stemRussian(word: string): string {
  if (word.length <= 3) return word;
  
  // Check synonym dictionary first
  if (SYNONYM_MAP[word]) return SYNONYM_MAP[word];

  let stem = word;
  // Strip common adjectival / participle endings
  stem = stem.replace(/(?:иями|ыями|ому|ему|ыми|ими|ого|его|ое|ее|ая|яя|ую|юю|ым|им|ых|их|ой|ей|ый|ий)$/, "");
  // Strip common noun case endings
  stem = stem.replace(/(?:ами|ями|ях|ах|ов|ев|ей|ом|ем|ам|ям|ью|у|ю|а|я|е|о|ы|и|й|ь)$/, "");

  return stem.length >= 2 ? stem : word;
}

/**
 * Clean and normalize text to an array of lowercase tokens.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/«|»|„|“|"|'|`|\[|\]|\(|\)|\{|\}|<|>|#|@|\*|\+|—|–/g, " ")
    .split(/[\s,.;:!?/\\|_-]+/)
    .map(t => t.trim())
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Normalize a single token to its canonical stem / meaning.
 */
export function canonicalToken(token: string): string {
  const lower = token.toLowerCase().replace(/ё/g, "е");
  if (SYNONYM_MAP[lower]) return SYNONYM_MAP[lower];
  const stemmed = stemRussian(lower);
  if (SYNONYM_MAP[stemmed]) return SYNONYM_MAP[stemmed];
  return stemmed;
}

/**
 * Parsed intent from a user subquery.
 */
export interface QueryIntent {
  rawQuery: string;
  tokens: string[];
  canonicalTokens: string[];
  /** Geographical qualifiers (e.g. "phuket", "moscow") */
  geos: string[];
  /** Topic / Service / Niche qualifiers (everything not geo and not format) */
  topics: string[];
  /** Format keywords (e.g. "чат", "канал", "клуб") */
  formats: string[];
  /** Backward compatibility aliases */
  specificQualifiers: string[];
  coreTopics: string[];
  formatQualifiers: string[];
  generalTopics: string[];
}

/**
 * Parse a subquery into its constituent intent components.
 */
export function parseQueryIntent(rawQuery: string): QueryIntent {
  const tokens = tokenize(rawQuery);
  const canonicalTokens = tokens.map(canonicalToken);

  const geos: string[] = [];
  const topics: string[] = [];
  const formats: string[] = [];
  const generalTopics: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const canonical = canonicalTokens[i];

    if (FORMAT_WORDS.has(raw) || FORMAT_WORDS.has(canonical)) {
      formats.push(canonical);
      generalTopics.push(canonical);
    } else if (GEO_CANONICAL_WORDS.has(canonical)) {
      geos.push(canonical);
    } else {
      topics.push(canonical);
      generalTopics.push(canonical);
    }
  }

  return {
    rawQuery: rawQuery.trim(),
    tokens,
    canonicalTokens,
    geos,
    topics,
    formats,
    specificQualifiers: geos,
    coreTopics: topics,
    formatQualifiers: formats,
    generalTopics
  };
}

export interface RelevanceScoreResult {
  score: number;
  isRelevant: boolean;
  reasons: string[];
}

/**
 * Calculate relevance score (0 - 100) of a candidate channel against a search query.
 * If query contains comma/newline separated subqueries, returns the best match score.
 */
export function calculateRelevance(
  channel: {
    title: string;
    description?: string | null;
    username?: string | null;
    subscribers?: string | null;
    chatType?: string | null;
  },
  fullQuery: string
): RelevanceScoreResult {
  const subQueries = fullQuery
    .split(/[,;\n]+/)
    .map(q => q.trim())
    .filter(Boolean);

  if (subQueries.length === 0) {
    return { score: 100, isRelevant: true, reasons: ["Empty query: accepted all"] };
  }

  let bestScore = 0;
  let bestReasons: string[] = [];
  let isRelevantAny = false;

  for (const sq of subQueries) {
    const intent = parseQueryIntent(sq);
    const result = evaluateSingleSubquery(channel, intent);
    if (result.score > bestScore) {
      bestScore = result.score;
      bestReasons = result.reasons;
      isRelevantAny = result.isRelevant;
    } else if (result.isRelevant && !isRelevantAny) {
      isRelevantAny = true;
    }
  }

  return {
    score: bestScore,
    isRelevant: isRelevantAny && bestScore >= 20,
    reasons: bestReasons
  };
}

/**
 * Evaluate candidate channel against a single parsed query intent.
 */
function evaluateSingleSubquery(
  channel: {
    title: string;
    description?: string | null;
    username?: string | null;
    subscribers?: string | null;
    chatType?: string | null;
  },
  intent: QueryIntent
): RelevanceScoreResult {
  const reasons: string[] = [];
  let score = 0;

  if (intent.tokens.length === 0) {
    return { score: 50, isRelevant: true, reasons: ["No non-stopword tokens in query"] };
  }

  const cleanTitle = (channel.title || "").toLowerCase().replace(/ё/g, "е");
  const cleanDesc = (channel.description || "").toLowerCase().replace(/ё/g, "е");
  const cleanUsername = (channel.username || "").toLowerCase();

  const rawTitleTokens = tokenize(channel.title);
  const rawDescTokens = tokenize(channel.description || "");
  const rawUserTokens = tokenize(cleanUsername.replace(/_/g, " "));

  const canonicalTitleTokens = rawTitleTokens.map(canonicalToken);
  const canonicalDescTokens = rawDescTokens.map(canonicalToken);
  const canonicalUserTokens = rawUserTokens.map(canonicalToken);

  const titleTokenSet = new Set([...rawTitleTokens, ...canonicalTitleTokens]);
  const descTokenSet = new Set([...rawDescTokens, ...canonicalDescTokens]);
  const usernameTokenSet = new Set([...rawUserTokens, ...canonicalUserTokens]);

  const fullText = `${cleanTitle} ${cleanDesc} ${cleanUsername}`;

  // ── RULE 0: ANTI-SPAM & SAFETY FILTER ─────────────────────────────────────
  // If the user's query did not ask for adult/scam/gambling content,
  // reject any channel that explicitly promotes porn, escorts, casinos, or illegal items.
  const queryHasSpam = intent.tokens.some(t => SPAM_ADULT_WORDS.some(bad => t.includes(bad)));
  if (!queryHasSpam) {
    for (const bad of SPAM_ADULT_WORDS) {
      if (
        cleanTitle.includes(bad) ||
        cleanUsername.includes(bad) ||
        cleanDesc.includes(bad) ||
        titleTokenSet.has(bad) ||
        descTokenSet.has(bad)
      ) {
        return {
          score: 0,
          isRelevant: false,
          reasons: [`Excluded by anti-spam/safety filter (found '${bad}')`]
        };
      }
    }
  }

  // ── RULE 1: STRICT GEO & TOPIC CO-OCCURRENCE ────────────────────────────────
  const hasGeos = intent.geos.length > 0;
  const hasTopics = intent.topics.length > 0;

  let matchedGeos = 0;
  let matchedTopics = 0;

  const isTermInChannel = (term: string) => {
    return titleTokenSet.has(term) || descTokenSet.has(term) || usernameTokenSet.has(term) || fullText.includes(term) || (term === "expats" && /[а-яёА-ЯЁ]/.test(fullText));
  };

  if (hasGeos) {
    for (const geo of intent.geos) {
      if (isTermInChannel(geo)) {
        matchedGeos++;
        reasons.push(`Matched geo '${geo}'`);
      }
    }
  }

  if (hasTopics) {
    for (const topic of intent.topics) {
      if (isTermInChannel(topic)) {
        matchedTopics++;
        reasons.push(`Matched topic '${topic}'`);
      }
    }
  }

  if (hasGeos && hasTopics) {
    if (matchedGeos === 0 || matchedTopics !== intent.topics.length) {
      return {
        score: 0,
        isRelevant: false,
        reasons: [`Failed strict Geo + Topic co-occurrence. Required geos: [${intent.geos.join(", ")}], topics: [${intent.topics.join(", ")}]`]
      };
    }
  } else if (hasGeos && !hasTopics) {
    if (matchedGeos === 0) {
      return {
        score: 0,
        isRelevant: false,
        reasons: [`Failed Geo match. Required at least one of: [${intent.geos.join(", ")}]`]
      };
    }
  } else if (!hasGeos && hasTopics) {
    if (matchedTopics !== intent.topics.length) {
      return {
        score: 0,
        isRelevant: false,
        reasons: [`Failed Topic match. Required ALL of: [${intent.topics.join(", ")}]`]
      };
    }
  }

  // ── RULE 2: NEGATIVE GEO CLASH ────────────────────────────────────────────
  // If the query specified a Geo, the candidate MUST NOT solely contain a DIFFERENT Geo 
  // without containing the requested Geo. (This is already implicitly caught above because 
  // matchedGeos === 0 drops the score to 0. But just in case we refine logic later, this is where it would live).
  // E.g. Query="ремонт пхукет", Channel="ремонт батуми". hasGeos=true, matchedGeos=0 -> already rejected.

  // ── RULE 3: SCORING COMPUTATION ───────────────────────────────────────────
  let matchedAllInTitle = true;
  let matchedAnyInTitle = false;
  let matchedAnyInDesc = false;

  for (const q of intent.canonicalTokens) {
    const inTitle = titleTokenSet.has(q) || cleanTitle.includes(q) || (q === "expats" && /[а-яёА-ЯЁ]/.test(cleanTitle));
    const inDesc = descTokenSet.has(q) || cleanDesc.includes(q) || (q === "expats" && /[а-яёА-ЯЁ]/.test(cleanDesc));
    const inUser = usernameTokenSet.has(q) || cleanUsername.includes(q);

    if (inTitle) {
      matchedAnyInTitle = true;
      score += 25;
      reasons.push(`Token '${q}' matched in title`);
    } else {
      matchedAllInTitle = false;
    }

    if (inUser) {
      score += 15;
      reasons.push(`Token '${q}' matched in username`);
    }

    if (inDesc) {
      matchedAnyInDesc = true;
      score += 10;
      reasons.push(`Token '${q}' matched in description`);
    }
  }

  // Bonus: All query keywords present in title
  if (matchedAllInTitle && intent.canonicalTokens.length > 1) {
    score += 25;
    reasons.push("All query tokens matched in title (+25 bonus)");
  }

  // Bonus: Exact phrase match
  const rawCleanQuery = intent.rawQuery.toLowerCase().replace(/ё/g, "е");
  if (cleanTitle.includes(rawCleanQuery)) {
    score += 20;
    reasons.push(`Exact phrase found in title (+20 bonus)`);
  } else if (cleanDesc.includes(rawCleanQuery)) {
    score += 10;
    reasons.push(`Exact phrase found in description (+10 bonus)`);
  }

  // Bonus: Subscribed audience presence (verified active channel)
  if (channel.subscribers && !/^0\s*(?:subscribers|members)?$/i.test(channel.subscribers)) {
    score += 5;
    reasons.push("Has subscriber count (+5 bonus)");
  }

  // Penalty if nothing matched in title or username and only 1 weak match in description
  if (!matchedAnyInTitle && !usernameTokenSet.size && score < 20) {
    return {
      score: Math.min(score, 15),
      isRelevant: false,
      reasons: ["Insufficient keyword density across title and username"]
    };
  }

  const finalScore = Math.min(100, Math.max(0, score));
  return {
    score: finalScore,
    isRelevant: finalScore >= 20,
    reasons
  };
}

/**
 * Filter an array of stored channel inputs, dropping irrelevant channels,
 * and sorting remaining channels descending by relevance score.
 */
export function filterAndRankByRelevance<T extends { title: string; description?: string | null; username?: string | null; subscribers?: string | null; chatType?: string | null }>(
  items: T[],
  query: string
): { relevant: (T & { relevanceScore: number })[]; discardedCount: number } {
  const ranked: (T & { relevanceScore: number })[] = [];
  let discardedCount = 0;

  for (const item of items) {
    const rel = calculateRelevance(item, query);
    if (rel.isRelevant) {
      ranked.push({
        ...item,
        relevanceScore: rel.score
      });
    } else {
      discardedCount++;
    }
  }

  ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return {
    relevant: ranked,
    discardedCount
  };
}
