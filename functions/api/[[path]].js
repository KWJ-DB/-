// 모든 /api/* 요청을 처리하는 라우터
import {
  json, err, body, isDate, isTime, str, todayKST,
  ensureSchema, getSettings, setSettings, saveLoc,
  randHex, hashPw, safeEq, makeToken, readToken, getCookie, cookieHeader,
  parseBasic, fromB64, checkPlaces,
} from "../_lib.js";
import { getVapid, sendPush } from "../_push.js";

const REACTS = ["heart", "laugh", "wow", "sad", "fire", "like"];
const CHOICE_SLOTS = ["c", "c1", "c2", "c3"];

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
    const placeNotify = async (who, lat, lon, acc) => {
      try {
        const changes = await checkPlaces(DB, who, Number(lat), Number(lon), acc);
        if (!changes.length) return;
        const name = who === "a" ? st.a_name : st.b_name;
        const other = who === "a" ? "b" : "a";
        const evs = changes.map((c) => ({ who, place: c.place.name, inside: c.inside, t: Date.now() }));
        await setSettings(env, { last_place_ev: JSON.stringify(evs[evs.length - 1]) });
        for (const c of changes) {
          await sendPush(env, st, setSettings, other, {
            title: c.inside ? `${name}님 도착` : `${name}님 출발`,
            body: c.inside ? `${c.place.name}에 도착했어요` : `${c.place.name}에서 떠났어요`,
            url: "/#map", tag: "place-" + c.place.id,
          });
        }
      } catch {}
    };
    const later = (job) => { if (waitUntil) waitUntil(job); else return job; };

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
          await saveLoc(DB, who, { lat: b.lat, lon: b.lon, acc: b.acc, batt: b.batt, t: b.tst ? b.tst * 1000 : Date.now(), src: "app" });
          await later(placeNotify(who, b.lat, b.lon, b.acc));
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

    // ---------- 여기부터 로그인 필요 ----------
    if (!isSetup) return err(401, "처음 설정이 필요해요");
    const who = await readToken(st.secret, getCookie(request, "cp"));
    if (!who) return err(401, "로그인이 필요해요");
    const id = p1 ? Number(p1) : null;
    const route = `${m} ${p0}`;

    switch (route) {
      case "GET me":
        return json({ who, names: { a: st.a_name, b: st.b_name }, start: st.start, created: st.created });

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
        const { results } = await DB.prepare("SELECT who, lat, lon, acc, batt, src, t FROM couple_locs").all();
        const locs = {};
        for (const r of results || []) locs[r.who] = r;
        return json({ now: Date.now(), locs });
      }
      case "POST loc": {
        const b = await body(request);
        await saveLoc(DB, who, { ...b, src: "web", t: Date.now() });
        await later(placeNotify(who, b.lat, b.lon, b.acc));
        return json(OK);
      }
      case "DELETE loc":
        await DB.prepare("DELETE FROM couple_locs WHERE who = ?1").bind(who).run();
        return json(OK);

      // ----- 장소 (도착/출발 알림) -----
      case "GET places": {
        const { results } = await DB.prepare("SELECT id, name, lat, lon, radius FROM places ORDER BY id").all();
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
        await DB.prepare("INSERT INTO places (name, lat, lon, radius, who, t) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(name, lat, lon, radius, who, Date.now()).run();
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
        if (b.slot !== "t" && !CHOICE_SLOTS.includes(b.slot)) return err(400, "질문 종류가 올바르지 않아요");
        const answer = str(b.answer, 1000);
        if (!answer) return err(400, "답을 입력하세요");
        if (CHOICE_SLOTS.includes(b.slot)) {
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
        const cols = "id, who, text, likes, reacts, img, w, h, t";
        const stmt = before
          ? DB.prepare(`SELECT ${cols} FROM messages WHERE id < ?1 ORDER BY id DESC LIMIT ?2`).bind(before, limit)
          : DB.prepare(`SELECT ${cols} FROM messages ORDER BY id DESC LIMIT ?1`).bind(limit);
        const { results } = await stmt.all();
        const msgs = (results || []).reverse().map((m) => {
          let reacts = {};
          try { reacts = m.reacts ? JSON.parse(m.reacts) : {}; } catch {}
          if (!m.reacts && m.likes) for (const w of m.likes) reacts[w] = "heart";
          return { id: m.id, who: m.who, text: m.text, reacts, img: m.img, w: m.w, h: m.h, t: m.t };
        });
        return json({ messages: msgs, read: { a: Number(st.read_a) || 0, b: Number(st.read_b) || 0 } });
      }
      case "POST messages": {
        const b = await body(request);
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
        if (!text && !imgId) return err(400, "메시지를 입력하세요");
        const r = await DB.prepare("INSERT INTO messages (who, text, likes, reacts, img, w, h, t) VALUES (?1, ?2, '', NULL, ?3, ?4, ?5, ?6)")
          .bind(who, text, imgId, w, h, Date.now()).run();
        const newId = r.meta?.last_row_id;
        if (newId) await setSettings(env, { ["read_" + who]: newId });
        const other = who === "a" ? "b" : "a";
        const name = who === "a" ? st.a_name : st.b_name;
        const job = sendPush(env, st, setSettings, other, { title: name, body: text || "사진을 보냈어요", url: "/#chat", tag: "dm" });
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
      case "POST read": {
        const b = await body(request);
        const n = Number(b.id) || 0;
        if (n > (Number(st["read_" + who]) || 0)) await setSettings(env, { ["read_" + who]: n });
        return json(OK);
      }

      // 탭 배지 등 가벼운 상태 확인
      case "GET pulse": {
        const last = await DB.prepare("SELECT id, who, substr(text, 1, 60) AS text, img FROM messages ORDER BY id DESC LIMIT 1").first();
        let place = null;
        try { place = st.last_place_ev ? JSON.parse(st.last_place_ev) : null; } catch {}
        return json({ last: last || null, read: { a: Number(st.read_a) || 0, b: Number(st.read_b) || 0 }, touch: Number(st.last_touch) || 0, place });
      }

      // ----- 부딪히기 / 가까이 대기 -----
      case "POST touch": {
        const b = await body(request);
        const kind = ["bump", "near", "listen"].includes(b.kind) ? b.kind : null;
        if (!kind) return err(400, "잘못된 요청");
        const now = Date.now();
        const other = who === "a" ? "b" : "a";
        await DB.batch([
          DB.prepare("DELETE FROM touches WHERE t < ?1").bind(now - 60000),
          DB.prepare("INSERT INTO touches (who, kind, t) VALUES (?1, ?2, ?3)").bind(who, kind, now),
        ]);
        if (kind === "listen") return json({ match: false, touch: Number(st.last_touch) || 0 });
        // 상대도 거의 동시에 부딪혔거나(2.5초), 내가 상대 소리를 들었고 상대가 대기 중이면(15초) 성공
        const r = await DB.prepare(
          `SELECT COUNT(*) AS n FROM touches WHERE who = ?1 AND (
             (kind IN ('bump','near') AND t > ?2) OR (?3 = 'near' AND kind = 'listen' AND t > ?4))`
        ).bind(other, now - 2500, kind, now - 15000).first();
        const last = Number(st.last_touch) || 0;
        if (r && r.n > 0 && now - last > 4000) {
          await setSettings(env, { last_touch: now });
          return json({ match: true, touch: now });
        }
        return json({ match: false, touch: last });
      }
      case "GET touch":
        return json({ touch: Number(st.last_touch) || 0, now: Date.now() });

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
