// 모든 /api/* 요청을 처리하는 라우터
import {
  json, err, body, isDate, isTime, str, todayKST,
  ensureSchema, getSettings, setSettings, saveLoc,
  randHex, hashPw, safeEq, makeToken, readToken, getCookie, cookieHeader,
  parseBasic, fromB64, checkPlaces, distM,
} from "../_lib.js";
import { getVapid, sendPush } from "../_push.js";
const VCHUNK = 1800000; // 영상 조각 크기 (D1 한 칸 2MB 제한 아래)
const VMAX = 100 * 1048576; // 영상 최대 100MB
const IG_V = "v26.0"; // 인스타 API 버전 (2026년 7월 최신)

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
        if (!L.a || !L.b) return;
        const stale = now - L.a.t > 4 * 60000 || now - L.b.t > 4 * 60000;
        const R = 6371000, rad = Math.PI / 180;
        const x = Math.sin(((L.b.lat - L.a.lat) * rad) / 2) ** 2 + Math.cos(L.a.lat * rad) * Math.cos(L.b.lat * rad) * Math.sin(((L.b.lon - L.a.lon) * rad) / 2) ** 2;
        const d = 2 * R * Math.asin(Math.sqrt(x));
        const accSum = (L.a.acc || 25) + (L.b.acc || 25);
        const was = st.together === "1";
        // 정말 붙어 있을 때만: 20m 안 (위치 오차가 크면 최대 35m까지만 봐줌), 둘 다 위치가 꽤 정확할 때
        const near = !stale && (L.a.acc || 25) <= 50 && (L.b.acc || 25) <= 50 && d <= 20 + Math.min(15, accSum * 0.2);
        // 한쪽 위치가 오래 안 들어와도 멀어졌거나 30분 넘게 소식 없으면 "함께" 끝
        const far = d > 80 || now - Math.min(L.a.t, L.b.t) > 30 * 60000;
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
      lat = Number(lat); lon = Number(lon); acc = Number(acc) || 30;
      // 진짜 가까울 때만: 위치가 정확(오차 35m 이내)하고 가게에서 40m 안쪽일 때, 제일 가까운 한 곳만
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || acc > 35) return;
      const d = 0.0006;
      const { results } = await env.DB.prepare("SELECT id, name, kind, wa, wb, lat, lon FROM eats WHERE status != 'been' AND lat BETWEEN ?1 AND ?2 AND lon BETWEEN ?3 AND ?4")
        .bind(lat - d, lat + d, lon - d * 1.3, lon + d * 1.3).all();
      const lim = Math.min(40, 25 + acc * 0.4);
      const near = (results || []).map((e) => ({ e, m: distM({ lat, lon }, e) })).filter((x) => x.m <= lim).sort((a, b) => a.m - b.m)[0];
      if (!near) return;
      const { e, m } = near;
      const st2 = await getSettings(env);
      const key = `eatnear_${who}_${e.id}`;
      if (Date.now() - (Number(st2[key]) || 0) < 24 * 3600e3) return;
      // 다른 가게 알림도 10분에 한 번까지만
      if (Date.now() - (Number(st2["eatnear_last_" + who]) || 0) < 10 * 60000) return;
      await setSettings(env, { [key]: Date.now(), ["eatnear_last_" + who]: Date.now() });
      const both = e.wa && e.wb;
      await sendPush(env, st2, setSettings, who, {
        title: both ? "둘 다 찜한 곳이 바로 앞이에요" : e.kind === "place" ? "가보고 싶던 곳이 바로 앞이에요" : "가보고 싶던 맛집이 바로 앞이에요",
        body: `${e.name}이(가) ${Math.max(10, Math.round(m / 10) * 10)}m 앞에 있어요`, url: "/#map", tag: "eatnear" + e.id,
      });
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

    // ---------- 인스타가 사진을 가져가는 임시 주소 (서명 + 15분 만료) ----------
    const igSig = async (pid, exp) => {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(st.secret || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`ig:${pid}:${exp}`)));
      return [...sig.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
    };
    if (p0 === "igimg" && m === "GET") {
      const mm = /^(\d+)-(\d+)-([0-9a-f]{24})\.jpg$/.exec(p1 || "");
      if (!isSetup || !mm) return err(404, "없음");
      const [, pid, exp, sig] = mm;
      if (Date.now() > Number(exp) || !safeEq(sig, await igSig(pid, exp))) return err(403, "만료됐어요");
      const r = await DB.prepare("SELECT data FROM photos WHERE id = ?1").bind(Number(pid)).first();
      if (!r || !r.data) return err(404, "사진이 없어요");
      return new Response(fromB64(r.data), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
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
        return json({ who, names: { a: st.a_name, b: st.b_name }, start: st.start, created: st.created, avatars, mood, nextMeet: st.next_meet || "", naver: !!(st.naver_id && st.naver_secret), kakao: !!st.kakao_key, kakaoJs: st.kakao_js || "", turn: !!((st.turn_id && st.turn_token) || st.relay_url || st.tu_user), phones: { a: st.phone_a || "", b: st.phone_b || "" }, ig: st.ig_token ? { user: st.ig_name || "", who: st.ig_who || "" } : null, make: st.make_hook ? { who: st.make_who || "" } : null });
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
        if (id && p2 === "edit") {
          const text = str(b.body, 3000);
          if (!text) return err(400, "편지 내용을 적어주세요");
          const r = await DB.prepare("UPDATE letters SET body = ?1, open_date = ?2 WHERE id = ?3 AND from_who = ?4").bind(text, isDate(b.open_date) ? b.open_date : todayKST(), id, who).run();
          if (!r.meta?.changes) return err(403, "내가 쓴 편지만 고칠 수 있어요");
          return json(OK);
        }
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
        if (id && p2 === "edit") {
          const title = str(b.title, 30);
          if (!title) return err(400, "쿠폰 이름을 적어주세요");
          const r = await DB.prepare("UPDATE coupons SET title = ?1 WHERE id = ?2 AND from_who = ?3 AND used = 0").bind(title, id, who).run();
          if (!r.meta?.changes) return err(403, "내가 준, 안 쓴 쿠폰만 고칠 수 있어요");
          return json(OK);
        }
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
        // 끊겼다가 나중에 보낸 위치는 원래 찍힌 시각으로 (3일 이내)
        const bt = Number(b.t), tt = Number.isFinite(bt) && bt < Date.now() + 60000 && bt > Date.now() - 3 * 86400000 ? bt : Date.now();
        await saveLoc(DB, who, { ...b, src: "web", t: tt });
        if (Date.now() - tt > 5 * 60000) return json(OK);
        await later(placeNotify(who, b.lat, b.lon, b.acc, tt).then(togetherCheck).then(() => eatNearby(who, b.lat, b.lon, b.acc)).catch(() => {}));
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
      // ----- 인스타 자동 게시 ----- (API 버전은 IG_V 한 곳에서만 바꾸면 됨)
      case "POST igkey": {
        const b = await body(request);
        const tok = str(b.token, 600);
        if (!tok) { await setSettings(env, { ig_token: "", ig_uid: "", ig_name: "", ig_who: "", ig_ref: "" }); return json(OK); }
        const r = await fetch(`https://graph.instagram.com/${IG_V}/me?fields=user_id,username&access_token=${encodeURIComponent(tok)}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.user_id) return err(400, "토큰이 올바르지 않아요" + (d.error && d.error.message ? ` (${d.error.message})` : ""));
        await setSettings(env, { ig_token: tok, ig_uid: String(d.user_id), ig_name: d.username || "", ig_who: who, ig_ref: Date.now() });
        return json({ ok: true, user: d.username || "" });
      }
      case "POST makehook": {
        const b = await body(request);
        const u = str(b.url, 300);
        if (!u) { await setSettings(env, { make_hook: "", make_who: "" }); return json(OK); }
        if (!/^https:\/\/hook\.[a-z0-9.-]+\.make\.com\/[A-Za-z0-9_-]+$/.test(u)) return err(400, "Make 웹훅 주소가 아니에요 (https://hook....make.com/... 형식)");
        // Make가 받을 데이터 모양을 알 수 있게 예시 한 번 보냄 (시나리오가 꺼져 있으면 게시 안 됨)
        const exp = Date.now() + 30 * 60000;
        const sample = { test: true, caption: "우주 연결 테스트", count: 2, image_url: `${url.origin}/icon-512.png`, images: [{ url: `${url.origin}/icon-512.png` }, { url: `${url.origin}/icon-512.png` }], expires: exp };
        const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sample) }).catch(() => null);
        if (!r || !r.ok) return err(400, "웹훅에 보내지 못했어요. 주소를 다시 확인해주세요" + (r ? ` (${r.status})` : ""));
        await setSettings(env, { make_hook: u, make_who: who });
        return json(OK);
      }
      case "POST igpost": {
        const b = await body(request);
        if (!st.ig_token && !st.make_hook) return err(400, "인스타가 연결되어 있지 않아요");
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter((x) => x > 0).slice(0, 10);
        if (!ids.length) return err(400, "올릴 사진을 골라주세요");
        if (!st.ig_token && st.make_hook) {
          // Make 경유: 사진 주소(30분 유효)와 캡션을 웹훅으로 보내면 Make가 인스타에 게시
          const exp = Date.now() + 30 * 60000;
          const images = [];
          for (const pid of ids) images.push({ url: `${url.origin}/api/igimg/${pid}-${exp}-${await igSig(pid, exp)}.jpg` });
          const payload = { test: false, caption: str(b.caption, 2000) || "", count: images.length, image_url: images[0].url, images, expires: exp };
          const r = await fetch(st.make_hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
          if (!r || !r.ok) return err(400, "Make로 보내지 못했어요" + (r ? ` (${r.status})` : ""));
          return json({ ok: true, via: "make" });
        }
        let tok = st.ig_token;
        // 장기 토큰은 60일짜리라 일주일 넘으면 새로 고침
        if (Date.now() - (Number(st.ig_ref) || 0) > 7 * 86400000) {
          try {
            const rr = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(tok)}`);
            const dd = await rr.json();
            if (dd.access_token) { tok = dd.access_token; await setSettings(env, { ig_token: tok, ig_ref: Date.now() }); }
          } catch {}
        }
        const G = `https://graph.instagram.com/${IG_V}`, uid = st.ig_uid || "me";
        const call = async (path, params) => {
          const u = new URLSearchParams({ ...params, access_token: tok });
          const r = await fetch(`${G}/${path}`, { method: "POST", body: u });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || d.error) throw new Error((d.error && (d.error.error_user_msg || d.error.message)) || "인스타 오류 " + r.status);
          return d;
        };
        const ready = async (cid) => {
          for (let k = 0; k < 15; k++) {
            const r = await fetch(`${G}/${cid}?fields=status_code&access_token=${encodeURIComponent(tok)}`);
            const d = await r.json().catch(() => ({}));
            if (d.status_code === "FINISHED") return;
            if (d.status_code === "ERROR" || d.status_code === "EXPIRED") throw new Error("인스타가 사진을 처리하지 못했어요");
            await new Promise((res) => setTimeout(res, 1500));
          }
        };
        const origin = url.origin;
        const exp = Date.now() + 15 * 60000;
        const imgUrl = async (pid) => `${origin}/api/igimg/${pid}-${exp}-${await igSig(pid, exp)}.jpg`;
        const caption = str(b.caption, 2000) || "";
        try {
          let cid;
          if (ids.length === 1) {
            cid = (await call(`${uid}/media`, { image_url: await imgUrl(ids[0]), caption })).id;
          } else {
            const kids = [];
            for (const pid of ids) kids.push((await call(`${uid}/media`, { image_url: await imgUrl(pid), is_carousel_item: "true" })).id);
            for (const k of kids) await ready(k);
            cid = (await call(`${uid}/media`, { media_type: "CAROUSEL", children: kids.join(","), caption })).id;
          }
          await ready(cid);
          const pub = await call(`${uid}/media_publish`, { creation_id: cid });
          let link = "";
          try { const r = await fetch(`${G}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(tok)}`); link = (await r.json()).permalink || ""; } catch {}
          return json({ ok: true, id: pub.id, link });
        } catch (e) { return err(400, e.message); }
      }
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
          DB.prepare("SELECT id, date, caption, who, w, h, t, kind, dur, vready FROM photos WHERE date BETWEEN ?1 AND ?2 ORDER BY date, id").bind(from, to),
        ]);
        return json({ events: ev.results || [], photos: ph.results || [] });
      }

      case "POST events": {
        const b = await body(request);
        if (id && p2 === "edit") {
          const title = str(b.title, 60);
          if (!isDate(b.date) || !title) return err(400, "날짜와 내용을 입력하세요");
          await DB.prepare("UPDATE events SET date = ?1, time = ?2, title = ?3, memo = ?4 WHERE id = ?5").bind(b.date, isTime(b.time) ? b.time : null, title, str(b.memo, 300) || null, id).run();
          return json(OK);
        }
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
        if (id && p2 === "edit") {
          const title = str(b.title, 30);
          if (!isDate(b.date) || !title) return err(400, "날짜와 이름을 입력하세요");
          await DB.prepare("UPDATE anniv SET title = ?1, date = ?2, yearly = ?3 WHERE id = ?4").bind(title, b.date, b.yearly ? 1 : 0, id).run();
          return json(OK);
        }
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
        const { results } = await DB.prepare("SELECT id, date, caption, who, w, h, t, kind, dur, vready FROM photos ORDER BY date DESC, id DESC LIMIT ?1").bind(n).all();
        return json({ photos: results || [] });
      }
      case "GET album": {
        const offset = Math.max(0, Number(q("offset")) || 0);
        const { results } = await DB.prepare("SELECT id, date, caption, who, w, h, t, kind, dur, vready FROM photos ORDER BY date DESC, id DESC LIMIT 60 OFFSET ?1").bind(offset).all();
        const c = await DB.prepare("SELECT COUNT(*) AS n FROM photos").first();
        return json({ photos: results || [], total: c ? c.n : 0 });
      }
      case "POST photos": {
        const b = await body(request);
        if (id && p2 === "edit") {
          if (!isDate(b.date)) return err(400, "날짜가 올바르지 않아요");
          await DB.prepare("UPDATE photos SET caption = ?1, date = ?2 WHERE id = ?3").bind(str(b.caption, 100) || null, b.date, id).run();
          return json(OK);
        }
        if (!isDate(b.date)) return err(400, "날짜가 올바르지 않아요");
        const data = typeof b.data === "string" ? b.data : "";
        const thumb = typeof b.thumb === "string" ? b.thumb : "";
        if (!data || !thumb) return err(400, "사진이 없어요");
        if (data.length > 1500000 || thumb.length > 200000) return err(413, "사진이 너무 커요");
        if (!/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 200))) return err(400, "사진 형식이 올바르지 않아요");
        if (b.kind === "video") {
          const size = Number(b.size) || 0;
          if (!(size > 0) || size > VMAX) return err(413, `영상은 ${VMAX / 1048576}MB까지 올릴 수 있어요`);
          const mime = /^video\/[a-z0-9.+-]+$/i.test(b.mime || "") ? b.mime : "video/mp4";
          const vn = Math.ceil(size / VCHUNK);
          const r = await DB.prepare("INSERT INTO photos (date, caption, who, w, h, t, thumb, data, kind, dur, vsize, vmime, vn, vready) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'video', ?9, ?10, ?11, ?12, 0)")
            .bind(b.date, str(b.caption, 100) || null, who, Number(b.w) || null, Number(b.h) || null, Date.now(), thumb, data, Number(b.dur) || null, size, mime, vn).run();
          return json({ ok: true, id: r.meta?.last_row_id, chunk: VCHUNK, n: vn });
        }
        const r = await DB.prepare("INSERT INTO photos (date, caption, who, w, h, t, thumb, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
          .bind(b.date, str(b.caption, 100) || null, who, Number(b.w) || null, Number(b.h) || null, Date.now(), thumb, data).run();
        return json({ ok: true, id: r.meta?.last_row_id });
      }
      case "DELETE photos":
        await DB.prepare("DELETE FROM photos WHERE id = ?1").bind(id).run();
        await DB.prepare("DELETE FROM vchunks WHERE vid = ?1").bind(id).run();
        return json(OK);
      // 영상 조각 올리기: PUT /api/vchunk/:id/:idx (본문은 그대로 바이너리)
      case "PUT vchunk": {
        const idx = Number(p2);
        const v = await DB.prepare("SELECT vn, vsize, vready FROM photos WHERE id = ?1 AND kind = 'video'").bind(id).first();
        if (!v || !(idx >= 0) || idx >= v.vn) return err(400, "잘못된 조각이에요");
        const buf = await request.arrayBuffer();
        const want = idx === v.vn - 1 ? v.vsize - idx * VCHUNK : VCHUNK;
        if (buf.byteLength !== want) return err(400, "조각 크기가 맞지 않아요");
        await DB.prepare("INSERT INTO vchunks (vid, idx, data) VALUES (?1, ?2, ?3) ON CONFLICT(vid, idx) DO UPDATE SET data = ?3").bind(id, idx, buf).run();
        if (idx === v.vn - 1) {
          const c = await DB.prepare("SELECT COUNT(*) AS n FROM vchunks WHERE vid = ?1").bind(id).first();
          if (c && c.n === v.vn) await DB.prepare("UPDATE photos SET vready = 1 WHERE id = ?1").bind(id).run();
        }
        return json(OK);
      }
      // 영상 보기 (아이폰 재생에 필요한 Range 요청 지원)
      case "GET video": {
        const v = await DB.prepare("SELECT vn, vsize, vmime, vready FROM photos WHERE id = ?1 AND kind = 'video'").bind(id).first();
        if (!v || !v.vready) return err(404, "영상이 아직 없어요");
        const size = v.vsize;
        let start = 0, end = size - 1, partial = false;
        const rg = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") || "");
        if (rg) {
          partial = true;
          if (rg[1] === "") { start = Math.max(0, size - Number(rg[2])); }
          else { start = Number(rg[1]); if (rg[2] !== "") end = Math.min(size - 1, Number(rg[2])); }
          // 한 번에 너무 많이 읽지 않게 최대 4조각
          end = Math.min(end, start + VCHUNK * 4 - 1);
          if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
        } else end = Math.min(end, VCHUNK * 4 - 1), partial = size > VCHUNK * 4;
        const a = Math.floor(start / VCHUNK), z = Math.floor(end / VCHUNK);
        const { results } = await DB.prepare("SELECT idx, data FROM vchunks WHERE vid = ?1 AND idx BETWEEN ?2 AND ?3 ORDER BY idx").bind(id, a, z).all();
        const out = new Uint8Array(end - start + 1);
        for (const r of results || []) {
          const bytes = new Uint8Array(r.data);
          const cs = r.idx * VCHUNK;
          const from = Math.max(start, cs), to = Math.min(end, cs + bytes.length - 1);
          if (to >= from) out.set(bytes.subarray(from - cs, to - cs + 1), from - start);
        }
        const h = { "content-type": v.vmime || "video/mp4", "accept-ranges": "bytes", "content-length": String(out.length), "cache-control": "private, max-age=31536000, immutable" };
        if (partial) h["content-range"] = `bytes ${start}-${end}/${size}`;
        return new Response(out, { status: partial ? 206 : 200, headers: h });
      }
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
          meta = JSON.stringify({ lat: la, lon: lo, name: str(b.name, 40) || undefined, eat: Number(b.eat) > 0 ? Number(b.eat) : undefined, cat: str(b.cat, 10) || undefined, ek: b.ek === "place" ? "place" : b.eat ? "food" : undefined });
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
      // 좌표 → 실제 주소 (카카오 키가 있으면 카카오, 없으면 OpenStreetMap)
      case "GET revgeo": {
        const la = Number(q("lat")), lo = Number(q("lon"));
        if (!Number.isFinite(la) || !Number.isFinite(lo)) return err(400, "좌표가 없어요");
        if (st.kakao_key) {
          try {
            const r = await fetch(`https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lo}&y=${la}`, { headers: { Authorization: `KakaoAK ${st.kakao_key}` } });
            const d = await r.json();
            const doc = (d.documents || [])[0];
            if (doc) {
              const road = doc.road_address, jibun = doc.address;
              return json({ addr: road ? road.address_name : jibun ? jibun.address_name : "", building: road && road.building_name ? road.building_name : "", jibun: jibun ? jibun.address_name : "" });
            }
          } catch {}
        }
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ko&zoom=18&lat=${la}&lon=${lo}`, { headers: { "User-Agent": "wooju-couple/1.0 (private couple site)" } });
          const d = await r.json(), a = d.address || {};
          const parts = [a.city || a.county || a.state, a.borough || a.city_district, a.quarter || a.suburb, a.road ? `${a.road}${a.house_number ? " " + a.house_number : ""}` : a.neighbourhood].filter(Boolean);
          return json({ addr: parts.join(" "), building: d.name || a.building || a.amenity || "", jibun: "" });
        } catch { return json({ addr: "", building: "" }); }
      }
      // 통화 중계 서버(TURN) 정보: Cloudflare TURN 키가 있으면 짧게 쓰는 비밀번호를 만들어 줌
      case "GET turn": {
        const ice = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
        // 직접 넣은 중계 서버 (ExpressTURN 등, 아이디·비밀번호 방식)
        if (st.tu_host && st.tu_user && st.tu_pass) {
          const h = st.tu_host;
          const port = st.tu_port || "3478";
          const urls = [`turn:${h}:${port}?transport=udp`, `turn:${h}:${port}?transport=tcp`];
          if (!/^free\./.test(h)) urls.push(`turns:${h}:443?transport=tcp`);
          ice.push({ urls, username: st.tu_user, credential: st.tu_pass });
          return json({ ice, turn: true });
        }
        // Open Relay (Metered) 무료 중계 서버
        if (st.relay_url) {
          try {
            const r = await fetch(st.relay_url);
            const list = await r.json();
            if (Array.isArray(list) && list.length) return json({ ice: ice.concat(list), turn: true });
          } catch {}
        }
        if (st.turn_id && st.turn_token) {
          try {
            const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${st.turn_id}/credentials/generate-ice-servers`, {
              method: "POST", headers: { Authorization: `Bearer ${st.turn_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: 86400 }),
            });
            const d = await r.json();
            const list = d.iceServers ? (Array.isArray(d.iceServers) ? d.iceServers : [d.iceServers]) : [];
            // 브라우저에서 막히는 53번 포트 주소는 뺌
            for (const sv of list) { const u = (Array.isArray(sv.urls) ? sv.urls : [sv.urls]).filter((x) => !/:53\b/.test(x)); if (u.length) ice.push({ ...sv, urls: u }); }
            return json({ ice, turn: list.length > 0 });
          } catch {}
        }
        return json({ ice, turn: false });
      }
      case "POST phone": {
        const b = await body(request);
        const v = str(b.phone, 60).replace(/[^0-9+@.a-zA-Z_-]/g, "");
        await setSettings(env, { ["phone_" + who]: v });
        return json(OK);
      }
      case "POST turnuser": {
        const b = await body(request);
        const raw = str(b.host, 120).replace(/^turns?:/, "").trim();
        const host = raw.replace(/:\d+.*$/, "");
        const pm = raw.match(/:(\d{2,5})/);
        const user = str(b.user, 200), pass = str(b.pass, 200);
        if (!user && !pass) { await setSettings(env, { tu_host: "", tu_user: "", tu_pass: "" }); return json(OK); }
        if (!host || !user || !pass) return err(400, "서버 주소, 아이디, 비밀번호를 모두 넣어주세요");
        await setSettings(env, { tu_host: host, tu_port: pm ? pm[1] : "3478", tu_user: user, tu_pass: pass });
        return json(OK);
      }
      case "POST relaykey": {
        const b = await body(request);
        const v = str(b.key, 300);
        if (!v) { await setSettings(env, { relay_url: "" }); return json(OK); }
        // 주소 전체를 붙여넣어도, API 키만 붙여넣어도 되게
        const url = /^https:\/\/[a-z0-9.-]+\.metered\.(live|ca)\//i.test(v) ? v : `https://openrelayproject.metered.ca/api/v1/turn/credentials?apiKey=${encodeURIComponent(v)}`;
        try {
          const r = await fetch(url);
          const list = await r.json();
          if (!Array.isArray(list) || !list.length) return err(400, "키가 맞지 않아요. 대시보드의 API Key 또는 credentials 주소를 확인해 주세요");
        } catch { return err(400, "키를 확인하지 못했어요. 주소나 키를 다시 확인해 주세요"); }
        await setSettings(env, { relay_url: url });
        return json(OK);
      }
      case "POST turnkey": {
        const b = await body(request);
        const idk = str(b.id, 100), tok = str(b.token, 200);
        if (!idk && !tok) { await setSettings(env, { turn_id: "", turn_token: "" }); return json(OK); }
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${idk}/credentials/generate-ice-servers`, {
          method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: 600 }),
        }).catch(() => null);
        if (!r || !r.ok) return err(400, "키가 맞지 않아요. Turn Token ID와 API Token을 확인해 주세요");
        await setSettings(env, { turn_id: idk, turn_token: tok });
        return json(OK);
      }
      // ----- 전화·영상통화 (WebRTC 신호 주고받기) -----
      case "GET call": {
        const now = Date.now();
        // 40초 넘게 안 받은 전화는 부재중으로
        await DB.prepare("UPDATE calls SET state = 'missed', t_end = ?1 WHERE state = 'ringing' AND t < ?2").bind(now, now - 60000).run();
        if (id) {
          const c = await DB.prepare("SELECT id, caller, kind, state, answer, t, t_ans FROM calls WHERE id = ?1").bind(id).first();
          return c ? json({ call: c }) : err(404, "통화가 없어요");
        }
        const c = await DB.prepare("SELECT id, caller, kind, state, offer, t FROM calls WHERE state = 'ringing' AND caller != ?1 ORDER BY id DESC LIMIT 1").bind(who).first();
        return json({ call: c || null });
      }
      case "POST call": {
        const b = await body(request);
        const now = Date.now();
        if (!id) {
          const kind = b.kind === "video" ? "video" : "voice";
          if (typeof b.offer !== "string" || b.offer.length > 60000) return err(400, "연결 정보가 없어요");
          await DB.prepare("UPDATE calls SET state = 'ended', t_end = ?1 WHERE state IN ('ringing', 'active')").bind(now).run();
          const r = await DB.prepare("INSERT INTO calls (caller, kind, state, offer, t) VALUES (?1, ?2, 'ringing', ?3, ?4)").bind(who, kind, b.offer, now).run();
          const name = who === "a" ? st.a_name : st.b_name;
          const job = sendPush(env, st, setSettings, who === "a" ? "b" : "a", { title: `${name}님의 ${kind === "video" ? "영상통화" : "전화"}`, body: "눌러서 받기", url: "/#call", tag: "call" });
          if (waitUntil) waitUntil(job); else await job;
          return json({ ok: true, id: r.meta.last_row_id });
        }
        const c = await DB.prepare("SELECT caller, state, kind, t, t_ans FROM calls WHERE id = ?1").bind(id).first();
        if (!c) return err(404, "통화가 없어요");
        if (p2 === "answer") {
          if (c.state !== "ringing") return err(409, "이미 끝난 전화예요");
          if (typeof b.answer !== "string" || b.answer.length > 60000) return err(400, "연결 정보가 없어요");
          await DB.prepare("UPDATE calls SET state = 'active', answer = ?1, t_ans = ?2 WHERE id = ?3").bind(b.answer, now, id).run();
          return json(OK);
        }
        if (p2 === "end") {
          if (c.state === "ringing" || c.state === "active") {
            const st2 = c.state === "ringing" ? (c.caller === who ? "canceled" : "declined") : "ended";
            await DB.prepare("UPDATE calls SET state = ?1, t_end = ?2 WHERE id = ?3").bind(st2, now, id).run();
            // 통화 기록을 디엠에 남김
            const dur = c.t_ans ? Math.round((now - c.t_ans) / 1000) : 0;
            const label = st2 === "ended" ? `${c.kind === "video" ? "영상통화" : "음성통화"} ${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")}` : `${c.kind === "video" ? "영상통화" : "전화"} ${st2 === "declined" ? "거절" : "취소"}`;
            await DB.prepare("INSERT INTO messages (who, text, likes, reacts, t, kind, meta) VALUES (?1, ?2, '', NULL, ?3, 'call', ?4)").bind(c.caller, label, now, JSON.stringify({ k: c.kind, s: st2, d: dur })).run();
          }
          return json(OK);
        }
        return err(404, "없는 기능");
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
        if (id && p2 === "edit") {
          const text = str(b.text, 100);
          if (!text) return err(400, "내용을 입력하세요");
          await DB.prepare("UPDATE notes SET text = ?1, cat = ?2 WHERE id = ?3").bind(text, str(b.cat, 20) || null, id).run();
          return json(OK);
        }
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
        const ring = await DB.prepare("SELECT id, caller, kind, t FROM calls WHERE state = 'ringing' AND caller != ?1 AND t > ?2 ORDER BY id DESC LIMIT 1").bind(who, Date.now() - 60000).first();
        const last = await DB.prepare("SELECT id, who, substr(text, 1, 60) AS text, img FROM messages ORDER BY id DESC LIMIT 1").first();
        let place = null;
        try { place = st.last_place_ev ? JSON.parse(st.last_place_ev) : null; } catch {}
        let miss = null;
        try { miss = st.last_miss ? JSON.parse(st.last_miss) : null; } catch {}
        const moodT = { a: st.mood_a ? (JSON.parse(st.mood_a).t || 0) : 0, b: st.mood_b ? (JSON.parse(st.mood_b).t || 0) : 0 };
        return json({ miss, moodT, last: last || null, read: { a: Number(st.read_a) || 0, b: Number(st.read_b) || 0 }, touch: Number(st.last_touch) || 0, at: Number(st.last_touch_at) || 0, kind: st.last_touch_kind || "", now: Date.now(), place, together: st.together === "1", ring: ring || null });
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
        if (id && p2 === "edit") {
          const title = str(b.title, 80);
          if (!title) return err(400, "내용을 입력하세요");
          await DB.prepare("UPDATE bucket SET title = ?1, done_date = CASE WHEN done = 1 AND ?2 IS NOT NULL THEN ?2 ELSE done_date END WHERE id = ?3").bind(title, isDate(b.date) ? b.date : null, id).run();
          return json(OK);
        }
        if (id) {
          const done = b.done ? 1 : 0;
          await DB.prepare("UPDATE bucket SET done = ?1, done_date = ?2 WHERE id = ?3")
            .bind(done, done ? (isDate(b.date) ? b.date : todayKST()) : null, id).run();
          return json(OK);
        }
        // 여러 개 한 번에 (이미 있는 건 건너뜀)
        if (Array.isArray(b.items)) {
          const { results } = await DB.prepare("SELECT title FROM bucket").all();
          const have = new Set((results || []).map((r) => r.title.trim()));
          const add = [];
          for (const it of b.items.slice(0, 100)) {
            const tt = str(it && it.title, 80);
            if (!tt || have.has(tt)) continue;
            have.add(tt);
            add.push(DB.prepare("INSERT INTO bucket (title, who, t, done, done_date) VALUES (?1, ?2, ?3, ?4, ?5)").bind(tt, who, Date.now() + 1000 - add.length, it.done ? 1 : 0, it.done ? todayKST() : null));
          }
          if (add.length) await DB.batch(add);
          return json({ ok: true, added: add.length });
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
