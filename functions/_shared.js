// 공용 함수 (파일 이름이 _ 로 시작하면 Pages 라우트가 되지 않음)

const KEEP_MS = 7 * 24 * 60 * 60 * 1000; // 7일 지난 위치는 숨김
let tableReady = false;

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// 방 코드를 그대로 저장하지 않고 해시로 바꿔서 사용
export async function roomKey(code) {
  const data = new TextEncoder().encode("room:" + code);
  const h = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(h)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function cleanName(n) {
  return String(n || "").trim().replace(/[\u0000-\u001f]/g, "").slice(0, 20);
}

export function validCode(c) {
  return typeof c === "string" && c.length >= 6 && c.length <= 64;
}

async function ensureTable(env) {
  if (tableReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS locs (
      room TEXT NOT NULL,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      acc INTEGER,
      batt INTEGER,
      src TEXT,
      t INTEGER NOT NULL,
      PRIMARY KEY (room, name)
    )`
  ).run();
  tableReady = true;
}

export async function saveLoc(env, room, name, d) {
  const lat = Number(d.lat);
  const lon = Number(d.lon);
  if (!name) throw new Error("이름이 없음");
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error("좌표가 올바르지 않음");
  }
  const acc = Number.isFinite(Number(d.acc)) && d.acc !== null ? Math.round(Number(d.acc)) : null;
  const batt = Number.isFinite(Number(d.batt)) && d.batt !== null ? Math.round(Number(d.batt)) : null;
  let t = Number(d.t);
  if (!Number.isFinite(t) || t > Date.now() + 60000) t = Date.now();

  await ensureTable(env);
  await env.DB.prepare(
    `INSERT INTO locs (room, name, lat, lon, acc, batt, src, t)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(room, name) DO UPDATE SET
       lat = excluded.lat, lon = excluded.lon, acc = excluded.acc,
       batt = excluded.batt, src = excluded.src, t = excluded.t
     WHERE excluded.t >= locs.t`
  )
    .bind(room, name, lat, lon, acc, batt, d.src || "web", Math.round(t))
    .run();
}

export async function listLocs(env, room) {
  await ensureTable(env);
  const { results } = await env.DB.prepare(
    `SELECT name, lat, lon, acc, batt, src, t FROM locs
     WHERE room = ?1 AND t > ?2 ORDER BY t DESC`
  )
    .bind(room, Date.now() - KEEP_MS)
    .all();
  return results || [];
}

export async function deleteLoc(env, room, name) {
  await ensureTable(env);
  await env.DB.prepare(`DELETE FROM locs WHERE room = ?1 AND name = ?2`).bind(room, name).run();
}
