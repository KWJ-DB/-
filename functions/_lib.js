// 공용 함수 (파일 이름이 _ 로 시작해서 라우트가 되지 않음)

const enc = new TextEncoder();

export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}
export const err = (status, message) => json({ error: message }, status);

export async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isTime = (s) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
export const str = (v, max) => String(v ?? "").trim().replace(/[\u0000-\u0008\u000b-\u001f]/g, "").slice(0, max);
export const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ---------- DB ----------
let ready = false;
export async function ensureSchema(env) {
  if (ready) return;
  if (!env.DB) throw new Error("D1 바인딩(DB)이 없어요. Pages 설정 > 바인딩에서 D1을 변수 이름 DB로 연결하세요.");
  const sql = [
    `CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)`,
    `CREATE TABLE IF NOT EXISTS couple_locs (who TEXT PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL, acc INTEGER, batt INTEGER, src TEXT, t INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS answers (qdate TEXT NOT NULL, slot TEXT NOT NULL, who TEXT NOT NULL, answer TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (qdate, slot, who))`,
    `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, time TEXT, title TEXT NOT NULL, memo TEXT, who TEXT, t INTEGER)`,
    `CREATE INDEX IF NOT EXISTS events_date ON events(date)`,
    `CREATE TABLE IF NOT EXISTS anniv (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, date TEXT NOT NULL, yearly INTEGER DEFAULT 1, who TEXT, t INTEGER)`,
    `CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, caption TEXT, who TEXT, w INTEGER, h INTEGER, t INTEGER, thumb TEXT, data TEXT)`,
    `CREATE INDEX IF NOT EXISTS photos_date ON photos(date)`,
    `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT NOT NULL, text TEXT NOT NULL, likes TEXT DEFAULT '', t INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS touches (id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT NOT NULL, kind TEXT NOT NULL, t INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS bucket (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, done INTEGER DEFAULT 0, done_date TEXT, who TEXT, t INTEGER)`,
  ];
  await env.DB.batch(sql.map((q) => env.DB.prepare(q)));
  ready = true;
}

export async function getSettings(env) {
  const { results } = await env.DB.prepare("SELECT k, v FROM settings").all();
  const o = {};
  for (const r of results || []) o[r.k] = r.v;
  return o;
}
export async function setSettings(env, obj) {
  await env.DB.batch(
    Object.entries(obj).map(([k, v]) =>
      env.DB.prepare("INSERT INTO settings (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, String(v))
    )
  );
}

export async function saveLoc(DB, who, d) {
  const lat = Number(d.lat), lon = Number(d.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("좌표가 올바르지 않아요");
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
  let t = Number(d.t);
  if (!Number.isFinite(t) || t > Date.now() + 60000) t = Date.now();
  await DB.prepare(
    `INSERT INTO couple_locs (who, lat, lon, acc, batt, src, t) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(who) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, acc = excluded.acc,
       batt = excluded.batt, src = excluded.src, t = excluded.t
     WHERE excluded.t >= couple_locs.t`
  ).bind(who, lat, lon, num(d.acc), num(d.batt), d.src || "web", Math.round(t)).run();
}

// ---------- 암호/세션 ----------
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
export async function hashPw(salt, pw) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(salt + ":" + pw)));
}
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
export function safeEq(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export async function makeToken(secret, who) {
  const p = `${who}.${Date.now() + 180 * 864e5}`;
  return `${p}.${await hmac(secret, p)}`;
}
export async function readToken(secret, tok) {
  if (!tok || !secret) return null;
  const [who, exp, sig] = tok.split(".");
  if (!["a", "b"].includes(who) || !(Number(exp) > Date.now())) return null;
  return safeEq(sig || "", await hmac(secret, `${who}.${exp}`)) ? who : null;
}
export function getCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}
export const cookieHeader = (tok, maxAge = 15552000) => `cp=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export function parseBasic(header) {
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const bin = atob(header.slice(6));
    const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const i = text.indexOf(":");
    return i < 0 ? null : { user: text.slice(0, i), pass: text.slice(i + 1) };
  } catch {
    return null;
  }
}

export function fromB64(b) {
  const s = atob(b);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
