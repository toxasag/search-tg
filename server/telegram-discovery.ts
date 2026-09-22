import { readFileSync } from "node:fs";
import type { StoredChannelInput } from "./store.js";

export function telegramConfigured() {
  return Boolean(process.env.TG_API_ID && process.env.TG_API_HASH && process.env.TG_SESSION_FILE);
}

// A single account must not receive concurrent discovery requests from users.
let tail: Promise<unknown> = Promise.resolve();
export function searchTelegram(query: string): Promise<StoredChannelInput[]> {
  const task = tail.then(() => discover(query));
  tail = task.catch(() => {});
  return task;
}

async function discover(query: string): Promise<StoredChannelInput[]> {
  if (!telegramConfigured()) throw new Error("Telegram discovery is not configured by the owner.");
  const { TelegramClient, Api } = await import("teleproto");
  const { StringSession } = await import("teleproto/sessions/index.js");
  const client = new TelegramClient(
    new StringSession(readFileSync(process.env.TG_SESSION_FILE!, "utf8").trim()),
    Number(process.env.TG_API_ID), process.env.TG_API_HASH!,
    { connectionRetries: 1, requestRetries: 0, floodSleepThreshold: 0, timeout: 10 },
  );
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      (async () => {
        await client.connect();
        const response = await client.invoke(new Api.contacts.Search({ q: query, limit: 100 }));
        return response.chats.flatMap((chat): StoredChannelInput[] => {
          if (!(chat instanceof Api.Channel) || !chat.username) return [];
          return [{ title: chat.title, description: "Found by Telegram public search", source: "telegram",
            detailUrl: `https://t.me/${chat.username}`, telegramUrl: `https://t.me/${chat.username}`,
            username: chat.username, extractionStatus: "success", chatType: chat.megagroup ? "group" : "channel",
            subscribers: chat.participantsCount == null ? null : String(chat.participantsCount) }];
        });
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Telegram search timeout (30s)")), 30000); }),
    ]);
  } finally { clearTimeout(timer!); await client.disconnect(); }
}
