import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import "dotenv/config";

if (!process.env.TG_API_ID || !process.env.TG_API_HASH) {
  throw new Error("Set TG_API_ID and TG_API_HASH locally before authorizing.");
}
const destination = process.env.TG_SESSION_FILE || "./data/telegram.session";
const secretQuestion = async (prompt) => {
  process.stdout.write(prompt);
  const silent = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const secret = createInterface({ input: process.stdin, output: silent, terminal: true });
  try { return await secret.question(""); }
  finally { secret.close(); process.stdout.write("\n"); }
};
const question = async (prompt) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(prompt); } finally { rl.close(); }
};
const client = new TelegramClient(new StringSession(""), Number(process.env.TG_API_ID), process.env.TG_API_HASH, { connectionRetries: 1 });
try {
  console.log("Authorize only your own dedicated account. Inputs are local; never share the session file.");
  await client.start({
    phoneNumber: () => question("Phone: "),
    phoneCode: () => secretQuestion("Telegram login code (hidden): "),
    password: () => secretQuestion("Two-step password (hidden): "),
    onError: () => { console.error("Authorization failed. Check credentials locally."); },
  });
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, client.session.save(), { mode: 0o600, flag: "wx" });
  console.log(`Session saved to ${destination}. Existing files are never overwritten.`);
} finally { await client.disconnect(); }
