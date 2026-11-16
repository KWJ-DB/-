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
    `CREATE TABLE IF NOT EXISTS chat_imgs (id INTEGER PRIMARY KEY AUTOINCREMENT, w INTEGER, h INTEGER, thumb TEXT, data TEXT, t INTEGER)`,
    `CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, who TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, t INTEGER)`,
    `CREATE TABLE IF NOT EXISTS places (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, radius INTEGER NOT NULL, who TEXT, t INTEGER)`,
    `CREATE TABLE IF NOT EXISTS place_state (who TEXT NOT NULL, place_id INTEGER NOT NULL, inside INTEGER NOT NULL, t INTEGER, PRIMARY KEY (who, place_id))`,
    `CREATE TABLE IF NOT EXISTS avatars (who TEXT PRIMARY KEY, data TEXT NOT NULL, t INTEGER)`,
    `CREATE TABLE IF NOT EXISTS letters (id INTEGER PRIMARY KEY AUTOINCREMENT, from_who TEXT NOT NULL, body TEXT NOT NULL, open_date TEXT NOT NULL, read INTEGER DEFAULT 0, t INTEGER)`,
    `CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, about TEXT NOT NULL, cat TEXT, text TEXT NOT NULL, who TEXT, t INTEGER)`,
    `CREATE TABLE IF NOT EXISTS daily_photos (date TEXT NOT NULL, who TEXT NOT NULL, thumb TEXT, data TEXT, t INTEGER, PRIMARY KEY (date, who))`,
    `CREATE TABLE IF NOT EXISTS coupons (id INTEGER PRIMARY KEY AUTOINCREMENT, from_who TEXT NOT NULL, title TEXT NOT NULL, used INTEGER DEFAULT 0, used_t INTEGER, t INTEGER)`,
    `CREATE TABLE IF NOT EXISTS loc_hist (id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, t INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS loc_hist_wt ON loc_hist(who, t)`,
    `CREATE TABLE IF NOT EXISTS place_events (id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT NOT NULL, place TEXT NOT NULL, inside INTEGER NOT NULL, t INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS eats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, cat TEXT, lat REAL NOT NULL, lon REAL NOT NULL, addr TEXT, status TEXT DEFAULT 'want', ra INTEGER, rb INTEGER, memo TEXT, who TEXT, t INTEGER, been TEXT)`,
    `CREATE TABLE IF NOT EXISTS eat_imgs (id INTEGER PRIMARY KEY AUTOINCREMENT, eat_id INTEGER NOT NULL, who TEXT, w INTEGER, h INTEGER, thumb TEXT, data TEXT, t INTEGER)`,
    `CREATE TABLE IF NOT EXISTS eat_visits (id INTEGER PRIMARY KEY AUTOINCREMENT, eat_id INTEGER NOT NULL, date TEXT NOT NULL, menu TEXT, who TEXT, t INTEGER)`,
    `CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY AUTOINCREMENT, caller TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, offer TEXT, answer TEXT, t INTEGER, t_ans INTEGER, t_end INTEGER)`,
    `CREATE TABLE IF NOT EXISTS bucket (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, done INTEGER DEFAULT 0, done_date TEXT, who TEXT, t INTEGER)`,
  ];
  await env.DB.batch(sql.map((q) => env.DB.prepare(q)));
  // 기존 DB에 새 칸 추가 (한 번만)
  const v = await env.DB.prepare("SELECT v FROM settings WHERE k = 'schema_v'").first();
  if (!v || Number(v.v) < 2) {
    for (const q of [
      "ALTER TABLE messages ADD COLUMN reacts TEXT",
      "ALTER TABLE messages ADD COLUMN img INTEGER",
      "ALTER TABLE messages ADD COLUMN w INTEGER",
      "ALTER TABLE messages ADD COLUMN h INTEGER",
    ]) { try { await env.DB.prepare(q).run(); } catch {} }
    await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('schema_v', '2') ON CONFLICT(k) DO UPDATE SET v = '2'").run();
  }
  if (!v || Number(v.v) < 4) {
    try { await env.DB.prepare("ALTER TABLE messages ADD COLUMN reply_to INTEGER").run(); } catch {}
  }
  if (!v || Number(v.v) < 3) {
    try { await env.DB.prepare("ALTER TABLE places ADD COLUMN owner TEXT").run(); } catch {}
    await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('schema_v', '3') ON CONFLICT(k) DO UPDATE SET v = '3'").run();
  }
  if (!v || Number(v.v) < 4) await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('schema_v', '4') ON CONFLICT(k) DO UPDATE SET v = '4'").run();
  if (!v || Number(v.v) < 5) {
    for (const q of [
      "ALTER TABLE messages ADD COLUMN pinned INTEGER DEFAULT 0",
      "ALTER TABLE messages ADD COLUMN edited INTEGER DEFAULT 0",
      "ALTER TABLE messages ADD COLUMN kind TEXT",
      "ALTER TABLE messages ADD COLUMN meta TEXT",
      "ALTER TABLE couple_locs ADD COLUMN vel INTEGER",
    ]) { try { await env.DB.prepare(q).run(); } catch {} }
    await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('schema_v', '5') ON CONFLICT(k) DO UPDATE SET v = '5'").run();
  }
  if (!v || Number(v.v) < 7) {
    try { await env.DB.prepare("ALTER TABLE loc_hist ADD COLUMN acc INTEGER").run(); } catch {}
  }
  if (!v || Number(v.v) < 6) {
    for (const q of ["ALTER TABLE eats ADD COLUMN wa INTEGER DEFAULT 0", "ALTER TABLE eats ADD COLUMN wb INTEGER DEFAULT 0", "ALTER TABLE eats ADD COLUMN link TEXT"]) { try { await env.DB.prepare(q).run(); } catch {} }
  }
  if (!v || Number(v.v) < 7) {
    await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('schema_v', '7') ON CONFLICT(k) DO UPDATE SET v = '7'").run();
  }
  if (!v || Number(v.v) < 8) {
    try { await env.DB.prepare("ALTER TABLE eats ADD COLUMN kind TEXT DEFAULT 'food'").run(); } catch {}
    await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('schema_v', '8') ON CONFLICT(k) DO UPDATE SET v = '8'").run();
  }
  if (!v || Number(v.v) < 9) {
    try { await env.DB.prepare("ALTER TABLE eats ADD COLUMN price INTEGER").run(); } catch {}
    await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('schema_v', '9') ON CONFLICT(k) DO UPDATE SET v = '9'").run();
  }
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
  // 현재 위치가 튀지 않게: 오차가 큰 위치나 순간이동 같은 위치는 최근 정확한 위치를 덮어쓰지 않음
  const acc0 = Number(d.acc);
  const accN = Number.isFinite(acc0) ? acc0 : 50;
  const cur = await DB.prepare("SELECT lat, lon, acc, t FROM couple_locs WHERE who = ?1").bind(who).first();
  if (cur && t >= cur.t) {
    const age = (t - cur.t) / 1000;
    const curAcc = cur.acc != null ? cur.acc : 50;
    const dist = distM({ lat, lon }, cur);
    const worse = accN > Math.max(60, curAcc * 2);
    // 1) 최근(3분 안) 정확한 위치가 있는데 훨씬 흐린 위치가 오차 범위 안에서 들어오면 무시
    if (worse && age < 180 && dist < accN) { await DB.prepare("UPDATE couple_locs SET batt = COALESCE(?2, batt) WHERE who = ?1").bind(who, num(d.batt)).run(); return; }
    // 2) 시속 200km 넘게 순간이동한 것처럼 보이는 점은 무시 (10분 안)
    if (age < 600 && dist > 300 && dist - accN - curAcc > 0 && dist / Math.max(age, 1) > 55) return;
    // 3) 오차 300m 넘는 위치는 10분 넘게 소식이 없을 때만 받음
    if (accN > 300 && age < 600) return;
  }
  await DB.prepare(
    `INSERT INTO couple_locs (who, lat, lon, acc, batt, src, t, vel) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(who) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, acc = excluded.acc,
       batt = excluded.batt, src = excluded.src, t = excluded.t, vel = excluded.vel
     WHERE excluded.t >= couple_locs.t`
  ).bind(who, lat, lon, num(d.acc), num(d.batt), d.src || "web", Math.round(t), num(d.vel)).run();
  // 이동 경로 기록 (정확도 높은 점 위주, 튀는 점 버림, 3일치만 보관)
  const acc = Number(d.acc);
  const accOk = Number.isFinite(acc) ? acc : 30;
  if (accOk > 150) return;
  const last = await DB.prepare("SELECT id, lat, lon, t, acc FROM loc_hist WHERE who = ?1 ORDER BY t DESC LIMIT 1").bind(who).first();
  if (last && t <= last.t) return;
  const moved = last ? distM({ lat, lon }, last) : Infinity;
  const dt = last ? (t - last.t) / 1000 : Infinity;
  const lastAcc = last && last.acc != null ? last.acc : 30;
  // 정확도가 낮은 점(50m 넘게 오차)은 10분 넘게 기록이 없을 때만 남김
  if (accOk > 50 && last && dt < 600) return;
  // 순간이동처럼 튀는 점 버림 (시속 200km 넘는 이동, 오차 범위로 설명 안 되는 거리)
  if (last && moved > 300 && moved - accOk - lastAcc > 0 && moved / Math.max(dt, 1) > 55) return;
  // 30초 안에 더 정확한 점이 오면 바로 앞 점을 고쳐 씀
  if (last && dt < 30 && accOk < lastAcc && moved < 80) {
    await DB.prepare("UPDATE loc_hist SET lat = ?1, lon = ?2, t = ?3, acc = ?4 WHERE id = ?5").bind(lat, lon, Math.round(t), Math.round(accOk), last.id).run();
    return;
  }
  const minMove = Math.max(20, Math.min(accOk, lastAcc));
  if (!last || moved > minMove || dt > 300) {
    await DB.batch([
      DB.prepare("INSERT INTO loc_hist (who, lat, lon, t, acc) VALUES (?1, ?2, ?3, ?4, ?5)").bind(who, lat, lon, Math.round(t), Math.round(accOk)),
      DB.prepare("DELETE FROM loc_hist WHERE t < ?1").bind(Date.now() - 3 * 864e5),
    ]);
  }
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

// ---------- 장소 도착/출발 판정 ----------
export const distM = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
// 바뀐 것만 돌려줌: [{ place, inside }]
// 한 번만 알리도록: 정확도 낮은 위치·오래된 위치는 무시, 경계 여유를 크게, 같은 장소는 20분 안에 다시 안 바꿈
export async function checkPlaces(DB, who, lat, lon, acc, t) {
  const now = Date.now();
  const a = Number(acc) || 0;
  if (a > 120) return [];
  if (t && now - Number(t) > 10 * 60000) return []; // 밀려서 늦게 온 옛날 위치
  const latest = await DB.prepare("SELECT t FROM couple_locs WHERE who = ?1").bind(who).first();
  if (latest && t && Number(t) < latest.t - 1000) return []; // 더 새 위치가 이미 있음
  const { results: places } = await DB.prepare("SELECT id, name, lat, lon, radius FROM places WHERE owner IS NULL OR owner = 'both' OR owner = ?1").bind(who).all();
  if (!places || !places.length) return [];
  const { results: states } = await DB.prepare("SELECT place_id, inside, t FROM place_state WHERE who = ?1").bind(who).all();
  const prev = new Map((states || []).map((s) => [s.place_id, s]));
  const changes = [], writes = [];
  for (const p of places) {
    const d = distM({ lat, lon }, p);
    const ps = prev.get(p.id);
    const was = ps ? ps.inside : undefined;
    let inside;
    if (was === 1) inside = d <= p.radius + Math.max(80, a) ? 1 : 0; // 확실히 멀어져야 출발
    else inside = d + a * 0.5 <= p.radius ? 1 : 0;                  // 확실히 안에 들어와야 도착
    if (was === undefined) {
      writes.push(DB.prepare("INSERT INTO place_state (who, place_id, inside, t) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(who, place_id) DO UPDATE SET inside = excluded.inside, t = excluded.t").bind(who, p.id, inside, now));
      continue;
    }
    if (inside !== was) {
      if (ps.t && now - ps.t < 20 * 60000) continue; // 20분 안에는 다시 안 바꿈
      if (inside) {
        // 도착도 지나가다 스친 걸로 판단하지 않음: 최근 몇 분 동안 계속 안에 있어야 도착
        const { results: rec } = await DB.prepare("SELECT lat, lon, acc, t FROM loc_hist WHERE who = ?1 AND t > ?2 ORDER BY t DESC LIMIT 4").bind(who, now - 10 * 60000).all();
        const pts = rec || [];
        const ins = pts.filter((q) => distM(q, p) <= p.radius + Math.min(40, Number(q.acc) || 0));
        if (pts.length < 2 || ins.length < pts.length || pts[0].t - pts[pts.length - 1].t < 3 * 60000) continue;
      }
      if (!inside) {
        // 떠남은 한 번 튄 점으로 판단하지 않음: 최근 몇 분의 기록이 전부 밖이어야 떠남
        const { results: rec } = await DB.prepare("SELECT lat, lon, acc, t FROM loc_hist WHERE who = ?1 AND t > ?2 ORDER BY t DESC LIMIT 4").bind(who, now - 8 * 60000).all();
        const pts = rec || [];
        const out = pts.filter((q) => distM(q, p) > p.radius + Math.max(80, Number(q.acc) || 0));
        if (pts.length < 2 || out.length < pts.length || pts[0].t - pts[pts.length - 1].t < 2 * 60000) continue;
      }
      changes.push({ place: p, inside: !!inside });
      writes.push(DB.prepare("UPDATE place_state SET inside = ?1, t = ?2 WHERE who = ?3 AND place_id = ?4").bind(inside, now, who, p.id));
    }
  }
  if (writes.length) await DB.batch(writes);
  return changes;
}
