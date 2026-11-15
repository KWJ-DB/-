// 모든 /api/* 요청을 처리하는 라우터
import {
  json, err, body, isDate, isTime, str, todayKST,
  ensureSchema, getSettings, setSettings, saveLoc,
  randHex, hashPw, safeEq, makeToken, readToken, getCookie, cookieHeader,
  parseBasic, fromB64, checkPlaces, distM,
} from "../_lib.js";
import { getVapid, sendPush } from "../_push.js";

const REACTS = ["heart", "sparkle", "star", "fire", "like", "hug", "laugh", "wow", "sad"];
const CHOICE_SLOTS = ["c", "c1", "c2", "c3", "c4"];
// 추가 질문: bc1, bc2... (둘 중 하나), bt1, bt2... (서술형) — 끝없이
// 새 질문 세트(11/15 낮부터): 서술형 "s", 취향 "k1"~"k4"
const isChoiceSlot = (sl) => CHOICE_SLOTS.includes(sl) || /^bc\d{1,4}$/.test(sl) || /^k[1-4]$/.test(sl);
const isSlot = (sl) => sl === "t" || sl === "s" || isChoiceSlot(sl) || /^bt\d{1,4}$/.test(sl);

const OK = { ok: true };
const unauthorized = () => new Response("unauthorized", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="couple"' } });

export async function onRequest({ request, env, params, waitUntil }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const [p0, p1, p2] = parts;
  const m = request.method;
  const url = new URL(request.url);
  const q = (k) => url.searchParams.get(k) || "";

  try {
    await ensureSchema(env);
    const DB = env.DB;
    const st = await getSettings(env);
    const isSetup = !!st.pass_hash;
    // 위치가 저장된 뒤 장소 도착/출발이면 상대에게 알림
    const placeNotify = async (who, lat, lon, acc, t) => {
      try {
        const changes = await checkPlaces(DB, who, Number(lat), Number(lon), acc, t);
        if (!changes.length) return;
        const name = who === "a" ? st.a_name : st.b_name;
        const other = who === "a" ? "b" : "a";
        const evs = changes.map((c) => ({ who, place: c.place.name, inside: c.inside, t: Date.now() }));
        await setSettings(env, { last_place_ev: JSON.stringify(evs[evs.length - 1]) });
        await DB.batch(changes.map((c) => DB.prepare("INSERT INTO place_events (who, place, inside, t) VALUES (?1, ?2, ?3, ?4)").bind(who, c.place.name, c.inside ? 1 : 0, Date.now())));
        for (const c of changes) {
          await sendPush(env, st, setSettings, other, {
            title: c.inside ? `${name}님 도착` : `${name}님 출발`,
            body: c.inside ? `${c.place.name}에 도착했어요` : `${c.place.name}에서 떠났어요`,
            url: "/#map", tag: "place-" + c.place.id,
          });
        }
      } catch {}
    };
    // 둘 다 최근 위치가 있고 아주 가까우면 "함께 있음" — 만나는 순간 애니메이션 + 알림
    const togetherCheck = async () => {
      try {
        const { results } = await DB.prepare("SELECT who, lat, lon, acc, t FROM couple_locs").all();
        const L = {}; for (const r of results || []) L[r.who] = r;
        const now = Date.now();
        if (!L.a || !L.b || now - L.a.t > 4 * 60000 || now - L.b.t > 4 * 60000) return;
        const R = 6371000, rad = Math.PI / 180;
        const x = Math.sin(((L.b.lat - L.a.lat) * rad) / 2) ** 2 + Math.cos(L.a.lat * rad) * Math.cos(L.b.lat * rad) * Math.sin(((L.b.lon - L.a.lon) * rad) / 2) ** 2;
        const d = 2 * R * Math.asin(Math.sqrt(x));
        const accSum = Math.min((L.a.acc || 25) + (L.b.acc || 25), 80);
        const was = st.together === "1";
        const near = d <= Math.max(35, accSum);
        const far = d > 150;
        if (!was && near) {
          const upd = { together: "1", together_since: now };
          // 만남 애니메이션은 30분에 한 번만
          const lastMeet = Number(st.last_meet) || 0;
          if (now - lastMeet > 30 * 60000) { upd.last_meet = now; upd.last_touch = now; upd.last_touch_at = now + 1500; upd.last_touch_kind = "meet"; }
          await setSettings(env, upd);
          if (upd.last_touch) {
            for (const w of ["a", "b"]) {
              const o = w === "a" ? st.b_name : st.a_name;
              await sendPush(env, st, setSettings, w, { title: "우리 만났어요", body: `${o}님이 바로 옆에 있어요`, url: "/#home", tag: "meet" });
            }
          }
        } else if (was && far) {
          await setSettings(env, { together: "0" });
        }
      } catch {}
    };
    const later = (job) => { if (waitUntil) waitUntil(job); else return job; };
    // 가보고 싶던 맛집·갈 곳 근처(120m)에 가면 알려줌 (같은 곳은 12시간에 한 번)
    const eatNearby = async (who, lat, lon, acc) => {
      lat = Number(lat); lon = Number(lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Number(acc) > 80) return;
      const d = 0.0015;
      const { results } = await env.DB.prepare("SELECT id, name, kind, wa, wb, lat, lon FROM eats WHERE status != 'been' AND lat BETWEEN ?1 AND ?2 AND lon BETWEEN ?3 AND ?4")
        .bind(lat - d, lat + d, lon - d * 1.3, lon + d * 1.3).all();
      const st2 = await getSettings(env);
      for (const e of results || []) {
        const m = distM({ lat, lon }, e);
        if (m > 120) continue;
        const key = `eatnear_${who}_${e.id}`;
        if (Date.now() - (Number(st2[key]) || 0) < 12 * 3600e3) continue;
        await setSettings(env, { [key]: Date.now() });
        const both = e.wa && e.wb;
        await sendPush(env, st2, setSettings, who, {
          title: both ? "둘 다 찜한 곳이 바로 근처예요" : e.kind === "place" ? "가보고 싶던 곳이 근처예요" : "가보고 싶던 맛집이 근처예요",
          body: `${e.name}이(가) ${Math.round(m / 10) * 10}m 거리에 있어요`, url: "/#map", tag: "eatnear" + e.id,
        });
      }
    };

    // ---------- 로그인 없이 쓰는 것 ----------
    if (p0 === "state" && m === "GET") {
      return json({ setup: isSetup, names: isSetup ? { a: st.a_name, b: st.b_name } : null });
    }

    if (p0 === "setup" && m === "POST") {
      if (isSetup) return err(409, "이미 설정이 끝났어요");
      const b = await body(request);
      const aName = str(b.aName, 20), bName = str(b.bName, 20);
      if (!aName || !bName) return err(400, "두 사람 이름을 입력하세요");
      if (aName === bName) return err(400, "두 이름이 달라야 해요");
      if (!isDate(b.start)) return err(400, "사귄 날짜를 입력하세요");
      if (typeof b.password !== "string" || b.password.length < 4) return err(400, "비밀번호는 4자 이상이어야 해요");
      const salt = randHex(16), secret = randHex(32);
      await setSettings(env, {
        a_name: aName, b_name: bName, start: b.start,
        created: isDate(b.today) ? b.today : todayKST(),
        salt, pass_hash: await hashPw(salt, b.password), secret,
      });
      return json(OK, 200, { "set-cookie": cookieHeader(await makeToken(secret, "a")) });
    }

    if (p0 === "login" && m === "POST") {
      if (!isSetup) return err(400, "먼저 처음 설정을 해주세요");
      const b = await body(request);
      if (!["a", "b"].includes(b.who)) return err(400, "누구인지 골라주세요");
      if (!safeEq(await hashPw(st.salt, String(b.password || "")), st.pass_hash)) return err(403, "비밀번호가 틀렸어요");
      return json(OK, 200, { "set-cookie": cookieHeader(await makeToken(st.secret, b.who)) });
    }

    if (p0 === "logout" && m === "POST") {
      return json(OK, 200, { "set-cookie": cookieHeader("", 0) });
    }

    // OwnTracks 앱 (화면 꺼도 위치 공유) — Basic 인증: 아이디 = 내 이름, 비밀번호 = 커플 비밀번호
    if (p0 === "owntracks" && m === "POST") {
      const cred = parseBasic(request.headers.get("authorization"));
      if (!isSetup || !cred) return unauthorized();
      if (!safeEq(await hashPw(st.salt, cred.pass), st.pass_hash)) return unauthorized();
      const u = cred.user.trim();
      const who = u === st.a_name || u === "a" ? "a" : u === st.b_name || u === "b" ? "b" : null;
      if (!who) return unauthorized();
      let b = null;
      try { b = await request.json(); } catch {}
      if (b && b._type === "location") {
        try {
          await saveLoc(DB, who, { lat: b.lat, lon: b.lon, acc: b.acc, batt: b.batt, vel: b.vel, t: b.tst ? b.tst * 1000 : Date.now(), src: "app" });
          await later(placeNotify(who, b.lat, b.lon, b.acc, b.tst ? b.tst * 1000 : Date.now()).then(togetherCheck).then(() => eatNearby(who, b.lat, b.lon, b.acc)).catch(() => {}));
        } catch {}
      }
      const other = who === "a" ? "b" : "a";
      const r = await DB.prepare("SELECT * FROM couple_locs WHERE who = ?1").bind(other).first();
      if (!r) return json([]);
      const name = other === "a" ? st.a_name : st.b_name;
      const msg = { _type: "location", lat: r.lat, lon: r.lon, tst: Math.floor(r.t / 1000), tid: [...name].slice(0, 2).join(""), topic: `owntracks/${other}/phone` };
      if (r.acc != null) msg.acc = r.acc;
      if (r.batt != null) msg.batt = r.batt;
      return json([msg]);
    }

    // ---------- NFC 맞대기 (단축어 앱이 여는 링크, 로그인 없이 개인 토큰으로) ----------
    const nfcToken = async (w) => {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(st.secret || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("nfc:" + w)));
      return w + [...sig.slice(0, 9)].map((b) => b.toString(16).padStart(2, "0")).join("");
    };
    const nfcWho = async (k) => {
      if (!isSetup || typeof k !== "string" || k.length < 10) return null;
      const w = k[0];
      if (!["a", "b"].includes(w)) return null;
      return safeEq(k, await nfcToken(w)) ? w : null;
    };
    if (p0 === "nfc") {
      const b = m === "POST" ? await body(request) : {};
      const nw = await nfcWho(m === "POST" ? b.k : q("k"));
      if (!nw) return err(403, "링크가 올바르지 않아요");
      const now = Date.now();
      const base = { names: { a: st.a_name, b: st.b_name }, who: nw, start: st.start, now };
      if (m === "GET") return json({ ...base, touch: Number(st.last_touch) || 0, at: Number(st.last_touch_at) || 0, kind: st.last_touch_kind || "" });
      const other = nw === "a" ? "b" : "a";
      await DB.batch([
        DB.prepare("DELETE FROM touches WHERE t < ?1").bind(now - 60000),
        DB.prepare("INSERT INTO touches (who, kind, t) VALUES (?1, 'nfc', ?2)").bind(nw, now),
      ]);
      // 두 폰이 6초 안에 서로의 스티커를 읽었으면 성공
      const r = await DB.prepare("SELECT COUNT(*) AS n FROM touches WHERE who = ?1 AND kind = 'nfc' AND t > ?2").bind(other, now - 6000).first();
      const last = Number(st.last_touch) || 0;
      if (r && r.n > 0 && now - last > 4000) {
        const at = now + 1500;
        await setSettings(env, { last_touch: now, last_touch_at: at, last_touch_kind: "nfc" });
        return json({ ...base, match: true, touch: now, at, kind: "nfc" });
      }
      return json({ ...base, match: false, touch: last, at: Number(st.last_touch_at) || 0, kind: st.last_touch_kind || "" });
    }

    // ---------- 여기부터 로그인 필요 ----------
    if (!isSetup) return err(401, "처음 설정이 필요해요");
    const who = await readToken(st.secret, getCookie(request, "cp"));
    if (!who) return err(401, "로그인이 필요해요");
    const id = p1 ? Number(p1) : null;
    const route = `${m} ${p0}`;
    // 접속 중 표시: 30초마다 마지막 활동 시각 기록
    if (Date.now() - (Number(st["seen_" + who]) || 0) > 30000) {
      const job = setSettings(env, { ["seen_" + who]: Date.now() }).catch(() => {});
      if (waitUntil) waitUntil(job); else await job;
    }

    switch (route) {
      case "GET nfclink":
        return json({ url: `${url.origin}/touch.html#${await nfcToken(who)}` });
      case "GET me": {
        const { results: av } = await DB.prepare("SELECT who, t FROM avatars").all();
        const avatars = {};
        for (const r of av || []) avatars[r.who] = r.t;
        const mood = {};
        for (const w of ["a", "b"]) { try { mood[w] = st["mood_" + w] ? JSON.parse(st["mood_" + w]) : null; } catch { mood[w] = null; } }
        return json({ who, names: { a: st.a_name, b: st.b_name }, start: st.start, created: st.created, avatars, mood, nextMeet: st.next_meet || "", naver: !!(st.naver_id && st.naver_secret), kakao: !!st.kakao_key, kakaoJs: st.kakao_js || "" });
      }
      case "POST meet": {
        const b = await body(request);
        await setSettings(env, { next_meet: isDate(b.date) ? b.date : "" });
        return json(OK);
      }
      // 둘 다 답한 날이 며칠 연속인지 (오늘 아직 안 했으면 어제부터 셈)
      case "GET streak": {
        const { results } = await DB.prepare("SELECT qdate, COUNT(DISTINCT who) AS n FROM answers GROUP BY qdate ORDER BY qdate DESC LIMIT 400").all();
        const both = new Set((results || []).filter((r) => r.n >= 2).map((r) => r.qdate));
        const day = (d, k) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
        let d = q("today") && isDate(q("today")) ? q("today") : todayKST();
        if (!both.has(d)) d = day(d, -1);
        let n = 0;
        while (both.has(d)) { n++; d = day(d, -1); }
        return json({ streak: n });
      }
      // ----- 편지 (정한 날짜에 열림) -----
      case "GET letters": {
        const t = isDate(q("today")) ? q("today") : todayKST();
        const { results } = await DB.prepare("SELECT id, from_who, body, open_date, read, t FROM letters ORDER BY open_date DESC, id DESC LIMIT 100").all();
        const letters = (results || []).map((l) => {
          const mine = l.from_who === who;
          const open = l.open_date <= t;
          return { id: l.id, from: l.from_who, open_date: l.open_date, read: !!l.read, t: l.t, mine, open, body: mine || open ? l.body : null };
        });
        return json({ letters, unread: letters.filter((l) => !l.mine && l.open && !l.read).length });
      }
      case "POST letters": {
        const b = await body(request);
        if (id && p2 === "read") {
          await DB.prepare("UPDATE letters SET read = 1 WHERE id = ?1 AND from_who != ?2").bind(id, who).run();
          return json(OK);
        }
        const text = str(b.body, 3000);
        if (!text) return err(400, "편지 내용을 적어주세요");
        const od = isDate(b.open_date) ? b.open_date : todayKST();
        await DB.prepare("INSERT INTO letters (from_who, body, open_date, read, t) VALUES (?1, ?2, ?3, 0, ?4)").bind(who, text, od, Date.now()).run();
        if (od <= todayKST()) {
          const name = who === "a" ? st.a_name : st.b_name;
          const job = sendPush(env, st, setSettings, who === "a" ? "b" : "a", { title: "편지가 도착했어요", body: `${name}님이 편지를 보냈어요`, url: "/#home", tag: "letter" });
          if (waitUntil) waitUntil(job); else await job;
        }
        return json(OK);
      }
      case "DELETE letters":
        await DB.prepare("DELETE FROM letters WHERE id = ?1 AND from_who = ?2").bind(id, who).run();
        return json(OK);
      // ----- 오늘의 한 장 (둘 다 올려야 서로 보임) -----
      case "GET daily": {
        const d = isDate(q("date")) ? q("date") : todayKST();
        const { results } = await DB.prepare("SELECT date, who, t FROM daily_photos WHERE date <= ?1 ORDER BY date DESC LIMIT 30").bind(d).all();
        const byDate = {};
        for (const r of results || []) (byDate[r.date] ||= {})[r.who] = r.t;
        const days = Object.keys(byDate).sort().reverse().slice(0, 14).map((date) => {
          const x = byDate[date], me = x[who], ot = x[who === "a" ? "b" : "a"];
          return { date, mine: !!me, partner: !!ot, open: !!(me && ot) };
        });
        return json({ days });
      }
      case "POST daily": {
        const b = await body(request);
        const d = todayKST();
        if (typeof b.data !== "string" || typeof b.thumb !== "string" || b.data.length > 1500000) return err(400, "사진이 올바르지 않아요");
        await DB.prepare("INSERT INTO daily_photos (date, who, thumb, data, t) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(date, who) DO UPDATE SET thumb = excluded.thumb, data = excluded.data, t = excluded.t")
          .bind(isDate(b.date) && b.date <= d ? b.date : d, who, b.thumb, b.data, Date.now()).run();
        const name = who === "a" ? st.a_name : st.b_name;
        const job = sendPush(env, st, setSettings, who === "a" ? "b" : "a", { title: "오늘의 한 장", body: `${name}님이 오늘의 사진을 올렸어요`, url: "/#home", tag: "daily" });
        if (waitUntil) waitUntil(job); else await job;
        return json(OK);
      }
      case "GET dailyimg": {
        const d = q("date"), w = q("w") === "b" ? "b" : "a";
        if (!isDate(d)) return err(400, "날짜 오류");
        if (w !== who) {
          const mine = await DB.prepare("SELECT 1 FROM daily_photos WHERE date = ?1 AND who = ?2").bind(d, who).first();
          if (!mine) return err(403, "내 사진을 먼저 올려야 볼 수 있어요");
        }
        const r = await DB.prepare(`SELECT ${q("thumb") ? "thumb" : "data"} AS img FROM daily_photos WHERE date = ?1 AND who = ?2`).bind(d, w).first();
        if (!r || !r.img) return err(404, "사진 없음");
        return new Response(fromB64(r.img), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
      }

      // ----- 사랑 쿠폰 -----
      case "GET coupons": {
        const { results } = await DB.prepare("SELECT id, from_who, title, used, used_t, t FROM coupons ORDER BY used, id DESC LIMIT 100").all();
        return json({ coupons: results || [] });
      }
      case "POST coupons": {
        const b = await body(request);
        if (id && p2 === "use") {
          const c = await DB.prepare("SELECT from_who, title, used FROM coupons WHERE id = ?1").bind(id).first();
          if (!c || c.from_who === who) return err(400, "받은 쿠폰만 쓸 수 있어요");
          if (c.used) return err(409, "이미 쓴 쿠폰이에요");
          await DB.prepare("UPDATE coupons SET used = 1, used_t = ?1 WHERE id = ?2").bind(Date.now(), id).run();
          const name = who === "a" ? st.a_name : st.b_name;
          const job = sendPush(env, st, setSettings, c.from_who, { title: "쿠폰을 썼어요", body: `${name}님이 "${c.title}"을 썼어요`, url: "/#home", tag: "coupon" });
          if (waitUntil) waitUntil(job); else await job;
          return json(OK);
        }
        const title = str(b.title, 30);
        if (!title) return err(400, "쿠폰 이름을 적어주세요");
        await DB.prepare("INSERT INTO coupons (from_who, title, used, t) VALUES (?1, ?2, 0, ?3)").bind(who, title, Date.now()).run();
        const name = who === "a" ? st.a_name : st.b_name;
        const job = sendPush(env, st, setSettings, who === "a" ? "b" : "a", { title: "쿠폰이 왔어요", body: `${name}님이 "${title}"을 줬어요`, url: "/#home", tag: "coupon" });
        if (waitUntil) waitUntil(job); else await job;
        return json(OK);
      }
      case "DELETE coupons":
        await DB.prepare("DELETE FROM coupons WHERE id = ?1 AND from_who = ?2").bind(id, who).run();
        return json(OK);

      // ----- 우리 기록 -----
      case "GET stats": {
        const one = async (sql) => ((await DB.prepare(sql).first()) || {}).n || 0;
        const [msgs, photos, chatImgs, bothDays, bucketDone, letters, coupons, daily] = await Promise.all([
          one("SELECT COUNT(*) AS n FROM messages"),
          one("SELECT COUNT(*) AS n FROM photos"),
          one("SELECT COUNT(*) AS n FROM chat_imgs"),
          one("SELECT COUNT(*) AS n FROM (SELECT qdate FROM answers GROUP BY qdate HAVING COUNT(DISTINCT who) >= 2)"),
          one("SELECT COUNT(*) AS n FROM bucket WHERE done = 1"),
          one("SELECT COUNT(*) AS n FROM letters"),
          one("SELECT COUNT(*) AS n FROM coupons WHERE used = 1"),
          one("SELECT COUNT(*) AS n FROM (SELECT date FROM daily_photos GROUP BY date HAVING COUNT(*) >= 2)"),
        ]);
        return json({ msgs, photos: photos + chatImgs, bothDays, bucketDone, letters, coupons, daily });
      }
      case "POST mood": {
        const b = await body(request);
        const MOODS = ["happy", "flutter", "tired", "busy", "study", "gloomy", "hungry", "miss", "exercise"];
        const m = MOODS.includes(b.m) ? b.m : null;
        const v = m ? JSON.stringify({ m, text: str(b.text, 30), t: Date.now() }) : "";
        await setSettings(env, { ["mood_" + who]: v });
        return json(OK);
      }
      case "POST miss": {
        // 보고싶어: 상대에게 알림 + 앱 안 표시
        const now = Date.now();
        const last = Number(st["miss_t_" + who]) || 0;
        if (now - last < 10000) return json({ ok: true, throttled: true });
        const name = who === "a" ? st.a_name : st.b_name;
        await setSettings(env, { ["miss_t_" + who]: now, last_miss: JSON.stringify({ who, t: now }) });
        const job = sendPush(env, st, setSettings, who === "a" ? "b" : "a", { title: name, body: `${name}님이 보고 싶대요`, url: "/#home", tag: "miss" });
        if (waitUntil) waitUntil(job); else await job;
        return json(OK);
      }
      case "GET avatar": {
        const w = p1 === "b" ? "b" : p1 === "cover" ? "cover" : "a";
        const r = await DB.prepare("SELECT data FROM avatars WHERE who = ?1").bind(w).first();
        if (!r) return err(404, "사진 없음");
        return new Response(fromB64(r.data), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
      }
      case "POST cover": {
        const b = await body(request);
        if (typeof b.data !== "string" || !b.data || b.data.length > 600000) return err(400, "사진이 올바르지 않아요");
        const t = Date.now();
        await DB.prepare("INSERT INTO avatars (who, data, t) VALUES ('cover', ?1, ?2) ON CONFLICT(who) DO UPDATE SET data = excluded.data, t = excluded.t").bind(b.data, t).run();
        return json({ ok: true, t });
      }
      case "DELETE cover":
        await DB.prepare("DELETE FROM avatars WHERE who = 'cover'").run();
        return json(OK);
      case "POST avatar": {
        const b = await body(request);
        if (typeof b.data !== "string" || !b.data || b.data.length > 200000) return err(400, "사진이 올바르지 않아요");
        const t = Date.now();
        await DB.prepare("INSERT INTO avatars (who, data, t) VALUES (?1, ?2, ?3) ON CONFLICT(who) DO UPDATE SET data = excluded.data, t = excluded.t").bind(who, b.data, t).run();
        return json({ ok: true, t });
      }
      case "DELETE avatar":
        await DB.prepare("DELETE FROM avatars WHERE who = ?1").bind(who).run();
        return json(OK);

      case "POST settings": {
        const b = await body(request);
        const aName = str(b.aName, 20), bName = str(b.bName, 20);
        if (!aName || !bName || aName === bName) return err(400, "이름을 확인하세요");
        if (!isDate(b.start)) return err(400, "날짜를 확인하세요");
        await setSettings(env, { a_name: aName, b_name: bName, start: b.start });
        return json(OK);
      }

      case "POST password": {
        const b = await body(request);
        if (!safeEq(await hashPw(st.salt, String(b.old || "")), st.pass_hash)) return err(403, "현재 비밀번호가 틀렸어요");
        if (typeof b.new !== "string" || b.new.length < 4) return err(400, "새 비밀번호는 4자 이상");
        const salt = randHex(16), secret = randHex(32);
        await setSettings(env, { salt, pass_hash: await hashPw(salt, b.new), secret });
        return json(OK, 200, { "set-cookie": cookieHeader(await makeToken(secret, who)) });
      }

      // ----- 위치 -----
      case "GET loc": {
        const { results } = await DB.prepare("SELECT who, lat, lon, acc, batt, src, t, vel FROM couple_locs").all();
        const locs = {};
        for (const r of results || []) locs[r.who] = r;
        return json({ now: Date.now(), locs });
      }
      case "POST loc": {
        const b = await body(request);
        await saveLoc(DB, who, { ...b, src: "web", t: Date.now() });
        await later(placeNotify(who, b.lat, b.lon, b.acc, Date.now()).then(togetherCheck).then(() => eatNearby(who, b.lat, b.lon, b.acc)).catch(() => {}));
        return json(OK);
      }
      case "DELETE loc":
        await DB.prepare("DELETE FROM couple_locs WHERE who = ?1").bind(who).run();
        return json(OK);

      // ----- 맛집 지도 -----
      case "GET eats": {
        if (id) {
          const [im, vs] = await DB.batch([
            DB.prepare("SELECT id, who, w, h, t FROM eat_imgs WHERE eat_id = ?1 ORDER BY id DESC").bind(id),
            DB.prepare("SELECT id, date, menu, who FROM eat_visits WHERE eat_id = ?1 ORDER BY date DESC, id DESC").bind(id),
          ]);
          return json({ imgs: im.results || [], visits: vs.results || [] });
        }
        const [e, ic, vc] = await DB.batch([
          DB.prepare("SELECT * FROM eats ORDER BY id DESC"),
          DB.prepare("SELECT eat_id, COUNT(*) AS n, MAX(id) AS last FROM eat_imgs GROUP BY eat_id"),
          DB.prepare("SELECT eat_id, COUNT(*) AS n, MAX(date) AS last FROM eat_visits GROUP BY eat_id"),
        ]);
        const im = {}, vi = {};
        for (const r of ic.results || []) im[r.eat_id] = r;
        for (const r of vc.results || []) vi[r.eat_id] = r;
        return json({ eats: (e.results || []).map((x) => ({ ...x, imgN: im[x.id] ? im[x.id].n : 0, cover: im[x.id] ? im[x.id].last : null, visitN: vi[x.id] ? vi[x.id].n : 0, lastVisit: vi[x.id] ? vi[x.id].last : null })) });
      }
      case "GET eatimg": {
        const col = q("thumb") ? "thumb" : "data";
        const r = await DB.prepare(`SELECT ${col} AS img FROM eat_imgs WHERE id = ?1`).bind(id).first();
        if (!r || !r.img) return err(404, "사진이 없어요");
        return new Response(fromB64(r.img), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
      }
      case "DELETE eatimg": {
        await DB.prepare("DELETE FROM eat_imgs WHERE id = ?1").bind(id).run();
        return json(OK);
      }
      case "DELETE eatvisit": {
        await DB.prepare("DELETE FROM eat_visits WHERE id = ?1").bind(id).run();
        return json(OK);
      }
      case "POST eats": {
        const b = await body(request);
        const CATS = ["한식", "일식", "중식", "양식", "아시안", "카페", "디저트", "분식", "고기", "술집", "기타", "공원", "산책", "전시", "영화", "공연", "쇼핑", "놀거리", "야경", "여행"];
        if (id && p2 === "img") {
          const im = b.img || {};
          if (typeof im.data !== "string" || typeof im.thumb !== "string") return err(400, "사진이 없어요");
          if (im.data.length > 1500000 || im.thumb.length > 300000) return err(413, "사진이 너무 커요");
          const r = await DB.prepare("INSERT INTO eat_imgs (eat_id, who, w, h, thumb, data, t) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
            .bind(id, who, Number(im.w) || 0, Number(im.h) || 0, im.thumb, im.data, Date.now()).run();
          return json({ ok: true, id: r.meta.last_row_id });
        }
        if (id && p2 === "visit") {
          const d = isDate(b.date) ? b.date : todayKST();
          await DB.prepare("INSERT INTO eat_visits (eat_id, date, menu, who, t) VALUES (?1, ?2, ?3, ?4, ?5)").bind(id, d, str(b.menu, 120) || null, who, Date.now()).run();
          await DB.prepare("UPDATE eats SET status = 'been', been = COALESCE(been, ?2) WHERE id = ?1").bind(id, d).run();
          return json(OK);
        }
        if (id && p2 === "want") {
          const cur = await DB.prepare("SELECT w" + who + " AS v, name FROM eats WHERE id = ?1").bind(id).first();
          if (!cur) return err(404, "맛집이 없어요");
          const on = cur.v ? 0 : 1;
          await DB.prepare(`UPDATE eats SET w${who} = ?1 WHERE id = ?2`).bind(on, id).run();
          if (on) {
            const o = await DB.prepare(`SELECT w${who === "a" ? "b" : "a"} AS v FROM eats WHERE id = ?1`).bind(id).first();
            if (o && o.v) {
              const job = sendPush(env, st, setSettings, who === "a" ? "b" : "a", { title: "둘 다 가고 싶은 곳", body: `${cur.name}, 우리 둘 다 찜했어요`, url: "/#map", tag: "eatwant" });
              if (waitUntil) waitUntil(job); else await job;
            }
          }
          return json({ ok: true, on: !!on });
        }
        if (id) {
          const cur = await DB.prepare("SELECT * FROM eats WHERE id = ?1").bind(id).first();
          if (!cur) return err(404, "맛집이 없어요");
          const up = {};
          if (b.name !== undefined) { const n = str(b.name, 40); if (!n) return err(400, "이름을 입력하세요"); up.name = n; }
          if (b.cat !== undefined) up.cat = CATS.includes(b.cat) ? b.cat : "기타";
          if (b.memo !== undefined) up.memo = str(b.memo, 300) || null;
          if (b.addr !== undefined) up.addr = str(b.addr, 120) || null;
          if (b.price !== undefined) { const pr = Math.round(Number(b.price)); up.price = pr >= 1 && pr <= 3 ? pr : null; }
          if (b.lat !== undefined || b.lon !== undefined) {
            const la = Number(b.lat), lo = Number(b.lon);
            if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return err(400, "위치가 올바르지 않아요");
            up.lat = la; up.lon = lo;
          }
          if (b.been !== undefined) up.been = isDate(b.been) ? b.been : null;
          if (b.status !== undefined) { up.status = b.status === "been" ? "been" : "want"; if (up.status === "been" && !cur.been) up.been = todayKST(); }
          if (b.rate !== undefined) { const r = Math.round(Number(b.rate)); up["r" + who] = r >= 1 && r <= 5 ? r : null; if (!cur.been) { up.status = "been"; up.been = todayKST(); } }
          const keys = Object.keys(up);
          if (keys.length) await DB.prepare(`UPDATE eats SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(", ")} WHERE id = ?${keys.length + 1}`).bind(...keys.map((k) => up[k]), id).run();
          return json(OK);
        }
        const name = str(b.name, 40);
        const lat = Number(b.lat), lon = Number(b.lon);
        if (!name) return err(400, "이름을 입력하세요");
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return err(400, "위치가 올바르지 않아요");
        const status = b.status === "been" ? "been" : "want";
        const link = /^https?:\/\//.test(b.link || "") ? str(b.link, 200) : null;
        const kind = b.kind === "place" ? "place" : "food";
        const pr = Math.round(Number(b.price));
        const r = await DB.prepare(`INSERT INTO eats (name, cat, lat, lon, addr, status, memo, who, t, been, link, w${who}, kind, price) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
          .bind(name, CATS.includes(b.cat) ? b.cat : "기타", lat, lon, str(b.addr, 120) || null, status, str(b.memo, 300) || null, who, Date.now(), status === "been" ? todayKST() : null, link, status === "want" ? 1 : 0, kind, pr >= 1 && pr <= 3 ? pr : null).run();
        const nmMe = who === "a" ? st.a_name : st.b_name;
        const job = sendPush(env, st, setSettings, who === "a" ? "b" : "a", { title: kind === "place" ? "갈 곳" : "맛집 지도", body: `${nmMe}님이 ${status === "been" ? "다녀온" : "가보고 싶은"} ${kind === "place" ? "곳" : "맛집"}을 추가했어요: ${name}`, url: "/#map", tag: "eat" });
        if (waitUntil) waitUntil(job); else await job;
        return json({ ok: true, id: r.meta.last_row_id });
      }
      case "DELETE eats": {
        if (!id) return err(400, "id가 필요해요");
        await DB.batch([
          DB.prepare("DELETE FROM eats WHERE id = ?1").bind(id),
          DB.prepare("DELETE FROM eat_imgs WHERE eat_id = ?1").bind(id),
          DB.prepare("DELETE FROM eat_visits WHERE eat_id = ?1").bind(id),
        ]);
        return json(OK);
      }
      // 네이버 검색 API 키 연결 (키는 서버에만 저장)
      case "POST naverkey": {
        const b = await body(request);
        const idk = str(b.id, 80), sec = str(b.secret, 80);
        if (!idk && !sec) { await setSettings(env, { naver_id: "", naver_secret: "" }); return json(OK); }
        if (!idk || !sec) return err(400, "Client ID와 Client Secret을 둘 다 넣어주세요");
        const t = await naverLocal("맛집", idk, sec);
        if (!t.ok) return err(400, t.msg);
        await setSettings(env, { naver_id: idk, naver_secret: sec });
        return json(OK);
      }
      case "POST kakaojs": {
        const b = await body(request);
        const k = str(b.key, 80);
        if (k && !/^[0-9a-f]{32}$/i.test(k)) return err(400, "JavaScript 키는 영문·숫자 32자예요. REST API 키와 헷갈리지 않았는지 확인해 주세요");
        await setSettings(env, { kakao_js: k || "" });
        return json(OK);
      }
      case "POST kakaokey": {
        const b = await body(request);
        const k = str(b.key, 80).replace(/^KakaoAK\s+/i, "");
        if (!k) { await setSettings(env, { kakao_key: "" }); return json(OK); }
        const t = await kakaoLocal("맛집", k, 35.87, 128.6);
        if (!t.ok) return err(400, t.msg);
        await setSettings(env, { kakao_key: k });
        return json(OK);
      }
      // 가게 검색: 카카오 → 네이버 → (없으면) Photon → Nominatim
      case "GET geo": {
        const kw = str(q("q"), 60);
        if (!kw) return json({ results: [] });
        const la = Number(q("lat")), lo = Number(q("lon"));
        const bias = Number.isFinite(la) && Number.isFinite(lo) ? `&lat=${la}&lon=${lo}` : "";
        const out = [];
        if (st.kakao_key) {
          const [r1, r2] = await Promise.all([
            kakaoLocal(kw, st.kakao_key, bias ? la : null, bias ? lo : null),
            bias ? kakaoLocal(kw, st.kakao_key, la, lo, "distance") : Promise.resolve({ items: [] }),
          ]);
          const seen = new Set();
          for (const it of [...(r2.items || []), ...(r1.items || [])]) { if (seen.has(it.id)) continue; seen.add(it.id); out.push(it); }
          if (bias) out.sort((x, y) => distM({ lat: la, lon: lo }, x) - distM({ lat: la, lon: lo }, y));
          if (r1.ok) return json({ results: out.slice(0, 25), src: "kakao" });
        }
        if (st.naver_id && st.naver_secret) {
          const qs = [kw];
          // 동네 이름을 붙인 검색도 같이 해서 가까운 가게가 잘 나오게 (예: "수성구 파스타")
          if (bias && !/[시군구동읍면로길역]\s/.test(kw + " ")) {
            try {
              const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ko&zoom=14&lat=${la}&lon=${lo}`, { headers: { "User-Agent": "wooju-couple/1.0 (private couple site)" } });
              const a = (await r.json()).address || {};
              const area = a.borough || a.city_district || a.suburb || a.county || a.city;
              const dong = a.quarter || a.neighbourhood || a.suburb;
              if (area) qs.push(`${area} ${kw}`);
              if (dong && dong !== area) qs.push(`${dong} ${kw}`);
            } catch {}
          }
          const res = await Promise.all(qs.map((x) => naverLocal(x, st.naver_id, st.naver_secret)));
          const seen = new Set();
          for (const r of res) for (const it of r.items || []) {
            const k = it.name + "|" + it.addr;
            if (seen.has(k)) continue;
            seen.add(k); out.push(it);
          }
          if (bias) out.sort((x, y) => distM({ lat: la, lon: lo }, x) - distM({ lat: la, lon: lo }, y));
          if (out.length || res.some((r) => r.ok)) return json({ results: out, src: "naver" });
        }
        try {
          const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(kw)}&limit=10${bias}`, { headers: { "User-Agent": "wooju-couple/1.0" } });
          const d = await r.json();
          for (const f of d.features || []) {
            const p = f.properties || {}, [x, y] = f.geometry.coordinates;
            if (p.countrycode && p.countrycode !== "KR") continue;
            out.push({ name: p.name || kw, addr: [p.city || p.county, p.district, p.street, p.housenumber].filter(Boolean).join(" "), lat: y, lon: x, kind: p.osm_value || "" });
          }
        } catch {}
        if (!out.length) {
          try {
            const vb = bias ? `&viewbox=${lo - 0.3},${la + 0.3},${lo + 0.3},${la - 0.3}` : "";
            const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=ko&countrycodes=kr&limit=10&q=${encodeURIComponent(kw)}${vb}`, { headers: { "User-Agent": "wooju-couple/1.0 (private couple site)" } });
            for (const p of await r.json()) out.push({ name: p.name || p.display_name.split(",")[0], addr: p.display_name.split(",").slice(1, 4).join(" ").trim(), lat: Number(p.lat), lon: Number(p.lon), kind: p.type || "" });
          } catch {}
        }
        return json({ results: out });
      }

      // ----- 장소 (도착/출발 알림) -----
      case "GET places": {
        const { results } = await DB.prepare("SELECT id, name, lat, lon, radius, owner FROM places ORDER BY id").all();
        const { results: stt } = await DB.prepare("SELECT who, place_id, inside FROM place_state").all();
        let ev = null;
        try { ev = st.last_place_ev ? JSON.parse(st.last_place_ev) : null; } catch {}
        return json({ places: results || [], state: stt || [], last: ev });
      }
      case "POST places": {
        const b = await body(request);
        const name = str(b.name, 20);
        const lat = Number(b.lat), lon = Number(b.lon), radius = Math.round(Number(b.radius));
        if (!name) return err(400, "장소 이름을 입력하세요");
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return err(400, "위치가 올바르지 않아요");
        if (!(radius >= 50 && radius <= 2000)) return err(400, "반경은 50m~2km");
        const owner = ["a", "b", "both"].includes(b.owner) ? b.owner : "both";
        if (id) {
          await DB.prepare("UPDATE places SET name = ?1, lat = ?2, lon = ?3, radius = ?4, owner = ?5 WHERE id = ?6").bind(name, lat, lon, radius, owner, id).run();
          return json(OK);
        }
        await DB.prepare("INSERT INTO places (name, lat, lon, radius, who, t, owner) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(name, lat, lon, radius, who, Date.now(), owner).run();
        return json(OK);
      }
      case "DELETE places":
        await DB.batch([
          DB.prepare("DELETE FROM places WHERE id = ?1").bind(id),
          DB.prepare("DELETE FROM place_state WHERE place_id = ?1").bind(id),
        ]);
        return json(OK);

      // ----- 오늘의 질문 -----
      case "GET answers": {
        const from = q("from"), to = q("to");
        if (!isDate(from) || !isDate(to)) return err(400, "기간이 올바르지 않아요");
        const { results } = await DB.prepare("SELECT qdate, slot, who, answer, t FROM answers WHERE qdate BETWEEN ?1 AND ?2").bind(from, to).all();
        const mine = new Set((results || []).filter((r) => r.who === who).map((r) => r.qdate + "|" + r.slot));
        // 내가 아직 안 답한 질문은 상대 답을 가림
        const out = (results || []).map((r) =>
          r.who !== who && !mine.has(r.qdate + "|" + r.slot) ? { ...r, answer: null, hidden: true } : r
        );
        return json({ answers: out });
      }
      case "POST answers": {
        const b = await body(request);
        if (!isDate(b.qdate) || b.qdate > todayKST()) return err(400, "날짜가 올바르지 않아요");
        if (!isSlot(b.slot)) return err(400, "질문 종류가 올바르지 않아요");
        const answer = str(b.answer, 1000);
        if (!answer) return err(400, "답을 입력하세요");
        if (isChoiceSlot(b.slot)) {
          if (!["0", "1"].includes(answer)) return err(400, "선택지가 올바르지 않아요");
          const had = await DB.prepare("SELECT 1 FROM answers WHERE qdate = ?1 AND slot = ?2 AND who = ?3").bind(b.qdate, b.slot, who).first();
          if (had) return err(409, "이미 골랐어요. 한 번만 고를 수 있어요");
        }
        await DB.prepare(
          `INSERT INTO answers (qdate, slot, who, answer, t) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(qdate, slot, who) DO UPDATE SET answer = excluded.answer, t = excluded.t`
        ).bind(b.qdate, b.slot, who, answer, Date.now()).run();
        return json(OK);
      }

      // ----- 달력 (일정 + 사진 목록) -----
      case "GET calendar": {
        const from = q("from"), to = q("to");
        if (!isDate(from) || !isDate(to)) return err(400, "기간이 올바르지 않아요");
        const [ev, ph] = await DB.batch([
          DB.prepare("SELECT id, date, time, title, memo, who FROM events WHERE date BETWEEN ?1 AND ?2 ORDER BY date, time IS NULL, time, id").bind(from, to),
          DB.prepare("SELECT id, date, caption, who, w, h, t FROM photos WHERE date BETWEEN ?1 AND ?2 ORDER BY date, id").bind(from, to),
        ]);
        return json({ events: ev.results || [], photos: ph.results || [] });
      }

      case "POST events": {
        const b = await body(request);
        const title = str(b.title, 60);
        if (!isDate(b.date) || !title) return err(400, "날짜와 내용을 입력하세요");
        const r = await DB.prepare("INSERT INTO events (date, time, title, memo, who, t) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
          .bind(b.date, isTime(b.time) ? b.time : null, title, str(b.memo, 300) || null, who, Date.now()).run();
        return json({ ok: true, id: r.meta?.last_row_id });
      }
      case "DELETE events":
        await DB.prepare("DELETE FROM events WHERE id = ?1").bind(id).run();
        return json(OK);

      // ----- 기념일 -----
      case "GET anniv": {
        const { results } = await DB.prepare("SELECT id, title, date, yearly, who FROM anniv ORDER BY date").all();
        return json({ anniv: results || [] });
      }
      case "POST anniv": {
        const b = await body(request);
        const title = str(b.title, 30);
        if (!isDate(b.date) || !title) return err(400, "날짜와 이름을 입력하세요");
        await DB.prepare("INSERT INTO anniv (title, date, yearly, who, t) VALUES (?1, ?2, ?3, ?4, ?5)")
          .bind(title, b.date, b.yearly ? 1 : 0, who, Date.now()).run();
        return json(OK);
      }
      case "DELETE anniv":
        await DB.prepare("DELETE FROM anniv WHERE id = ?1").bind(id).run();
        return json(OK);

      // ----- 사진 -----
      case "GET photos": {
        const n = Math.min(Math.max(Number(q("recent")) || 12, 1), 60);
        const { results } = await DB.prepare("SELECT id, date, caption, who, w, h, t FROM photos ORDER BY date DESC, id DESC LIMIT ?1").bind(n).all();
        return json({ photos: results || [] });
      }
      case "GET album": {
        const offset = Math.max(0, Number(q("offset")) || 0);
        const { results } = await DB.prepare("SELECT id, date, caption, who, w, h, t FROM photos ORDER BY date DESC, id DESC LIMIT 60 OFFSET ?1").bind(offset).all();
        const c = await DB.prepare("SELECT COUNT(*) AS n FROM photos").first();
        return json({ photos: results || [], total: c ? c.n : 0 });
      }
      case "POST photos": {
        const b = await body(request);
        if (!isDate(b.date)) return err(400, "날짜가 올바르지 않아요");
        const data = typeof b.data === "string" ? b.data : "";
        const thumb = typeof b.thumb === "string" ? b.thumb : "";
        if (!data || !thumb) return err(400, "사진이 없어요");
        if (data.length > 1500000 || thumb.length > 200000) return err(413, "사진이 너무 커요");
        if (!/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 200))) return err(400, "사진 형식이 올바르지 않아요");
        const r = await DB.prepare("INSERT INTO photos (date, caption, who, w, h, t, thumb, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
          .bind(b.date, str(b.caption, 100) || null, who, Number(b.w) || null, Number(b.h) || null, Date.now(), thumb, data).run();
        return json({ ok: true, id: r.meta?.last_row_id });
      }
      case "DELETE photos":
        await DB.prepare("DELETE FROM photos WHERE id = ?1").bind(id).run();
        return json(OK);
      case "GET photo": {
        const col = q("thumb") ? "thumb" : "data";
        const r = await DB.prepare(`SELECT ${col} AS img FROM photos WHERE id = ?1`).bind(id).first();
        if (!r || !r.img) return err(404, "사진이 없어요");
        return new Response(fromB64(r.img), {
          headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" },
        });
      }

      // ----- DM 채팅 -----
      case "GET messages": {
        const before = Number(q("before")) || 0;
        const limit = Math.min(Math.max(Number(q("limit")) || 40, 1), 100);
        const cols = "id, who, text, likes, reacts, img, w, h, t, reply_to, pinned, edited, kind, meta";
        const stmt = before
          ? DB.prepare(`SELECT ${cols} FROM messages WHERE id < ?1 ORDER BY id DESC LIMIT ?2`).bind(before, limit)
          : DB.prepare(`SELECT ${cols} FROM messages ORDER BY id DESC LIMIT ?1`).bind(limit);
        const { results } = await stmt.all();
        const msgs = (results || []).reverse().map((m) => {
          let reacts = {};
          try { reacts = m.reacts ? JSON.parse(m.reacts) : {}; } catch {}
          if (!m.reacts && m.likes) for (const w of m.likes) reacts[w] = "heart";
          let meta = null;
          try { meta = m.meta ? JSON.parse(m.meta) : null; } catch {}
          return { id: m.id, who: m.who, text: m.text, reacts, img: m.img, w: m.w, h: m.h, t: m.t, reply: m.reply_to || null, pinned: !!m.pinned, edited: !!m.edited, kind: m.kind || "text", meta };
        });
        const other = who === "a" ? "b" : "a";
        const pin = await DB.prepare("SELECT id, who, text, img FROM messages WHERE pinned = 1 ORDER BY id DESC LIMIT 1").first();
        return json({
          messages: msgs, read: { a: Number(st.read_a) || 0, b: Number(st.read_b) || 0 },
          readT: { a: Number(st.read_t_a) || 0, b: Number(st.read_t_b) || 0 },
          seen: Number(st["seen_" + other]) || 0,
          typing: Number(st["typing_" + other]) || 0, pin: pin || null, now: Date.now(),
        });
      }
      case "POST messages": {
        const b = await body(request);
        if (id && p2 === "pin") {
          const r = await DB.prepare("SELECT pinned FROM messages WHERE id = ?1").bind(id).first();
          if (!r) return err(404, "메시지가 없어요");
          const on = r.pinned ? 0 : 1;
          if (on) await DB.prepare("UPDATE messages SET pinned = 0 WHERE pinned = 1").run();
          await DB.prepare("UPDATE messages SET pinned = ?1 WHERE id = ?2").bind(on, id).run();
          return json({ ok: true, pinned: !!on });
        }
        if (id && p2 === "edit") {
          const r = await DB.prepare("SELECT who, t, img FROM messages WHERE id = ?1").bind(id).first();
          if (!r || r.who !== who) return err(403, "내 메시지만 고칠 수 있어요");
          if (Date.now() - r.t > 15 * 60000) return err(400, "보낸 지 15분이 지나서 고칠 수 없어요");
          const nt = str(b.text, 2000);
          if (!nt) return err(400, "내용을 입력하세요");
          await DB.prepare("UPDATE messages SET text = ?1, edited = 1 WHERE id = ?2").bind(nt, id).run();
          return json(OK);
        }
        if (id && p2 === "react") {
          const r = await DB.prepare("SELECT likes, reacts FROM messages WHERE id = ?1").bind(id).first();
          if (!r) return err(404, "메시지가 없어요");
          let reacts = {};
          try { reacts = r.reacts ? JSON.parse(r.reacts) : {}; } catch {}
          if (!r.reacts && r.likes) for (const w of r.likes) reacts[w] = "heart";
          const want = REACTS.includes(b.r) ? b.r : null;
          if (!want || reacts[who] === want) delete reacts[who]; else reacts[who] = want;
          await DB.prepare("UPDATE messages SET reacts = ?1, likes = '' WHERE id = ?2").bind(JSON.stringify(reacts), id).run();
          return json({ ok: true, reacts });
        }
        const text = str(b.text, 2000);
        let imgId = null, w = null, h = null;
        if (b.img && typeof b.img.data === "string" && typeof b.img.thumb === "string") {
          if (b.img.data.length > 1500000 || b.img.thumb.length > 300000) return err(413, "사진이 너무 커요");
          w = Number(b.img.w) || null; h = Number(b.img.h) || null;
          const ir = await DB.prepare("INSERT INTO chat_imgs (w, h, thumb, data, t) VALUES (?1, ?2, ?3, ?4, ?5)").bind(w, h, b.img.thumb, b.img.data, Date.now()).run();
          imgId = ir.meta?.last_row_id || null;
        }
        const kind = ["heart", "loc", "event"].includes(b.kind) ? b.kind : "text";
        let meta = null;
        if (kind === "loc") {
          const la = Number(b.lat), lo = Number(b.lon);
          if (!Number.isFinite(la) || !Number.isFinite(lo)) return err(400, "위치가 없어요");
          meta = JSON.stringify({ lat: la, lon: lo, name: str(b.name, 40) || undefined });
        }
        if (kind === "event") {
          const e = b.ev || {};
          if (!isDate(e.date) || !str(e.title, 100)) return err(400, "일정이 없어요");
          meta = JSON.stringify({ date: e.date, time: isTime(e.time) ? e.time : "", title: str(e.title, 100) });
        }
        if (!text && !imgId && kind === "text") return err(400, "메시지를 입력하세요");
        const replyTo = Number(b.reply) || null;
        const r = await DB.prepare("INSERT INTO messages (who, text, likes, reacts, img, w, h, t, reply_to, kind, meta) VALUES (?1, ?2, '', NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
          .bind(who, text, imgId, w, h, Date.now(), replyTo, kind, meta).run();
        const newId = r.meta?.last_row_id;
        if (newId) await setSettings(env, { ["read_" + who]: newId, ["typing_" + who]: 0 });
        const other = who === "a" ? "b" : "a";
        const name = who === "a" ? st.a_name : st.b_name;
        const pushBody = kind === "heart" ? "하트를 보냈어요" : kind === "loc" ? "위치를 보냈어요" : kind === "event" ? `일정: ${JSON.parse(meta).title}` : text || "사진을 보냈어요";
        const job = sendPush(env, st, setSettings, other, { title: name, body: pushBody, url: "/#chat", tag: "dm" });
        if (waitUntil) waitUntil(job); else await job;
        return json({ ok: true, id: newId });
      }
      case "DELETE messages": {
        const m = await DB.prepare("SELECT img FROM messages WHERE id = ?1 AND who = ?2").bind(id, who).first();
        if (m) {
          await DB.prepare("DELETE FROM messages WHERE id = ?1").bind(id).run();
          if (m.img) await DB.prepare("DELETE FROM chat_imgs WHERE id = ?1").bind(m.img).run();
        }
        return json(OK);
      }
      case "GET chatimg": {
        const col = q("thumb") ? "thumb" : "data";
        const r = await DB.prepare(`SELECT ${col} AS img FROM chat_imgs WHERE id = ?1`).bind(id).first();
        if (!r || !r.img) return err(404, "사진이 없어요");
        return new Response(fromB64(r.img), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
      }

      // ----- 알림(웹 푸시) -----
      case "GET push": {
        const v = await getVapid(env, st, setSettings);
        return json({ key: v.pub });
      }
      case "POST push": {
        const b = await body(request);
        if (p1 === "sub") {
          if (!b.endpoint || !b.keys || !b.keys.p256dh || !b.keys.auth) return err(400, "구독 정보가 없어요");
          if (!/^https:\/\//.test(b.endpoint)) return err(400, "잘못된 주소");
          await DB.prepare(`INSERT INTO push_subs (endpoint, who, p256dh, auth, t) VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(endpoint) DO UPDATE SET who = excluded.who, p256dh = excluded.p256dh, auth = excluded.auth, t = excluded.t`)
            .bind(String(b.endpoint), who, String(b.keys.p256dh), String(b.keys.auth), Date.now()).run();
          return json(OK);
        }
        if (p1 === "unsub") {
          await DB.prepare("DELETE FROM push_subs WHERE endpoint = ?1").bind(String(b.endpoint || "")).run();
          return json(OK);
        }
        if (p1 === "test") {
          const n = await sendPush(env, st, setSettings, who, { title: "알림 테스트", body: "알림이 잘 와요", url: "/", tag: "test" });
          return json({ ok: true, sent: n });
        }
        return err(404, "없는 주소예요");
      }
      case "GET msgsearch": {
        const kw = str(q("q"), 40);
        if (!kw) return json({ results: [] });
        const { results } = await DB.prepare("SELECT id, who, text, t FROM messages WHERE text LIKE ?1 ORDER BY id DESC LIMIT 50").bind(`%${kw.replace(/[%_]/g, "")}%`).all();
        return json({ results: results || [] });
      }
      // 이동 경로 + 장소 기록 (KST 날짜)
      case "GET history": {
        const w = q("w") === "b" ? "b" : "a";
        const d = isDate(q("date")) ? q("date") : todayKST();
        const start = Date.parse(d + "T00:00:00+09:00"), end = start + 864e5;
        const [pts, evs] = await DB.batch([
          DB.prepare("SELECT lat, lon, t, acc FROM loc_hist WHERE who = ?1 AND t >= ?2 AND t < ?3 ORDER BY t").bind(w, start, end),
          DB.prepare("SELECT place, inside, t FROM place_events WHERE who = ?1 AND t >= ?2 AND t < ?3 ORDER BY t").bind(w, start, end),
        ]);
        return json({ points: pts.results || [], events: evs.results || [] });
      }
      case "POST locreq": {
        const name = who === "a" ? st.a_name : st.b_name;
        const job = sendPush(env, st, setSettings, who === "a" ? "b" : "a", { title: "위치 알려줘", body: `${name}님이 지금 위치를 궁금해해요. 눌러서 알려주세요`, url: "/#map", tag: "locreq" });
        if (waitUntil) waitUntil(job); else await job;
        return json(OK);
      }
      case "POST typing":
        await setSettings(env, { ["typing_" + who]: Date.now() });
        return json(OK);
      // ----- 서로 알아두기 -----
      case "GET notes": {
        const { results } = await DB.prepare("SELECT id, about, cat, text, who, t FROM notes ORDER BY id").all();
        return json({ notes: results || [] });
      }
      case "POST notes": {
        const b = await body(request);
        const about = ["a", "b"].includes(b.about) ? b.about : null;
        const text = str(b.text, 100), cat = str(b.cat, 20);
        if (!about || !text) return err(400, "내용을 입력하세요");
        await DB.prepare("INSERT INTO notes (about, cat, text, who, t) VALUES (?1, ?2, ?3, ?4, ?5)").bind(about, cat || null, text, who, Date.now()).run();
        return json(OK);
      }
      case "DELETE notes":
        await DB.prepare("DELETE FROM notes WHERE id = ?1").bind(id).run();
        return json(OK);
      case "POST read": {
        const b = await body(request);
        const n = Number(b.id) || 0;
        if (n > (Number(st["read_" + who]) || 0)) await setSettings(env, { ["read_" + who]: n, ["read_t_" + who]: Date.now() });
        return json(OK);
      }

      // 탭 배지 등 가벼운 상태 확인
      case "GET pulse": {
        const last = await DB.prepare("SELECT id, who, substr(text, 1, 60) AS text, img FROM messages ORDER BY id DESC LIMIT 1").first();
        let place = null;
        try { place = st.last_place_ev ? JSON.parse(st.last_place_ev) : null; } catch {}
        let miss = null;
        try { miss = st.last_miss ? JSON.parse(st.last_miss) : null; } catch {}
        const moodT = { a: st.mood_a ? (JSON.parse(st.mood_a).t || 0) : 0, b: st.mood_b ? (JSON.parse(st.mood_b).t || 0) : 0 };
        return json({ miss, moodT, last: last || null, read: { a: Number(st.read_a) || 0, b: Number(st.read_b) || 0 }, touch: Number(st.last_touch) || 0, at: Number(st.last_touch_at) || 0, kind: st.last_touch_kind || "", now: Date.now(), place, together: st.together === "1" });
      }

      // ----- 부딪히기 / 가까이 대기 -----
      case "POST touch": {
        const b = await body(request);
        // 폰 붙이고 쓸기: 한 폰에서 화면 끝으로 나가고(sx) 다른 폰 끝으로 들어옴(se)
        if (b.kind === "swipe") {
          const now = Date.now();
          const edges = ["l", "r", "t", "b"];
          const dir = b.dir === "x" ? "sx" : b.dir === "e" ? "se" : null;
          const edge = edges.includes(b.edge) ? b.edge : null;
          let tc = Number(b.t);
          if (!dir || !edge) return err(400, "잘못된 요청");
          if (!Number.isFinite(tc) || Math.abs(tc - now) > 5000) tc = now;
          const other = who === "a" ? "b" : "a";
          const opp = { l: "r", r: "l", t: "b", b: "t" }[edge];
          const want = (dir === "sx" ? "se:" : "sx:") + opp;
          await DB.batch([
            DB.prepare("DELETE FROM touches WHERE t < ?1").bind(now - 60000),
            DB.prepare("INSERT INTO touches (who, kind, t) VALUES (?1, ?2, ?3)").bind(who, dir + ":" + edge, Math.round(tc)),
          ]);
          const r = await DB.prepare("SELECT COUNT(*) AS n FROM touches WHERE who = ?1 AND kind = ?2 AND t BETWEEN ?3 AND ?4")
            .bind(other, want, Math.round(tc) - 900, Math.round(tc) + 900).first();
          const last = Number(st.last_touch) || 0;
          if (r && r.n > 0 && now - last > 3000) {
            const at = now + 900;
            await setSettings(env, { last_touch: now, last_touch_at: at, last_touch_kind: "swipe" });
            return json({ match: true, touch: now, at, now, kind: "swipe" });
          }
          return json({ match: false, touch: last, at: Number(st.last_touch_at) || 0, now });
        }
        const kind = ["bump", "near", "listen", "tap"].includes(b.kind) ? b.kind : null;
        if (!kind) return err(400, "잘못된 요청");
        const now = Date.now();
        const other = who === "a" ? "b" : "a";
        await DB.batch([
          DB.prepare("DELETE FROM touches WHERE t < ?1").bind(now - 60000),
          DB.prepare("INSERT INTO touches (who, kind, t) VALUES (?1, ?2, ?3)").bind(who, kind, now),
        ]);
        if (kind === "listen") return json({ match: false, touch: Number(st.last_touch) || 0, now });
        // 두 폰이 서로의 소리를 2.5초 안에 다 들었을 때만 성공 (한쪽만 들으면 안 됨 그래서 멀리서 안 터짐)
        const r = await DB.prepare("SELECT COUNT(*) AS n FROM touches WHERE who = ?1 AND kind = ?3 AND t > ?2")
          .bind(other, now - 2500, kind).first();
        const last = Number(st.last_touch) || 0;
        if (r && r.n > 0 && now - last > 4000) {
          // 두 폰이 같은 시각에 재생하도록 1.2초 뒤를 재생 시각으로 정함
          const at = now + 1200;
          await setSettings(env, { last_touch: now, last_touch_at: at, last_touch_kind: kind });
          return json({ match: true, touch: now, at, now });
        }
        return json({ match: false, touch: last, at: Number(st.last_touch_at) || 0, now });
      }
      case "GET touch":
        return json({ touch: Number(st.last_touch) || 0, at: Number(st.last_touch_at) || 0, kind: st.last_touch_kind || "", now: Date.now() });

      // ----- 버킷리스트 -----
      case "GET bucket": {
        const { results } = await DB.prepare("SELECT id, title, done, done_date, who, t FROM bucket ORDER BY done, id DESC").all();
        return json({ bucket: results || [] });
      }
      case "POST bucket": {
        const b = await body(request);
        if (id) {
          const done = b.done ? 1 : 0;
          await DB.prepare("UPDATE bucket SET done = ?1, done_date = ?2 WHERE id = ?3")
            .bind(done, done ? (isDate(b.date) ? b.date : todayKST()) : null, id).run();
          return json(OK);
        }
        const title = str(b.title, 80);
        if (!title) return err(400, "내용을 입력하세요");
        await DB.prepare("INSERT INTO bucket (title, who, t) VALUES (?1, ?2, ?3)").bind(title, who, Date.now()).run();
        return json(OK);
      }
      case "DELETE bucket":
        await DB.prepare("DELETE FROM bucket WHERE id = ?1").bind(id).run();
        return json(OK);
    }
    return err(404, "없는 주소예요");
  } catch (e) {
    return err(500, e.message || "서버 오류");
  }
}


// 네이버 지역 검색 (한 번에 최대 5개)
async function naverLocal(query, id, secret) {
  try {
    const qs = `query=${encodeURIComponent(query)}&display=5&sort=random`;
    // 새 키(NAVER API HUB)로 먼저, 안 되면 예전 개발자센터 키 방식으로
    let r = await fetch(`https://naverapihub.apigw.ntruss.com/search/v1/local?${qs}`, { headers: { "X-NCP-APIGW-API-KEY-ID": id, "X-NCP-APIGW-API-KEY": secret } });
    if (r.status === 401 || r.status === 403) {
      const r2 = await fetch(`https://openapi.naver.com/v1/search/local.json?${qs}`, { headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret } });
      if (r2.ok) r = r2;
    }
    const d = await r.json().catch(() => ({}));
    const em = d.errorMessage || (d.error && (d.error.message || d.error.errorMessage));
    if (!r.ok) return { ok: false, msg: r.status === 401 || r.status === 403 ? "네이버 키가 맞지 않아요. 검색 API를 선택했는지, ID와 Secret을 바꿔 넣지 않았는지 확인해 주세요" : em ? `네이버: ${em}` : `네이버 검색 오류 (${r.status})`, items: [] };
    const strip = (x) => String(x || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const items = (d.items || []).map((it) => {
      let x = Number(it.mapx), y = Number(it.mapy);
      if (x > 1e8) { x /= 1e7; y /= 1e7; }
      return { name: strip(it.title), cat: strip(it.category), addr: strip(it.roadAddress || it.address), lat: y, lon: x, kind: strip(it.category), link: it.link || "" };
    }).filter((it) => it.lat > 30 && it.lat < 40 && it.lon > 120 && it.lon < 135);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, msg: "네이버에 연결하지 못했어요", items: [] };
  }
}

// 카카오 키워드 장소 검색 (한 번에 최대 15개)
async function kakaoLocal(query, key, lat, lon, sort) {
  try {
    let u = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=15`;
    if (lat != null) u += `&y=${lat}&x=${lon}`;
    if (sort === "distance") u += "&sort=distance&radius=8000";
    const r = await fetch(u, { headers: { Authorization: `KakaoAK ${key}` } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = String(d.message || d.msg || "");
      let msg = `카카오 검색 오류 (${r.status})`;
      if (r.status === 401) msg = "카카오 키가 맞지 않아요. REST API 키를 넣었는지 확인해 주세요";
      else if (/disabled|OPEN_MAP_AND_LOCAL|activ|사용/i.test(m) || r.status === 403) msg = "카카오맵이 꺼져 있어요. 앱 관리 화면의 [카카오맵] > [사용 설정]을 ON으로 바꿔 주세요";
      return { ok: false, msg, items: [] };
    }
    const items = (d.documents || []).map((p) => ({
      id: "k" + p.id, name: p.place_name, cat: (p.category_name || "").replace(/\s*>\s*/g, ">"),
      addr: p.road_address_name || p.address_name, lat: Number(p.y), lon: Number(p.x), kind: p.category_name || "", link: p.place_url || "",
    }));
    return { ok: true, items };
  } catch (e) {
    return { ok: false, msg: "카카오에 연결하지 못했어요", items: [] };
  }
}
