/**
 * Stage 4.18 — single-password gate.
 *
 * One env var (APP_PASSWORD) protects the whole app. A signed cookie
 * (HMAC-SHA256 over an expiry timestamp) proves the user has authenticated.
 *
 * Layered behind Cloudflare (which already filters bots, AI scrapers and
 * non-allowlisted geos), this gives application-level access control with
 * zero external dependencies.
 */
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

// ─── Config ────────────────────────────────────────────────────────────────
const COOKIE_NAME = "aio_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_ATTEMPTS = 5; // per IP per window

const APP_PASSWORD = process.env.APP_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";

/**
 * Fail-closed boot check. The server refuses to start if the password gate
 * is misconfigured — never silently boot wide-open.
 */
export function assertAuthConfigured(): void {
  if (!APP_PASSWORD || APP_PASSWORD.length < 8) {
    throw new Error(
      "APP_PASSWORD env var is missing or shorter than 8 chars. " +
        "Set it in /srv/aioffice/.env (or your shell) before starting the server.",
    );
  }
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new Error(
      "SESSION_SECRET env var is missing or shorter than 32 chars. " +
        "Generate one with `openssl rand -hex 32` and add it to .env.",
    );
  }
}

// ─── Cookie sign / verify ───────────────────────────────────────────────────

function sign(value: string): string {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("hex");
}

/**
 * Cookie format:  "<expiryMs>.<hexSignature>"
 * Signature covers the expiryMs string so a tampered expiry fails verify.
 */
function makeCookieValue(): string {
  const expiry = String(Date.now() + SESSION_TTL_MS);
  return `${expiry}.${sign(expiry)}`;
}

function verifyCookieValue(value: string | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  const [expiryStr, sig] = parts;
  const expectedSig = sign(expiryStr);
  // constant-time compare on identical-length hex strings
  if (sig.length !== expectedSig.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSig, "hex"))) return false;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry)) return false;
  return Date.now() < expiry;
}

// ─── Tiny cookie parser (no `cookie-parser` dep) ────────────────────────────

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return undefined;
}

function setSessionCookie(res: Response): void {
  const value = makeCookieValue();
  // HttpOnly  → not readable from JS
  // Secure    → only sent over HTTPS (Cloudflare terminates TLS, then origin
  //             receives plain HTTP — but we run behind Cloudflare in
  //             production, so this is fine. NODE_ENV=development drops Secure
  //             so local dev over http://localhost still works.)
  // SameSite=Lax → sent on top-level navigation, not on cross-site POSTs
  const isProd = process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isProd) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res: Response): void {
  const isProd = process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isProd) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

// ─── Login rate limiter (per IP, in-memory, sliding window) ────────────────
const loginAttempts = new Map<string, number[]>(); // ip → timestamps

function clientIp(req: Request): string {
  // Cloudflare sets CF-Connecting-IP with the real client; fall back to
  // X-Forwarded-For first hop, then the socket address.
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf;
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const attempts = (loginAttempts.get(ip) || []).filter((t) => t >= cutoff);
  if (attempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    loginAttempts.set(ip, attempts); // keep the trimmed list
    return false;
  }
  attempts.push(now);
  loginAttempts.set(ip, attempts);
  return true;
}

// Periodic cleanup so the map doesn't grow unbounded.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  loginAttempts.forEach((timestamps, ip) => {
    const trimmed = timestamps.filter((t: number) => t >= cutoff);
    if (trimmed.length === 0) loginAttempts.delete(ip);
    else loginAttempts.set(ip, trimmed);
  });
}, 5 * 60 * 1000).unref();

// ─── Public API ────────────────────────────────────────────────────────────

/** True if the request carries a valid session cookie. */
export function isAuthenticated(req: Request): boolean {
  return verifyCookieValue(readCookie(req, COOKIE_NAME));
}

/**
 * Express middleware. Anything not whitelisted requires a valid session.
 *
 * Whitelist:
 *   - /api/auth/login, /api/auth/logout, /api/auth/me  (the gate itself)
 *   - /healthz                                          (uptime probes)
 *   - /robots.txt                                       (crawler hint)
 *   - /login.html and the login page assets             (rendered pre-auth)
 *
 * For unauthenticated requests:
 *   - /api/* → 401 JSON
 *   - everything else → 302 redirect to /login.html
 */
const PUBLIC_PATHS = new Set<string>([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/healthz",
  "/robots.txt",
  "/login.html",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // login page may load assets under /login-assets/ if we ever split it out
  if (pathname.startsWith("/login-assets/")) return true;
  return false;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isPublicPath(req.path)) return next();
  if (isAuthenticated(req)) return next();

  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "unauthorized", message: "Sign in required." });
    return;
  }
  // For HTML/static, redirect browsers to the login page.
  res.redirect(302, "/login.html");
}

/** POST /api/auth/login  — body: { password: string } */
export function handleLogin(req: Request, res: Response): void {
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "rate_limited", message: "Too many attempts. Wait a minute and try again." });
    return;
  }

  const submitted = (req.body && typeof req.body.password === "string") ? req.body.password : "";
  if (!submitted) {
    res.status(400).json({ error: "bad_request", message: "Password required." });
    return;
  }

  // Constant-time compare. Pad both buffers to the longer length so
  // timingSafeEqual doesn't bail on length mismatch (which itself leaks length).
  const a = Buffer.from(submitted, "utf8");
  const b = Buffer.from(APP_PASSWORD, "utf8");
  const len = Math.max(a.length, b.length);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  a.copy(padA);
  b.copy(padB);
  const equal = crypto.timingSafeEqual(padA, padB) && a.length === b.length;

  if (!equal) {
    res.status(401).json({ error: "invalid_password", message: "Wrong password." });
    return;
  }

  setSessionCookie(res);
  res.json({ ok: true });
}

/** POST /api/auth/logout */
export function handleLogout(_req: Request, res: Response): void {
  clearSessionCookie(res);
  res.json({ ok: true });
}

/** GET /api/auth/me  — used by the SPA to check session on boot */
export function handleMe(req: Request, res: Response): void {
  res.json({ authenticated: isAuthenticated(req) });
}

/**
 * Stage 4.18 hardening: gate the WebSocket upgrade too. Without this, an
 * unauthenticated client could connect to /ws and receive the init payload
 * (which includes agent + project metadata).
 *
 * Caller wires this against the http.Server's "upgrade" event.
 */
export function isWsUpgradeAuthenticated(req: { headers: { cookie?: string } }): boolean {
  const cookie = req.headers.cookie;
  if (!cookie) return false;
  for (const pair of cookie.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    if (k === COOKIE_NAME) {
      return verifyCookieValue(decodeURIComponent(pair.slice(idx + 1).trim()));
    }
  }
  return false;
}
