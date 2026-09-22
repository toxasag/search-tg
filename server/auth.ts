import { promisify } from "node:util";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db, isDatabaseEmpty } from "./db.js";

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = "search_tg_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const PASSWORD_KEY_LENGTH = 64;

export interface SessionUser {
  id: number;
  email: string;
  role: "owner" | "user";
  mustChangePassword: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: SessionUser;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function validateEmail(email: unknown) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function validatePassword(password: unknown) {
  return typeof password === "string" && password.length >= 12 && password.length <= 256;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

function toUser(row: any): SessionUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

export async function bootstrapOwner() {
  if (!isDatabaseEmpty()) return;
  const email = process.env.BOOTSTRAP_OWNER_EMAIL?.trim();
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
  if (!email || !validateEmail(email) || !validatePassword(password)) {
    console.warn("[Auth] No initial owner created. Set BOOTSTRAP_OWNER_EMAIL and a 12+ character BOOTSTRAP_OWNER_PASSWORD before first start.");
    return;
  }
  db.prepare("INSERT INTO users (email, password_hash, role, must_change_password) VALUES (?, ?, 'owner', 0)")
    .run(email.toLowerCase(), await hashPassword(password));
  console.log(`[Auth] Bootstrap owner ${email.toLowerCase()} created.`);
}

export function attachSession(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== "string") return next();
  const user = db.prepare(`
    SELECT u.id, u.email, u.role, u.must_change_password
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = 1
  `).get(hashToken(token));
  if (user) req.user = toUser(user);
  next();
}

export function requireUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication is required." });
  next();
}

export function requireOwner(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication is required." });
  if (req.user.role !== "owner") return res.status(403).json({ error: "Owner access is required." });
  next();
}

export async function createSession(res: Response, user: SessionUser) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
  db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
    .run(user.id, hashToken(token), expiresAt);
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export function destroySession(req: AuthenticatedRequest, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string") {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
}

export async function login(email: unknown, password: unknown) {
  if (!validateEmail(email) || typeof password !== "string") return null;
  const normalizedEmail = (email as string).trim().toLowerCase();
  const row = db.prepare("SELECT * FROM users WHERE email = ? AND is_active = 1").get(normalizedEmail) as any;
  if (!row || !(await verifyPassword(password, row.password_hash))) return null;
  return toUser(row);
}

export async function createManagedUser(email: unknown, password: unknown) {
  if (!validateEmail(email)) throw new Error("Enter a valid email address.");
  if (!validatePassword(password)) throw new Error("Password must contain at least 12 characters.");
  try {
    const result = db.prepare("INSERT INTO users (email, password_hash, role, must_change_password) VALUES (?, ?, 'user', 1)")
      .run((email as string).trim().toLowerCase(), await hashPassword(password as string));
    return db.prepare("SELECT id, email, role, is_active, must_change_password, created_at FROM users WHERE id = ?").get(result.lastInsertRowid);
  } catch (error: any) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("That email address already has an account.");
    throw error;
  }
}

export async function changePassword(userId: number, currentPassword: unknown, nextPassword: unknown) {
  if (!validatePassword(nextPassword)) throw new Error("New password must contain at least 12 characters.");
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ? AND is_active = 1").get(userId) as any;
  if (!row || !(await verifyPassword(String(currentPassword || ""), row.password_hash))) throw new Error("Current password is incorrect.");
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?")
    .run(await hashPassword(nextPassword as string), userId);
}
