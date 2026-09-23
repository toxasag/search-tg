import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateRelevance, filterAndRankByRelevance, parseQueryIntent, canonicalToken } from "../server/relevance.ts";

test("Stemming and canonical mapping", () => {
  assert.equal(canonicalToken("тайланда"), "thailand");
  assert.equal(canonicalToken("таиланде"), "thailand");
  assert.equal(canonicalToken("тайский"), "thailand");
  assert.equal(canonicalToken("пхукете"), "phuket");
  assert.equal(canonicalToken("москвы"), "moscow");
  assert.equal(canonicalToken("бизнесу"), "business");
});

test("Intent parsing separates specific qualifiers from general topic terms", () => {
  const intent = parseQueryIntent("бизнес тайланд");
  assert.deepEqual(intent.generalTopics, ["business"]);
  assert.deepEqual(intent.specificQualifiers, ["thailand"]);

  const intent2 = parseQueryIntent("чат пхукет экспаты");
  assert.deepEqual(intent2.generalTopics, ["chat", "expats"]);
  assert.deepEqual(intent2.formatQualifiers, ["chat"]);
  assert.deepEqual(intent2.coreTopics, ["expats"]);
  assert.ok(intent2.specificQualifiers.includes("phuket"));
});

test("Relevance filtering: 'бизнес тайланд, бизнес пхукет' eliminates spam", () => {
  const query = "бизнес тайланд, бизнес пхукет";

  // Relevant channels
  const good1 = calculateRelevance({
    title: "Бизнес-клуб Самуи | Таиланд",
    description: "Чат предпринимателей Таиланда и острова Самуи",
    username: "samui_biz"
  }, query);
  assert.equal(good1.isRelevant, true);
  assert.ok(good1.score >= 50, `Expected good1 score >= 50, got ${good1.score}`);

  const good2 = calculateRelevance({
    title: "Пхукет Бизнес Чат",
    description: "Нетворкинг предпринимателей на Пхукете",
    username: "phuket_business"
  }, query);
  assert.equal(good2.isRelevant, true);
  assert.ok(good2.score >= 60, `Expected good2 score >= 60, got ${good2.score}`);

  const good3 = calculateRelevance({
    title: "Thailand Business Network",
    description: "Connect with investors and startups in Thailand",
    username: "thai_biz"
  }, query);
  assert.equal(good3.isRelevant, true);
  assert.ok(good3.score >= 40, `Expected good3 score >= 40, got ${good3.score}`);

  // IRRELEVANT SPAM: MUST BE REJECTED
  const spam1 = calculateRelevance({
    title: "Мото Жесть",
    description: "ДТП с мотоциклами, аварии и байкеры",
    username: "moto_zhest"
  }, query);
  assert.equal(spam1.isRelevant, false);
  assert.equal(spam1.score, 0);

  const spam2 = calculateRelevance({
    title: "МАМКИ.РУ | MILF.RU",
    description: "Бизнес и стартапы. Знаменитости. Коммуникация.",
    username: "mamki_ru"
  }, query);
  assert.equal(spam2.isRelevant, false);
  assert.equal(spam2.score, 0);

  const spam3 = calculateRelevance({
    title: "Предприниматели Москвы",
    description: "Все про бизнес: управление предприятиями в Москве и РФ",
    username: "predprinimateli_moskvi"
  }, query);
  assert.equal(spam3.isRelevant, false);
  assert.equal(spam3.score, 0);

  const spam4 = calculateRelevance({
    title: "Sky: Children of the Light",
    description: "Русскоязычное сообщество игроков",
    username: "sky_children"
  }, query);
  assert.equal(spam4.isRelevant, false);
  assert.equal(spam4.score, 0);

  // Non-business channels in Thailand: MUST BE REJECTED (topic co-occurrence rule)
  const nonBiz1 = calculateRelevance({
    title: "Еда в Тайланде",
    description: "Где вкусно поесть в Бангкоке и на Пхукете, кафе и рестораны",
    username: "thai_food"
  }, query);
  assert.equal(nonBiz1.isRelevant, false);
  assert.equal(nonBiz1.score, 0);

  const nonBiz2 = calculateRelevance({
    title: "Пхукет Экскурсии и Туры",
    description: "Морские экскурсии по островам Пхукета, трансферы и гиды",
    username: "phuket_tours"
  }, query);
  assert.equal(nonBiz2.isRelevant, false);
  assert.equal(nonBiz2.score, 0);

  const spamAdult = calculateRelevance({
    title: "Проститутки и Интим Пхукет",
    description: "Эскорт услуги и девочки в Таиланде",
    username: "phuket_girls"
  }, query);
  assert.equal(spamAdult.isRelevant, false);
  assert.equal(spamAdult.score, 0);

  // Vulgar profanity & porn: MUST BE REJECTED
  const spamVulgar = calculateRelevance({
    title: "Ебля баня Ледибой тайланд Сисястая анальщица",
    description: "Ебля баня Ледибой тайланд Сисястая анальщица",
    username: "pmvhfl"
  }, "русские тайланд");
  assert.equal(spamVulgar.isRelevant, false);
  assert.equal(spamVulgar.score, 0);
});

test("Community & expat queries: 'русские тайланд'", () => {
  const expatQuery = "русские тайланд";

  const goodExpat = calculateRelevance({
    title: "Русские в Таиланде | Экспаты",
    description: "Сообщество соотечественников и экспатов в Таиланде",
    username: "thai_russians"
  }, expatQuery);
  assert.equal(goodExpat.isRelevant, true);
  assert.ok(goodExpat.score >= 50);

  // Irrelevant: general channel about Bangkok with no russian/expat mention
  const unrelatedGeo = calculateRelevance({
    title: "Bangkok Metro News",
    description: "Daily city transport updates for Bangkok",
    username: "bkk_metro"
  }, expatQuery);
  assert.equal(unrelatedGeo.isRelevant, false);
  assert.equal(unrelatedGeo.score, 0);
});

test("Single keyword queries work correctly", () => {
  // Query for country only
  const geoQuery = "тайланд";
  const geoResult = calculateRelevance({
    title: "Новости Таиланда",
    description: "Главные события королевства Таиланд",
    username: "thai_news"
  }, geoQuery);
  assert.equal(geoResult.isRelevant, true);
  assert.ok(geoResult.score >= 25);

  // Query for topic only
  const topicQuery = "бизнес";
  const topicResult = calculateRelevance({
    title: "Клуб Предпринимателей",
    description: "Все про масштабирование бизнеса",
    username: "biz_club"
  }, topicQuery);
  assert.equal(topicResult.isRelevant, true);
  assert.ok(topicResult.score >= 25);
});

test("filterAndRankByRelevance filters spam and sorts by highest score", () => {
  const query = "бизнес тайланд, бизнес пхукет";
  const items = [
    { title: "Мото Жесть", description: "байкеры", detailUrl: "1", source: "test" },
    { title: "Пхукет чат предпринимателей", description: "бизнес на пхукете", detailUrl: "2", source: "test" },
    { title: "МАМКИ.РУ", description: "Бизнес и стартапы", detailUrl: "3", source: "test" },
    { title: "Бизнес в Таиланде | Инвестиции", description: "Тайланд и Бангкок", detailUrl: "4", source: "test" },
    { title: "Еда на Пхукете", description: "Кафе и рестораны", detailUrl: "5", source: "test" },
    { title: "Казино 1win Пхукет", description: "Ставки и слоты", detailUrl: "6", source: "test" },
    { title: "Ебля баня Ледибой тайланд", description: "адалт", detailUrl: "7", source: "test" }
  ];

  const result = filterAndRankByRelevance(items, query);
  assert.equal(result.relevant.length, 2);
  assert.equal(result.discardedCount, 5);
  assert.ok(result.relevant[0].title.includes("Пхукет") || result.relevant[0].title.includes("Таиланд"));
});

test("Strict Geo + Niche co-occurrence for 'ремонт пхукет'", () => {
  const query = "ремонт пхукет";
  
  // Real repair in Phuket -> MUST be relevant
  const goodRepair = calculateRelevance({
    title: "Пхукет Ремонт квартир и вилл",
    description: "Строительство, отделка и ремонт на Пхукете",
    username: "phuket_remont"
  }, query);
  assert.equal(goodRepair.isRelevant, true);
  assert.ok(goodRepair.score >= 50);

  // Repair in other geo (Batumi, Moscow) -> MUST be REJECTED (score = 0)
  const badGeo1 = calculateRelevance({
    title: "Ремонт и строительство 🏠 Батуми",
    description: "Всё о ремонте в Грузии и Батуми",
    username: "batumi_remont"
  }, query);
  assert.equal(badGeo1.isRelevant, false);
  assert.equal(badGeo1.score, 0);

  const badGeo2 = calculateRelevance({
    title: "Петрович: всё о стройке и ремонте",
    description: "Ремонт и отделка в Москве и Петербурге",
    username: "stdpetrovich"
  }, query);
  assert.equal(badGeo2.isRelevant, false);
  assert.equal(badGeo2.score, 0);

  // Phuket channel with unrelated topic (chat, books, bikers) -> MUST be REJECTED (score = 0)
  const badTopic1 = calculateRelevance({
    title: "Русский чат Пхукет",
    description: "Общение экспатов на Пхукете",
    username: "phuketchatru"
  }, query);
  assert.equal(badTopic1.isRelevant, false);
  assert.equal(badTopic1.score, 0);

  const badTopic2 = calculateRelevance({
    title: "Rus.BikersTH",
    description: "Мотоциклисты Таиланда и Пхукета",
    username: "rusbikersth"
  }, query);
  assert.equal(badTopic2.isRelevant, false);
  assert.equal(badTopic2.score, 0);
});
