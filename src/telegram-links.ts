import type { ScrapedChannel } from "./types";

// Invite hashes are case-sensitive; public usernames are not.
export function normalizeTelegramLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    let name: string | null = null;
    let invite: string | null = null;
    if (url.protocol === "tg:") {
      if (url.hostname === "resolve") name = url.searchParams.get("domain");
      if (url.hostname === "join") invite = url.searchParams.get("invite");
    } else if (["https:", "http:"].includes(url.protocol) && ["t.me", "telegram.me", "www.t.me"].includes(url.hostname) && !url.username && !url.password) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0]?.startsWith("+")) invite = parts[0].slice(1);
      else if (parts[0] === "joinchat") invite = parts[1];
      else name = parts[0] === "s" ? parts[1] : parts[0];
    }
    if (invite && /^[a-zA-Z0-9_-]+$/.test(invite)) return `https://t.me/+${invite}`;
    if (name && /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(name) && !["share", "joinchat", "proxy", "socks", "addstickers", "c", "s"].includes(name.toLowerCase())) return `https://t.me/${name.toLowerCase()}`;
  } catch { /* Not a Telegram URL. */ }
  return null;
}

export function buildTxt(channels: ScrapedChannel[], report = false): string {
  const unique = new Map<string, ScrapedChannel>();
  for (const channel of channels) {
    const link = normalizeTelegramLink(channel.telegramUrl);
    if (link && channel.extractionStatus === "success" && !unique.has(link)) unique.set(link, channel);
  }
  const clean = (text: string) => text.replace(/[\r\n\t]+/g, " ");
  const entries = [...unique].map(([link, channel]) => report
    ? [`Название: ${clean(channel.title)}`, `Тип: ${channel.chatType || "unknown"}`, `Источник: ${clean(channel.source)}`, `Каталог: ${clean(channel.detailUrl)}`, `Telegram: ${link}`].join("\n")
    : link);
  return entries.length ? entries.join(report ? "\n\n" : "\n") + "\n" : "";
}
