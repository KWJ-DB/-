(() => {
  "use strict";

  // ---------- 기본 도구 ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ic = (n, cls = "") => `<svg class="i ${cls}"><use href="#i-${n}"/></svg>`;
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const parts = (s) => { const [y, m, d] = s.split("-").map(Number); return [y, m - 1, d]; };
  const addDays = (s, n) => { const [y, m, d] = parts(s); return ymd(new Date(y, m, d + n)); };
  const addYears = (s, n) => { const [y, m, d] = parts(s); return ymd(new Date(y + n, m, d)); };
  const diff = (a, b) => Math.round((Date.UTC(...parts(b)) - Date.UTC(...parts(a))) / 864e5);
  const DOW = "일월화수목금토";
  const fmtDot = (s) => s.replaceAll("-", ".");
  const fmtK = (s) => { const [y, m, d] = parts(s); return `${m + 1}월 ${d}일 (${DOW[new Date(y, m, d).getDay()]})`; };
  const dlabel = (n) => (n === 0 ? "D-DAY" : n > 0 ? `D-${n}` : `D+${-n}`);
  const ago = (t, now = Date.now()) => {
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return "방금";
    if (s < 3600) return Math.floor(s / 60) + "분 전";
    if (s < 86400) return Math.floor(s / 3600) + "시간 전";
    return Math.floor(s / 86400) + "일 전";
  };
  const distM = (a, b) => {
    const R = 6371000, r = Math.PI / 180;
    const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`);

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const S = {
    who: null, names: { a: "", b: "" }, start: null, created: null,
    anniv: [], ans: {}, tab: "home", cal: null, calData: null,
    locs: {}, locNow: Date.now(), watchId: null, lastSent: null,
    editing: null, openArch: new Set(), pickWho: null, lbList: [], lbIdx: 0,
    chat: null, lastTouchSeen: 0,
  };
  const other = () => (S.who === "a" ? "b" : "a");
  const nm = (w) => S.names[w] || "";
  const ini = (w) => [...nm(w)][0] || "?";
  const av = (w, cls = "") => `<span class="av ${w} ${cls}">${esc(ini(w))}</span>`;
  const view = $("#view");

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2300);
  }

  async function api(path, { method = "GET", body } = {}) {
    const opt = { method, headers: {}, credentials: "same-origin" };
    if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
    const r = await fetch("/api/" + path, opt);
    let d = null;
    try { d = await r.json(); } catch {}
    if (!r.ok) {
      const e = new Error((d && d.error) || "오류 " + r.status);
      e.status = r.status;
      if (r.status === 401 && !/^(login|setup|state|me)/.test(path)) showLogin();
      throw e;
    }
    return d;
  }

  // ---------- 기념일 계산 ----------
  function annivList(from, to) {
    const out = [];
    if (!S.start) return out;
    if (S.start >= from && S.start <= to) out.push({ date: S.start, title: "사귄 날", kind: "start" });
    for (let k = 1; k <= 100; k++) {
      const d = addDays(S.start, k * 100 - 1);
      if (d > to) break;
      if (d >= from) out.push({ date: d, title: `${k * 100}일`, kind: "auto" });
    }
    for (let n = 1; n <= 80; n++) {
      const d = addYears(S.start, n);
      if (d > to) break;
      if (d >= from) out.push({ date: d, title: `${n}주년`, kind: "auto" });
    }
    for (const a of S.anniv) {
      if (a.yearly) {
        for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
          const d = `${y}${a.date.slice(4)}`;
          if (d >= from && d <= to) out.push({ date: d, title: a.title, id: a.id, kind: "custom" });
        }
      } else if (a.date >= from && a.date <= to) out.push({ date: a.date, title: a.title, id: a.id, kind: "custom" });
    }
    return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  }
  const dplus = (date) => diff(S.start, date) + 1;
  async function loadAnniv() { S.anniv = (await api("anniv")).anniv; }

  // ---------- 질문 ----------
  const QT = window.QUESTIONS.text, QC = window.QUESTIONS.choice;
  const qIndex = (date) => Math.max(0, diff(S.created || date, date));
  const qFor = (date, slot) => { const i = qIndex(date); return slot === "t" ? { q: QT[i % QT.length] } : QC[i % QC.length]; };
  const getAns = (date, slot, w) => S.ans[`${date}|${slot}|${w}`];
  async function loadAnswers(from, to) {
    const { answers } = await api(`answers?from=${from}&to=${to}`);
    for (const k of Object.keys(S.ans)) { const d = k.slice(0, 10); if (d >= from && d <= to) delete S.ans[k]; }
    for (const a of answers) S.ans[`${a.qdate}|${a.slot}|${a.who}`] = a;
  }
  function updateBadge() {
    const t = today();
    $("#qBadge").hidden = !!(getAns(t, "t", S.who) && getAns(t, "c", S.who));
  }

  // ---------- 화면 전환 ----------
  function setTab(tab) {
    S.tab = tab;
    $$(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    const isMap = tab === "map", isChat = tab === "chat";
    $("#mapWrap").hidden = !isMap;
    $("#chatWrap").hidden = !isChat;
    $(".topbar").hidden = isChat;
    view.hidden = isMap || isChat;
    window.scrollTo(0, 0);
    if (isMap) { ensureMap(); refreshLoc(true); return; }
    if (isChat) { openChat(); return; }
    render();
  }
  async function render(keepScroll = false) {
    const y = window.scrollY;
    try {
      if (S.tab === "home") await renderHome();
      else if (S.tab === "question") await renderQuestion();
      else if (S.tab === "calendar") await renderCalendar();
      else if (S.tab === "bucket") await renderBucket();
    } catch (e) {
      if (e.status !== 401) view.innerHTML = `<div class="card empty">불러오지 못했어요<br>${esc(e.message)}</div>`;
    }
    if (keepScroll) window.scrollTo(0, y);
  }
  const spinner = () => { if (!view.innerHTML.trim()) view.innerHTML = `<div class="spin"></div>`; };

  // ---------- 홈 ----------
  async function renderHome() {
    view.innerHTML = `<div class="spin"></div>`;
    const t = today();
    const [, locR, phR, bkR] = await Promise.all([
      loadAnswers(t, t), api("loc"), api("photos?recent=12"), api("bucket"),
    ]);
    S.locs = locR.locs; S.locNow = locR.now;
    updateBadge();
    if (S.tab !== "home") return;

    const dp = dplus(t);
    const up = annivList(t, addDays(t, 800)).filter((a) => a.kind !== "start").slice(0, 5);
    const next = up[0];
    const myCnt = ["t", "c"].filter((s) => getAns(t, s, S.who)).length;
    const otCnt = ["t", "c"].filter((s) => getAns(t, s, other())).length;
    const la = S.locs.a, lb = S.locs.b;
    const dist = la && lb ? fmtDist(distM(la, lb)) : null;
    const bk = bkR.bucket, bkDone = bk.filter((b) => b.done).length;
    S.homePhotos = phR.photos;

    view.innerHTML = `
      <div class="hero">
        <div class="pair">${esc(nm("a"))} ${ic("heart")} ${esc(nm("b"))}</div>
        <div class="dday">${dp > 0 ? dp : dlabel(1 - dp)}${dp > 0 ? "<small>일째</small>" : ""}</div>
        <div class="since">${fmtDot(S.start)}부터 함께</div>
        ${next ? `<div class="next">${ic("gift")}${esc(next.title)}까지 ${dlabel(diff(t, next.date))}</div>` : ""}
      </div>

      <div class="mini-grid">
        <button class="mini" data-act="tab" data-tab="question">
          <span class="lb">${ic("chat")}오늘의 질문</span>
          <span class="val">${myCnt}<small>/2 답함</small></span>
          <span class="hint">${esc(nm(other()))} ${otCnt}/2 ${myCnt < 2 ? "· 답하러 가기" : ""}</span>
        </button>
        <button class="mini" data-act="tab" data-tab="map">
          <span class="lb">${ic("route")}우리 사이</span>
          <span class="val">${dist || "-"}</span>
          <span class="hint">${dist ? "위치 보기" : "위치를 보내면 보여요"}</span>
        </button>
      </div>

      <button class="card touch-card" data-act="nearOpen">
        <div class="ic">${ic("heart")}</div>
        <div style="flex:1"><b>폰 맞대기</b><span>둘이 폰 윗부분을 톡 부딪히면 하트가 터져요. 가까이 대기 모드는 소리로 거리를 알아채요.</span></div>
        ${ic("right")}
      </button>

      <div class="card">
        <div class="card-h"><h3>${ic("heart")}다가오는 기념일</h3><button class="more" data-act="annivAdd" data-date="${t}">${ic("plus")}추가</button></div>
        ${up.map((a) => `
          <div class="ann">
            <div class="ic">${ic(a.kind === "custom" ? "star" : "gift")}</div>
            <div class="t"><b>${esc(a.title)}</b><span>${fmtK(a.date)}${a.date.slice(0, 4) !== t.slice(0, 4) ? " · " + a.date.slice(0, 4) : ""}</span></div>
            <div class="d">${dlabel(diff(t, a.date))}</div>
          </div>`).join("") || `<div class="empty">기념일이 없어요</div>`}
      </div>

      <div class="card">
        <div class="card-h"><h3>${ic("image")}우리 사진</h3><button class="more" data-act="tab" data-tab="calendar">캘린더${ic("right")}</button></div>
        ${S.homePhotos.length ? `<div class="strip">${S.homePhotos.map((p, i) => `
          <button data-act="openHomePhoto" data-i="${i}"><img loading="lazy" src="/api/photo/${p.id}?thumb=1" alt=""><span>${fmtDot(p.date).slice(5)}</span></button>`).join("")}</div>`
          : `<div class="empty">캘린더에서 날짜를 눌러 사진을 올려보세요</div>`}
      </div>

      <button class="card" style="display:block;width:100%;text-align:left" data-act="tab" data-tab="bucket">
        <div class="card-h"><h3>${ic("list")}버킷리스트</h3><span class="more">${bkDone}/${bk.length}${ic("right")}</span></div>
        <div class="progress"><i style="width:${bk.length ? (bkDone / bk.length) * 100 : 0}%"></i></div>
      </button>`;
  }

  // ---------- 질문 ----------
  async function renderQuestion() {
    spinner();
    const t = today();
    let from = addDays(t, -30);
    if (S.created && from < S.created) from = S.created;
    if (from > t) from = t;
    await loadAnswers(from, t);
    updateBadge();
    if (S.tab !== "question") return;

    let arch = "";
    for (let d = addDays(t, -1); d >= from; d = addDays(d, -1)) {
      const open = S.openArch.has(d);
      const dot = (w) => (getAns(d, "t", w) || getAns(d, "c", w) ? `<i class="${w}"></i>` : "<i></i>");
      arch += `
        <div class="arch">
          <button data-act="toggleArch" data-date="${d}">
            <span class="no">#${qIndex(d) + 1}</span>
            <span class="tt">${esc(qFor(d, "t").q)}</span>
            <span class="dots">${dot(S.who)}${dot(other())}</span>
          </button>
          ${open ? `<div class="inner">${qCard(d, "t")}${qCard(d, "c")}</div>` : ""}
        </div>`;
    }

    view.innerHTML = `
      <div class="q-head"><h2>오늘의 질문</h2><span>#${qIndex(t) + 1} · ${fmtK(t)}</span></div>
      ${qCard(t, "t")}
      ${qCard(t, "c")}
      ${arch ? `<div class="q-head" style="margin-top:24px"><h2 style="font-size:18px">지난 질문</h2><span>${esc(nm(S.who))} · ${esc(nm(other()))}</span></div>${arch}` : ""}`;
  }

  function bubble(w, text) {
    return `<div class="bubble ${w}">${av(w)}<div style="flex:1;min-width:0"><div class="nm">${esc(nm(w))}</div><div class="body">${esc(text)}</div></div></div>`;
  }
  function qCard(date, slot) {
    const Q = qFor(date, slot), me = S.who, ot = other();
    const mine = getAns(date, slot, me), theirs = getAns(date, slot, ot);
    const key = `${date}|${slot}`;
    let body = "";
    if (slot === "t") {
      if (!mine || S.editing === key) {
        body = `<textarea data-ta="${date}" placeholder="솔직하게 적어주세요" maxlength="1000">${esc(mine?.answer || "")}</textarea>
          <div class="q-actions">${mine ? `<button class="btn gray sm" data-act="cancelEdit">취소</button>` : ""}
          <button class="btn primary sm" data-act="saveT" data-date="${date}">${mine ? "수정 완료" : "답하기"}</button></div>`;
      } else {
        body = bubble(me, mine.answer) + `<div class="q-actions"><button class="btn gray sm" data-act="editT" data-key="${key}">${ic("pen")}수정</button></div>`;
      }
      if (theirs && !theirs.hidden) body += bubble(ot, theirs.answer);
      else if (theirs) body += `<div class="locked">${ic("lock")}${esc(nm(ot))}님이 답했어요. 내 답을 남기면 열려요</div>`;
      else body += `<div class="locked">${ic("clock")}${esc(nm(ot))}님은 아직 답하지 않았어요</div>`;
    } else {
      const seen = theirs && !theirs.hidden;
      body = `<div class="choices">${Q.a.map((txt, v) => {
        const vs = String(v);
        const who = (mine?.answer === vs ? av(me) : "") + (seen && theirs.answer === vs ? av(ot) : "");
        return `<button class="choice ${mine?.answer === vs ? "mine" : ""}" data-act="pickC" data-date="${date}" data-v="${vs}">
          <span>${esc(txt)}</span>${who ? `<span class="who">${who}</span>` : ""}</button>`;
      }).join("")}</div>`;
      if (mine && seen) {
        body += mine.answer === theirs.answer
          ? `<div class="match">${ic("heart")}통했다! 둘이 똑같이 골랐어요</div>`
          : `<div class="match" style="color:var(--sub)">서로 다른 걸 골랐어요</div>`;
      } else if (theirs) body += `<div class="locked">${ic("lock")}${esc(nm(ot))}님이 골랐어요. 나도 고르면 공개돼요</div>`;
      else body += `<div class="locked">${ic("clock")}${esc(nm(ot))}님은 아직 고르지 않았어요</div>`;
    }
    return `<div class="q-card">
      <span class="q-type ${slot}">${ic(slot === "t" ? "pen" : "check")}${slot === "t" ? "서술형" : "둘 중 하나"}</span><span class="q-num">#${qIndex(date) + 1}${date !== today() ? " · " + fmtK(date) : ""}</span>
      <div class="q-text">${esc(Q.q)}</div>${body}</div>`;
  }

  // ---------- 캘린더 ----------
  async function renderCalendar() {
    if (!S.cal) { const n = new Date(); S.cal = { y: n.getFullYear(), m: n.getMonth(), sel: today() }; }
    const { y, m } = S.cal;
    const sd = new Date(y, m, 1).getDay();
    const dim = new Date(y, m + 1, 0).getDate();
    const cells = Math.ceil((sd + dim) / 7) * 7;
    const from = ymd(new Date(y, m, 1 - sd)), to = ymd(new Date(y, m, cells - sd));
    const key = `${from}|${to}`;
    if (!S.calData || S.calData.key !== key) {
      spinner();
      const d = await api(`calendar?from=${from}&to=${to}`);
      S.calData = { key, ...d };
    }
    if (S.tab !== "calendar") return;
    const ann = annivList(from, to);
    const by = (list) => list.reduce((o, x) => ((o[x.date] ||= []).push(x), o), {});
    const ev = by(S.calData.events), ph = by(S.calData.photos), an = by(ann);
    const t = today();

    let grid = "";
    for (let i = 0; i < cells; i++) {
      const dt = new Date(y, m, 1 - sd + i), d = ymd(dt);
      const p = ph[d], e = ev[d] || [], a = an[d];
      const cls = ["day", dt.getMonth() !== m && "out", d === t && "today", d === S.cal.sel && "sel", dt.getDay() === 0 && "sun", dt.getDay() === 6 && "sat", p && "ph"].filter(Boolean).join(" ");
      const marks = (a ? ic("heart") : "") + e.slice(0, 3).map((x) => `<i class="${x.who === "b" ? "ev-b" : ""}"></i>`).join("");
      grid += `<button class="${cls}" data-act="selDay" data-date="${d}" ${p ? `style="background-image:url('/api/photo/${p[p.length - 1].id}?thumb=1')"` : ""}>
        <span class="n">${dt.getDate()}</span>${marks ? `<span class="marks">${marks}</span>` : ""}</button>`;
    }

    const sel = S.cal.sel;
    const sEv = ev[sel] || [], sPh = ph[sel] || [], sAn = an[sel] || [];
    const dp = dplus(sel);
    view.innerHTML = `
      <div class="cal-head">
        <h2>${y}년 ${m + 1}월</h2>
        <div class="nav">
          <button class="icon-btn" data-act="calToday" aria-label="오늘">${ic("target")}</button>
          <button class="icon-btn" data-act="calMove" data-d="-1" aria-label="이전 달">${ic("left")}</button>
          <button class="icon-btn" data-act="calMove" data-d="1" aria-label="다음 달">${ic("right")}</button>
        </div>
      </div>
      <div class="cal">
        <div class="dow">${[...DOW].map((d) => `<span>${d}</span>`).join("")}</div>
        <div class="days">${grid}</div>
      </div>
      <div class="card day-panel">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div><h3>${fmtK(sel)}</h3><div class="sub">${dp > 0 ? `우리가 함께한 지 ${dp}일째` : `${sel.slice(0, 4)}년`}</div></div>
          <button class="btn soft sm" data-act="annivAdd" data-date="${sel}">${ic("heart")}기념일로</button>
        </div>
        ${sAn.length ? `<div class="chips">${sAn.map((a) => `<span class="chip">${ic("heart")}${esc(a.title)}${a.kind === "custom" ? `<button class="del" data-act="annivDel" data-id="${a.id}" aria-label="삭제">${ic("x")}</button>` : ""}</span>`).join("")}</div>` : ""}

        <div class="sec-t"><span>일정</span></div>
        ${sEv.map((e) => `
          <div class="ev"><span class="bar ${e.who}"></span><span class="tm">${e.time || "종일"}</span><span class="tt">${esc(e.title)}</span>
          <button class="x" data-act="evDel" data-id="${e.id}" aria-label="삭제">${ic("x")}</button></div>`).join("")}
        <div class="add-row">
          <input type="time" id="evTime" aria-label="시간">
          <input type="text" id="evTitle" placeholder="일정 추가" maxlength="60">
          <button class="btn primary" data-act="evAdd" aria-label="추가">${ic("plus")}</button>
        </div>

        <div class="sec-t"><span>사진</span><span>${sPh.length ? sPh.length + "장" : ""}</span></div>
        <div class="photos">
          ${sPh.map((p, i) => `<button data-act="openDayPhoto" data-i="${i}"><img loading="lazy" src="/api/photo/${p.id}?thumb=1" alt=""></button>`).join("")}
          <button class="up" data-act="upPhoto">${ic("plus")}사진 추가</button>
        </div>
        <input type="file" id="phInput" accept="image/*" multiple hidden>
      </div>`;
    S.dayPhotos = sPh;
  }

  // 사진 줄이기 (서버 용량/속도용)
  function loadImg(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { res(im); setTimeout(() => URL.revokeObjectURL(url), 1000); };
      im.onerror = () => rej(new Error("사진을 열 수 없어요"));
      im.src = url;
    });
  }
  function draw(im, max, q) {
    let w = im.naturalWidth, h = im.naturalHeight;
    const s = Math.min(1, max / Math.max(w, h));
    w = Math.round(w * s); h = Math.round(h * s);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(im, 0, 0, w, h);
    return { b64: c.toDataURL("image/jpeg", q).split(",")[1], w, h };
  }
  async function prepPhoto(file) {
    const im = await loadImg(file);
    let f = draw(im, 1600, 0.82);
    if (f.b64.length > 1200000) f = draw(im, 1280, 0.72);
    if (f.b64.length > 1400000) f = draw(im, 1000, 0.65);
    const th = draw(im, 400, 0.72);
    return { data: f.b64, thumb: th.b64, w: f.w, h: f.h };
  }
  async function uploadPhotos(files) {
    const date = S.cal.sel;
    const btn = $(".photos .up");
    if (btn) btn.classList.add("busy");
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      toast(`사진 올리는 중 ${i + 1}/${files.length}`);
      try {
        const p = await prepPhoto(files[i]);
        await api("photos", { method: "POST", body: { date, ...p } });
        ok++;
      } catch (e) { toast(e.message); }
    }
    S.calData = null;
    await render(true);
    if (ok) toast(`사진 ${ok}장을 올렸어요`);
  }

  // ---------- 라이트박스 ----------
  function openLightbox(list, idx) { S.lbList = list; S.lbIdx = idx; drawLightbox(); }
  function drawLightbox() {
    const p = S.lbList[S.lbIdx], lb = $("#lightbox");
    if (!p) { lb.hidden = true; return; }
    lb.hidden = false;
    lb.innerHTML = `
      <div class="lb-top">
        <button class="icon-btn" data-act="lbClose" aria-label="닫기">${ic("x")}</button>
        <span style="font-size:14px;font-weight:600">${S.lbIdx + 1} / ${S.lbList.length}</span>
        <button class="icon-btn" data-act="lbDel" aria-label="삭제">${ic("trash")}</button>
      </div>
      <div class="lb-img">
        <img src="/api/photo/${p.id}" alt="">
        ${S.lbIdx > 0 ? `<button class="nav l" data-act="lbNav" data-d="-1">${ic("left")}</button>` : ""}
        ${S.lbIdx < S.lbList.length - 1 ? `<button class="nav r" data-act="lbNav" data-d="1">${ic("right")}</button>` : ""}
      </div>
      <div class="lb-bot"><b>${fmtK(p.date)}${p.caption ? " · " + esc(p.caption) : ""}</b><span>${esc(nm(p.who))}님이 올림 · 우리 ${dplus(p.date)}일째</span></div>`;
  }

  // ---------- 버킷리스트 ----------
  async function renderBucket() {
    spinner();
    const { bucket } = await api("bucket");
    if (S.tab !== "bucket") return;
    const done = bucket.filter((b) => b.done).length;
    view.innerHTML = `
      <div class="bk-head">
        <h2>우리의 버킷리스트</h2>
        <p>같이 하고 싶은 걸 적고 하나씩 이뤄봐요</p>
        <div class="progress"><i style="width:${bucket.length ? (done / bucket.length) * 100 : 0}%"></i></div>
        <div class="num">${bucket.length ? `${bucket.length}개 중 ${done}개 이뤘어요` : "아직 비어 있어요"}</div>
      </div>
      <div class="add-row" style="margin-bottom:14px">
        <input type="text" id="bkTitle" placeholder="예: 같이 바다 보러 가기" maxlength="80">
        <button class="btn primary" data-act="bkAdd" aria-label="추가">${ic("plus")}</button>
      </div>
      ${bucket.map((b) => `
        <div class="bk ${b.done ? "done" : ""}">
          <button class="ck" data-act="bkToggle" data-id="${b.id}" data-done="${b.done}" aria-label="완료">${ic("check")}</button>
          <div class="tt"><b>${esc(b.title)}</b><span>${b.done && b.done_date ? fmtDot(b.done_date) + " 이룸" : esc(nm(b.who)) + "의 소원"}</span></div>
          <button class="x" data-act="bkDel" data-id="${b.id}" aria-label="삭제">${ic("x")}</button>
        </div>`).join("") || `<div class="empty">첫 번째 버킷을 적어보세요</div>`}`;
  }

  // ---------- 지도 ----------
  let map = null, mapLoaded = false, fitted = 0;
  const markers = {};
  function ensureMap() {
    if (map) { setTimeout(() => map.resize(), 30); return; }
    if (!window.maplibregl) { $("#mapCard").innerHTML = `<div class="empty">지도를 불러오지 못했어요</div>`; return; }
    map = new maplibregl.Map({
      container: "map",
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [128.6014, 35.8714], zoom: 11.5,
      attributionControl: { compact: true },
      dragRotate: false, pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.on("load", () => {
      // 지명을 한국어로
      for (const ly of map.getStyle().layers) {
        if (ly.type !== "symbol") continue;
        const tf = JSON.stringify((ly.layout && ly.layout["text-field"]) || "");
        if (tf.includes("name") && !tf.includes('"ref"')) {
          map.setLayoutProperty(ly.id, "text-field", ["coalesce", ["get", "name:ko"], ["get", "name"]]);
        }
      }
      const at = $(".maplibregl-ctrl-attrib");
      if (at) at.classList.remove("maplibregl-compact-show");
      map.addSource("link", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "link", type: "line", source: "link",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#F2668B", "line-width": 4, "line-dasharray": [0.1, 2] },
      });
      mapLoaded = true;
      drawMap();
    });
  }
  function drawMap() {
    if (!map) return;
    const pts = [];
    for (const w of ["a", "b"]) {
      const l = S.locs[w];
      if (!l) { if (markers[w]) { markers[w].remove(); delete markers[w]; } continue; }
      pts.push([l.lon, l.lat]);
      const age = S.locNow - l.t;
      const html = `<div class="pinv">${esc(ini(w))}</div><div class="lb">${esc(nm(w))} · ${ago(l.t, S.locNow)}</div>`;
      const cls = `mk ${w}${age < 5 * 60000 ? " live" : ""}${age > 60 * 60000 ? " old" : ""}`;
      if (!markers[w]) {
        const el = document.createElement("div");
        el.addEventListener("click", () => map.flyTo({ center: markers[w].getLngLat(), zoom: 16 }));
        markers[w] = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([l.lon, l.lat]).addTo(map);
      }
      const el = markers[w].getElement();
      el.className = cls; el.innerHTML = html;
      markers[w].setLngLat([l.lon, l.lat]);
    }
    if (mapLoaded) {
      map.getSource("link").setData({
        type: "FeatureCollection",
        features: pts.length === 2 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: pts } }] : [],
      });
    }
    if (pts.length > fitted) { fitMap(); fitted = pts.length; }
  }
  function fitMap() {
    const pts = ["a", "b"].map((w) => S.locs[w]).filter(Boolean).map((l) => [l.lon, l.lat]);
    if (!map || !pts.length) return;
    const pad = { top: 110, bottom: 300, left: 50, right: 50 };
    if (pts.length === 1) map.flyTo({ center: pts[0], zoom: 15 });
    else map.fitBounds([[Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1])], [Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])]], { padding: pad, maxZoom: 16 });
  }
  function renderMapCard() {
    const la = S.locs.a, lb = S.locs.b;
    const live = S.watchId !== null;
    const person = (w) => {
      const l = S.locs[w];
      return `<button class="person" data-act="flyTo" data-w="${w}">${av(w)}<div class="meta"><b>${esc(nm(w))}${w === S.who ? " (나)" : ""}</b>
        <span>${l ? `${ic("clock")}${ago(l.t, S.locNow)}${l.batt != null ? ` ${ic("batt")}${l.batt}%` : ""}` : "위치 없음"}</span></div></button>`;
    };
    $("#mapCard").innerHTML = `
      <div class="dist">
        <div class="ic">${ic("route")}</div>
        <div>${la && lb ? `<b>${fmtDist(distM(la, lb))}</b><span>지금 우리 사이 거리</span>` : `<b>-</b><span>둘 다 위치를 보내면 거리가 보여요</span>`}</div>
        <button class="icon-btn fit" data-act="fitMap" aria-label="모두 보기">${ic("target")}</button>
      </div>
      <div class="people">${person(S.who)}${person(other())}</div>
      <div class="map-actions">
        <button class="btn soft" data-act="sendNow">${ic("send")}지금 보내기</button>
        <button class="btn ${live ? "on" : "gray"}" data-act="liveToggle">${ic("radio")}${live ? "실시간 켜짐" : "실시간"}</button>
        <button class="btn gray" data-act="otSheet">${ic("phone")}꺼도 공유</button>
      </div>`;
  }
  async function refreshLoc(redraw) {
    try {
      const r = await api("loc");
      S.locs = r.locs; S.locNow = r.now;
      if (S.tab === "map") { drawMap(); renderMapCard(); }
    } catch {}
  }
  function getPos() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error("이 브라우저는 위치를 지원하지 않아요"));
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
    });
  }
  const geoMsg = (e) => ({ 1: "위치 권한을 허용해 주세요 (설정 > Safari > 위치)", 2: "위치를 찾을 수 없어요", 3: "위치 찾기 시간 초과" }[e.code] || e.message);
  async function batt() {
    try { if (navigator.getBattery) return Math.round((await navigator.getBattery()).level * 100); } catch {}
    return null;
  }
  async function sendPos(p) {
    await api("loc", { method: "POST", body: { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, batt: await batt() } });
    S.lastSent = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() };
    refreshLoc();
  }
  function toggleLive() {
    if (S.watchId !== null) {
      navigator.geolocation.clearWatch(S.watchId); S.watchId = null; renderMapCard(); toast("실시간 공유를 껐어요"); return;
    }
    if (!navigator.geolocation) return toast("이 브라우저는 위치를 지원하지 않아요");
    S.watchId = navigator.geolocation.watchPosition((p) => {
      const now = Date.now(), cur = { lat: p.coords.latitude, lon: p.coords.longitude };
      const due = !S.lastSent || now - S.lastSent.t > 5 * 60000 || (now - S.lastSent.t > 20000 && distM(S.lastSent, cur) > 20);
      if (due) sendPos(p).catch(() => {});
    }, (e) => toast(geoMsg(e)), { enableHighAccuracy: true, maximumAge: 10000 });
    renderMapCard();
    toast("이 화면을 켜둔 동안 계속 보내요");
  }


  // ---------- DM 채팅 ----------
  const fmtTime = (t) => {
    const d = new Date(t), h = d.getHours(), mm = pad(d.getMinutes());
    const tm = `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${mm}`;
    const ds = ymd(d);
    if (ds === today()) return tm;
    if (ds === addDays(today(), -1)) return "어제 " + tm;
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${tm}`;
  };
  const linkify = (h) => h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

  async function openChat() {
    $("#dmAv").innerHTML = av(other());
    $("#dmName").textContent = nm(other());
    const l = S.locs[other()];
    $("#dmSub").textContent = l ? `마지막 활동 ${ago(l.t)}` : "우리 둘만의 대화";
    if (!S.chat) { S.chat = { msgs: [], read: { a: 0, b: 0 }, more: true, first: true }; $("#dmList").innerHTML = `<div class="spin"></div>`; }
    await refreshChat(true);
  }
  async function refreshChat(stick) {
    try {
      const d = await api("messages?limit=40");
      const minId = d.messages.length ? d.messages[0].id : Infinity;
      const older = S.chat.msgs.filter((m) => m.id < minId);
      const before = JSON.stringify(S.chat.msgs.slice(-3)) + JSON.stringify(S.chat.read);
      S.chat.msgs = older.concat(d.messages);
      S.chat.read = d.read;
      if (S.chat.first) { S.chat.more = d.messages.length >= 40; S.chat.first = false; }
      const after = JSON.stringify(S.chat.msgs.slice(-3)) + JSON.stringify(S.chat.read);
      if (stick || before !== after || !$("#dmList .dm-row, #dmList .dm-empty")) drawChat(stick);
      const last = S.chat.msgs[S.chat.msgs.length - 1];
      if (last && last.id > (S.chat.read[S.who] || 0) && S.tab === "chat" && !document.hidden) {
        S.chat.read[S.who] = last.id;
        api("read", { method: "POST", body: { id: last.id } }).catch(() => {});
      }
      $("#cBadge").hidden = true;
    } catch {}
  }
  function drawChat(stick) {
    const L = $("#dmList");
    const atBottom = L.scrollHeight - L.scrollTop - L.clientHeight < 120;
    const ms = S.chat.msgs, GAP = 30 * 60000;
    if (!ms.length) { L.innerHTML = `<div class="dm-empty">${av(other())}<br><b>${esc(nm(other()))}</b>님에게<br>첫 메시지를 보내보세요</div>`; return; }
    let h = S.chat.more ? `<button class="dm-more" data-act="dmMore">이전 메시지 보기</button>` : "";
    ms.forEach((m, i) => {
      const prev = ms[i - 1], next = ms[i + 1];
      const newBlock = !prev || m.t - prev.t > GAP;
      if (newBlock) h += `<div class="dm-time">${fmtTime(m.t)}</div>`;
      const first = newBlock || prev.who !== m.who;
      const last = !next || next.who !== m.who || next.t - m.t > GAP;
      const mine = m.who === S.who;
      const likes = m.likes || "";
      h += `<div class="dm-row ${mine ? "me" : "ot"}${first ? " first" : ""}${last ? " last" : ""}${likes ? " liked" : ""}">
        ${mine ? "" : last ? av(m.who) : '<span class="av-sp"></span>'}
        <div class="dm-bub" data-mid="${m.id}" data-mine="${mine ? 1 : 0}">${linkify(esc(m.text))}${likes ? `<span class="dm-like">${ic("heart")}${likes.length > 1 ? "2" : ""}</span>` : ""}</div></div>`;
    });
    const lastM = ms[ms.length - 1];
    if (lastM.who === S.who && !String(lastM.id).startsWith("tmp")) {
      h += `<div class="dm-seen">${(S.chat.read[other()] || 0) >= lastM.id ? "읽음" : "전송됨"}</div>`;
    }
    L.innerHTML = h;
    if (stick || atBottom) L.scrollTop = L.scrollHeight;
  }
  async function sendChat() {
    const inp = $("#dmText");
    const text = inp.value.trim();
    if (!text) return;
    inp.value = ""; $("#dmSend").hidden = true;
    S.chat.msgs.push({ id: "tmp" + Date.now(), who: S.who, text, likes: "", t: Date.now() });
    drawChat(true);
    try { await api("messages", { method: "POST", body: { text } }); }
    catch (e) { toast("전송 실패: " + e.message); inp.value = text; }
    refreshChat(true);
  }
  async function likeMsg(bub) {
    const id = bub.dataset.mid;
    if (String(id).startsWith("tmp")) return;
    bub.insertAdjacentHTML("beforeend", `<svg class="dm-pop" viewBox="0 0 24 24"><use href="#i-heart"/></svg>`);
    const m = S.chat.msgs.find((x) => String(x.id) === id);
    try {
      const r = await api(`messages/${id}/like`, { method: "POST", body: {} });
      if (m) m.likes = r.likes;
      setTimeout(() => drawChat(), 650);
    } catch (e) { toast(e.message); }
  }
  // 두 번 톡 = 하트, 길게 누르기 = 내 메시지 보내기 취소
  (() => {
    let lastTap = { id: null, t: 0 }, pressT = null;
    const L = $("#dmList");
    L.addEventListener("click", (e) => {
      const bub = e.target.closest(".dm-bub");
      if (!bub || e.target.closest("a")) return;
      const now = Date.now();
      if (lastTap.id === bub.dataset.mid && now - lastTap.t < 350) { likeMsg(bub); lastTap = { id: null, t: 0 }; }
      else lastTap = { id: bub.dataset.mid, t: now };
    });
    L.addEventListener("touchstart", (e) => {
      const bub = e.target.closest(".dm-bub");
      if (!bub || bub.dataset.mine !== "1") return;
      pressT = setTimeout(async () => {
        pressT = null;
        if (!confirm("이 메시지를 보내기 취소할까요?")) return;
        await api(`messages/${bub.dataset.mid}`, { method: "DELETE" }).catch(() => {});
        S.chat.msgs = S.chat.msgs.filter((m) => String(m.id) !== bub.dataset.mid);
        drawChat();
      }, 550);
    }, { passive: true });
    const cancel = () => { if (pressT) { clearTimeout(pressT); pressT = null; } };
    L.addEventListener("touchend", cancel); L.addEventListener("touchmove", cancel, { passive: true });
    L.addEventListener("contextmenu", (e) => { if (e.target.closest(".dm-bub")) e.preventDefault(); });
  })();
  $("#dmText").addEventListener("input", (e) => { $("#dmSend").hidden = !e.target.value.trim(); });
  $("#dmText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); sendChat(); } });
  $("#dmText").addEventListener("focus", () => { document.body.classList.add("typing"); setTimeout(() => { const L = $("#dmList"); L.scrollTop = L.scrollHeight; }, 300); });
  $("#dmText").addEventListener("blur", () => { document.body.classList.remove("typing"); $("#chatWrap").style.height = ""; });
  if (window.visualViewport) {
    const fit = () => {
      if (!document.body.classList.contains("typing")) return;
      const w = $("#chatWrap");
      w.style.height = visualViewport.height + "px";
      w.style.top = visualViewport.offsetTop + "px";
      w.style.bottom = "auto";
    };
    visualViewport.addEventListener("resize", fit);
    visualViewport.addEventListener("scroll", fit);
    $("#dmText").addEventListener("blur", () => { const w = $("#chatWrap"); w.style.top = ""; w.style.bottom = ""; });
  }

  // ---------- 폰 맞대기: 부딪히기(동작 센서) ----------
  const T = { motionOn: false, asked: false, lastBump: 0, prevMag: 0, polling: null, near: null };
  const bumpEnabled = () => store.get("cp_bump") !== "0";
  async function enableMotion(fromGesture) {
    if (T.motionOn || !bumpEnabled() || typeof DeviceMotionEvent === "undefined") return;
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      if (!fromGesture || T.asked) return;
      T.asked = true;
      try { if ((await DeviceMotionEvent.requestPermission()) !== "granted") return; } catch { T.asked = false; return; }
    }
    window.addEventListener("devicemotion", onMotion);
    T.motionOn = true;
  }
  function onMotion(e) {
    let mag;
    const a = e.acceleration;
    if (a && a.x != null) mag = Math.hypot(a.x, a.y, a.z);
    else { const g = e.accelerationIncludingGravity; if (!g || g.x == null) return; mag = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81); }
    const now = Date.now();
    // 가만히 있다가 갑자기 톡 치는 충격만 인식
    if (mag > 15 && T.prevMag < 7 && now - T.lastBump > 2500) { T.lastBump = now; sendTouch("bump"); }
    T.prevMag = T.prevMag * 0.6 + mag * 0.4;
  }
  // 처음 화면을 터치할 때 자동으로 센서 허용 요청 (아이폰은 열 때마다 한 번)
  document.addEventListener("click", () => { if (S.who) enableMotion(true); }, true);
  document.addEventListener("touchend", () => { if (S.who) enableMotion(true); }, true);

  async function sendTouch(kind) {
    const sentAt = Date.now();
    try {
      const r = await api("touch", { method: "POST", body: { kind } });
      if (r.match) return playFx(r.touch);
      // 상대가 조금 늦게 부딪힌 경우를 위해 잠깐 확인
      let n = 0;
      clearInterval(T.polling);
      T.polling = setInterval(async () => {
        if (++n > 7) return clearInterval(T.polling);
        const t = (await api("touch").catch(() => ({}))).touch || 0;
        if (t > sentAt - 3000 && t > S.lastTouchSeen) { clearInterval(T.polling); playFx(t); }
      }, 500);
    } catch {}
  }

  const HEART = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 21s-7.8-4.8-9.6-9.7C1.1 7.6 3.4 4 7 4c2.1 0 3.7 1.1 5 3 1.3-1.9 2.9-3 5-3 3.6 0 5.9 3.6 4.6 7.3C19.8 16.2 12 21 12 21z"/></svg>`;
  function playFx(t) {
    S.lastTouchSeen = Math.max(S.lastTouchSeen, t || Date.now());
    const fx = $("#fx");
    const sparks = Array.from({ length: 22 }, (_, i) => `<i style="--a:${i * (360 / 22) + Math.random() * 10}deg;--d:${90 + Math.random() * 110}px;--s:${4 + Math.random() * 7}px;--dl:${(Math.random() * 0.25).toFixed(2)}s"></i>`).join("");
    fx.innerHTML = `<div class="fx-glow"></div>
      <div class="fx-ring r1"></div><div class="fx-ring r2"></div><div class="fx-ring r3"></div>
      <div class="fx-heart l">${HEART}</div><div class="fx-heart r">${HEART}</div>
      <div class="fx-sparks">${sparks}</div>
      <div class="fx-big">${HEART}</div>
      <div class="fx-text"><b>${esc(nm("a"))} & ${esc(nm("b"))}</b><span>닿았다 · 우리 ${dplus(today())}일째</span></div>`;
    fx.hidden = false;
    try { navigator.vibrate && navigator.vibrate([20, 60, 20, 60, 160]); } catch {}
    clearTimeout(playFx.t);
    playFx.t = setTimeout(() => (fx.hidden = true), 4500);
    fx.onclick = () => { fx.hidden = true; };
  }

  // ---------- 폰 맞대기: 가까이 대기(초음파) ----------
  const FREQ = { a: 18500, b: 19400 };
  function nearOpen() {
    enableMotion(true);
    const sens = Number(store.get("cp_sens") || 28);
    const el = $("#near");
    el.innerHTML = `
      <button class="icon-btn nx" data-act="nearClose" aria-label="닫기">${ic("x")}</button>
      <h2>폰 맞대기</h2>
      <p>둘 다 이 화면을 켜고<br>폰 윗부분끼리 톡 부딪히거나 가까이 대보세요</p>
      <div class="near-orb idle" id="nearOrb">${av(S.who)}${av(other())}</div>
      <div class="meter"><div class="bar"><i id="nearBar"></i></div><div class="lb"><span>${esc(nm(other()))} 신호</span><span id="nearVal">꺼짐</span></div></div>
      <div class="near-opts"><label style="margin:0">감도 (오른쪽일수록 멀리서도 반응)<input type="range" id="nearSens" min="12" max="45" value="${57 - sens}"></label></div>
      <div class="near-status" id="nearStatus">${T.motionOn ? "부딪히기 감지 켜짐" : ""}</div>
      <button class="btn primary block" data-act="nearStart" id="nearBtn">${ic("wave")}가까이 대기 시작</button>`;
    el.hidden = false;
    $("#nearSens").oninput = (e) => store.set("cp_sens", String(57 - Number(e.target.value)));
  }
  async function nearStart() {
    if (T.near) return nearStop(true);
    const status = $("#nearStatus");
    try {
      try { if (navigator.audioSession) navigator.audioSession.type = "play-and-record"; } catch {}
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();
      const an = ctx.createAnalyser();
      an.fftSize = 8192; an.smoothingTimeConstant = 0.3;
      ctx.createMediaStreamSource(stream).connect(an);
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = FREQ[S.who]; gain.gain.value = 0.35;
      osc.connect(gain).connect(ctx.destination); osc.start();
      const buf = new Float32Array(an.frequencyBinCount);
      const binOf = (f) => Math.round(f / (ctx.sampleRate / an.fftSize));
      const tb = binOf(FREQ[other()]);
      let hits = 0, lastNear = 0;
      const loop = setInterval(() => {
        an.getFloatFrequencyData(buf);
        let peak = -200; for (let i = tb - 2; i <= tb + 2; i++) peak = Math.max(peak, buf[i]);
        let nz = 0, c = 0;
        for (let i = tb - 60; i < tb - 20; i++) { nz += buf[i]; c++; }
        for (let i = tb + 20; i < Math.min(buf.length, tb + 60); i++) { nz += buf[i]; c++; }
        const snr = Math.max(0, peak - nz / c);
        const bar = $("#nearBar"), val = $("#nearVal");
        if (bar) bar.style.width = Math.min(100, (snr / 50) * 100) + "%";
        if (val) val.textContent = snr < 6 ? "멀어요" : snr < 18 ? "조금 가까워요" : "가까워요";
        const thr = Number(store.get("cp_sens") || 28);
        hits = snr > thr ? hits + 1 : 0;
        if (hits >= 4 && Date.now() - lastNear > 3000) { lastNear = Date.now(); hits = 0; sendTouch("near"); }
      }, 60);
      const beat = setInterval(() => api("touch", { method: "POST", body: { kind: "listen" } }).catch(() => {}), 4000);
      api("touch", { method: "POST", body: { kind: "listen" } }).catch(() => {});
      const poll = setInterval(async () => {
        const t = (await api("touch").catch(() => ({}))).touch || 0;
        if (t > S.lastTouchSeen && Date.now() - t < 8000) playFx(t);
      }, 900);
      T.near = { stream, ctx, osc, loop, beat, poll };
      $("#nearOrb").classList.remove("idle");
      $("#nearBtn").innerHTML = `${ic("x")}가까이 대기 끄기`;
      status.textContent = "듣는 중... 폰을 가까이 대보세요";
    } catch (e) {
      status.textContent = e.name === "NotAllowedError" ? "마이크 권한을 허용해야 해요" : "시작할 수 없어요: " + e.message;
    }
  }
  function nearStop(keepOpen) {
    const n = T.near;
    if (n) {
      clearInterval(n.loop); clearInterval(n.beat); clearInterval(n.poll);
      try { n.osc.stop(); } catch {}
      n.stream.getTracks().forEach((t) => t.stop());
      n.ctx.close().catch(() => {});
      try { if (navigator.audioSession) navigator.audioSession.type = "auto"; } catch {}
      T.near = null;
    }
    if (keepOpen && $("#nearBtn")) {
      $("#nearOrb").classList.add("idle");
      $("#nearBtn").innerHTML = `${ic("wave")}가까이 대기 시작`;
      $("#nearStatus").textContent = "";
      $("#nearBar").style.width = "0"; $("#nearVal").textContent = "꺼짐";
    }
  }

  // ---------- 시트 ----------
  function openSheet(html) { $("#sheetBox").innerHTML = html; $("#sheet").hidden = false; }
  function closeSheet() { $("#sheet").hidden = true; }
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });

  function otSheet() {
    openSheet(`
      <h2>${ic("phone")}화면 꺼도 위치 공유</h2>
      <p>웹페이지는 화면이 꺼지면 위치를 못 보내요. 무료 앱 <b>OwnTracks</b>가 백그라운드에서 이 사이트로 위치를 보내게 연결하면 돼요. 아이폰, 안드로이드 둘 다 돼요.</p>
      <ol>
        <li>App Store / Play 스토어에서 <b>OwnTracks</b> 설치</li>
        <li>앱 설정에서 <b>Mode</b>를 <b>HTTP</b>로 바꾸기</li>
        <li>아래 값 입력</li>
      </ol>
      <div class="kv"><span class="k">URL</span><span class="v" id="kvUrl">${esc(location.origin)}/api/owntracks</span><button data-act="copy" data-t="kvUrl">${ic("copy")}</button></div>
      <div class="kv"><span class="k">UserID</span><span class="v" id="kvUser">${esc(nm(S.who))}</span><button data-act="copy" data-t="kvUser">${ic("copy")}</button></div>
      <div class="kv"><span class="k">Password</span><span class="v">로그인 비밀번호</span></div>
      <div class="kv"><span class="k">DeviceID</span><span class="v">phone</span></div>
      <ol start="4">
        <li>위치 권한 <b>항상 허용</b></li>
        <li>지도 위 모드 버튼에서 <b>Significant</b>(배터리 절약) 또는 <b>Move</b>(자주 전송) 선택</li>
      </ol>
      <p class="note">UserID는 이 사이트의 내 이름과 똑같아야 해요. 앱 지도에서도 ${esc(nm(other()))}님 위치가 보여요. 잠깐 멈추려면 앱에서 Quiet 모드로 바꾸면 돼요.</p>
      <div class="row2"><button class="btn gray" data-act="close">닫기</button></div>`);
  }

  function settingsSheet() {
    openSheet(`
      <h2>${ic("gear")}설정</h2>
      <label>${esc(nm("a"))} 이름<input id="stA" type="text" maxlength="20" value="${esc(nm("a"))}"></label>
      <label>${esc(nm("b"))} 이름<input id="stB" type="text" maxlength="20" value="${esc(nm("b"))}"></label>
      <label>사귄 날<input id="stStart" type="date" value="${S.start}"></label>
      <div class="row2"><button class="btn primary" data-act="saveSettings">저장</button></div>
      <hr>
      <label>현재 비밀번호<input id="pwOld" type="password"></label>
      <label>새 비밀번호<input id="pwNew" type="password" placeholder="4자 이상"></label>
      <div class="row2"><button class="btn soft" data-act="savePw">비밀번호 바꾸기</button></div>
      <p class="muted" style="font-size:12px;margin-top:8px">바꾸면 상대방도 다시 로그인해야 하고, OwnTracks 앱 비밀번호도 바꿔야 해요.</p>
      <hr>
      <div class="row2"><button class="btn ${bumpEnabled() ? "soft" : "gray"}" data-act="toggleBump">${ic("heart")}부딪히기 감지 ${bumpEnabled() ? "켜짐" : "꺼짐"}</button></div>
      <p class="muted" style="font-size:12px;margin-top:8px">켜두면 사이트를 열고 처음 터치할 때 동작 센서 허용을 물어봐요. 아이폰은 사이트를 새로 열 때마다 한 번씩 물어봐요.</p>
      <div class="row2">
        <button class="btn gray" data-act="otSheet">${ic("phone")}꺼도 공유 설정</button>
        <button class="btn danger" data-act="locDel">내 위치 지우기</button>
      </div>
      <div class="row2"><button class="btn gray" data-act="logout">${ic("logout")}로그아웃</button></div>`);
  }

  function annivSheet(date) {
    openSheet(`
      <h2>${ic("heart")}기념일 추가</h2>
      <p>100일, 주년은 자동으로 계산돼요. 생일 같은 날을 추가해 보세요.</p>
      <label>이름<input id="anTitle" type="text" maxlength="30" placeholder="예: ${esc(nm(other()))} 생일"></label>
      <label>날짜<input id="anDate" type="date" value="${date}"></label>
      <label class="check" style="margin-top:14px"><input id="anYearly" type="checkbox" checked>매년 반복</label>
      <div class="row2"><button class="btn gray" data-act="close">취소</button><button class="btn primary" data-act="annivSave">추가</button></div>`);
  }

  // ---------- 버튼 동작 ----------
  const ACT = {
    tab: (el) => setTab(el.dataset.tab),
    dmSend: () => sendChat(),
    async dmMore() {
      const first = S.chat.msgs.find((m) => !String(m.id).startsWith("tmp"));
      if (!first) return;
      const L = $("#dmList"), h0 = L.scrollHeight;
      const d = await api(`messages?before=${first.id}&limit=40`);
      S.chat.msgs = d.messages.concat(S.chat.msgs);
      S.chat.more = d.messages.length >= 40;
      drawChat();
      L.scrollTop = L.scrollHeight - h0;
    },
    nearOpen: () => nearOpen(),
    nearStart: () => nearStart(),
    nearClose() { nearStop(); $("#near").hidden = true; },
    toggleBump() {
      const on = !bumpEnabled();
      store.set("cp_bump", on ? "1" : "0");
      if (!on && T.motionOn) { window.removeEventListener("devicemotion", onMotion); T.motionOn = false; }
      if (on) { T.asked = false; enableMotion(true); }
      settingsSheet();
    },
    close: closeSheet,

    // 질문
    async saveT(el) {
      const date = el.dataset.date;
      const ta = $(`textarea[data-ta="${date}"]`);
      const v = ta.value.trim();
      if (!v) return toast("답을 적어주세요");
      el.disabled = true;
      try {
        await api("answers", { method: "POST", body: { qdate: date, slot: "t", answer: v } });
        S.editing = null;
        await render(true);
        toast("답을 남겼어요");
      } catch (e) { toast(e.message); el.disabled = false; }
    },
    editT(el) { S.editing = el.dataset.key; render(true); },
    cancelEdit() { S.editing = null; render(true); },
    async pickC(el) {
      try {
        await api("answers", { method: "POST", body: { qdate: el.dataset.date, slot: "c", answer: el.dataset.v } });
        await render(true);
      } catch (e) { toast(e.message); }
    },
    toggleArch(el) {
      const d = el.dataset.date;
      S.openArch.has(d) ? S.openArch.delete(d) : S.openArch.add(d);
      render(true);
    },

    // 캘린더
    selDay(el) {
      const d = el.dataset.date;
      const [y, m] = parts(d);
      S.cal.sel = d;
      if (y !== S.cal.y || m !== S.cal.m) { S.cal.y = y; S.cal.m = m; }
      render(true);
    },
    calMove(el) {
      const dt = new Date(S.cal.y, S.cal.m + Number(el.dataset.d), 1);
      S.cal.y = dt.getFullYear(); S.cal.m = dt.getMonth(); S.cal.sel = ymd(dt);
      render();
    },
    calToday() { const n = new Date(); S.cal = { y: n.getFullYear(), m: n.getMonth(), sel: today() }; render(); },
    async evAdd() {
      const title = $("#evTitle").value.trim();
      if (!title) return toast("일정 내용을 적어주세요");
      try {
        await api("events", { method: "POST", body: { date: S.cal.sel, time: $("#evTime").value || null, title } });
        S.calData = null; await render(true); toast("일정을 추가했어요");
      } catch (e) { toast(e.message); }
    },
    async evDel(el) {
      if (!confirm("이 일정을 지울까요?")) return;
      await api(`events/${el.dataset.id}`, { method: "DELETE" });
      S.calData = null; render(true);
    },
    upPhoto() { $("#phInput").click(); },
    openDayPhoto(el) { openLightbox(S.dayPhotos, Number(el.dataset.i)); },
    openHomePhoto(el) { openLightbox(S.homePhotos, Number(el.dataset.i)); },

    // 기념일
    annivAdd(el) { annivSheet(el.dataset.date || today()); },
    async annivSave() {
      const title = $("#anTitle").value.trim(), date = $("#anDate").value;
      if (!title || !date) return toast("이름과 날짜를 입력하세요");
      try {
        await api("anniv", { method: "POST", body: { title, date, yearly: $("#anYearly").checked } });
        await loadAnniv(); closeSheet(); render(true); toast("기념일을 추가했어요");
      } catch (e) { toast(e.message); }
    },
    async annivDel(el) {
      if (!confirm("이 기념일을 지울까요?")) return;
      await api(`anniv/${el.dataset.id}`, { method: "DELETE" });
      await loadAnniv(); render(true);
    },

    // 라이트박스
    lbClose() { $("#lightbox").hidden = true; },
    lbNav(el) { S.lbIdx += Number(el.dataset.d); drawLightbox(); },
    async lbDel() {
      const p = S.lbList[S.lbIdx];
      if (!p || !confirm("이 사진을 지울까요?")) return;
      try {
        await api(`photos/${p.id}`, { method: "DELETE" });
        S.lbList.splice(S.lbIdx, 1);
        if (S.lbIdx >= S.lbList.length) S.lbIdx = S.lbList.length - 1;
        drawLightbox();
        S.calData = null; render(true);
      } catch (e) { toast(e.message); }
    },

    // 버킷
    async bkAdd() {
      const title = $("#bkTitle").value.trim();
      if (!title) return toast("하고 싶은 걸 적어주세요");
      await api("bucket", { method: "POST", body: { title } });
      render(true);
    },
    async bkToggle(el) {
      const done = el.dataset.done !== "1";
      await api(`bucket/${el.dataset.id}`, { method: "POST", body: { done, date: today() } });
      if (done) toast("하나 이뤘어요!");
      render(true);
    },
    async bkDel(el) {
      if (!confirm("이 버킷을 지울까요?")) return;
      await api(`bucket/${el.dataset.id}`, { method: "DELETE" });
      render(true);
    },

    // 지도
    async sendNow() {
      toast("위치 찾는 중...");
      try { await sendPos(await getPos()); toast("내 위치를 보냈어요"); }
      catch (e) { toast(e.code ? geoMsg(e) : e.message); }
    },
    liveToggle: toggleLive,
    otSheet,
    fitMap,
    flyTo(el) {
      const l = S.locs[el.dataset.w];
      if (!l) return toast("아직 위치가 없어요");
      map.flyTo({ center: [l.lon, l.lat], zoom: 16 });
    },
    async copy(el) {
      const txt = $("#" + el.dataset.t).textContent;
      try { await navigator.clipboard.writeText(txt); toast("복사했어요"); } catch { toast("길게 눌러서 복사하세요"); }
    },

    // 설정
    async saveSettings() {
      const body = { aName: $("#stA").value.trim(), bName: $("#stB").value.trim(), start: $("#stStart").value };
      try {
        await api("settings", { method: "POST", body });
        S.names = { a: body.aName, b: body.bName }; S.start = body.start;
        setBrand(); closeSheet(); render(true); toast("저장했어요");
      } catch (e) { toast(e.message); }
    },
    async savePw() {
      try {
        await api("password", { method: "POST", body: { old: $("#pwOld").value, new: $("#pwNew").value } });
        closeSheet(); toast("비밀번호를 바꿨어요");
      } catch (e) { toast(e.message); }
    },
    async locDel() {
      if (!confirm("서버에 저장된 내 위치를 지울까요?")) return;
      await api("loc", { method: "DELETE" });
      if (S.watchId !== null) toggleLive();
      closeSheet(); toast("내 위치를 지웠어요");
      refreshLoc();
    },
    async logout() {
      await api("logout", { method: "POST" }).catch(() => {});
      location.reload();
    },
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); Promise.resolve(fn(el, e)).catch((err) => err.status !== 401 && toast(err.message)); }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "phInput" && e.target.files.length) uploadPhotos([...e.target.files]);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    if (e.target.id === "evTitle") ACT.evAdd();
    if (e.target.id === "bkTitle") ACT.bkAdd();
  });
  $$(".tabbar button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  $("#btnSettings").addEventListener("click", settingsSheet);

  // ---------- 시작 / 로그인 ----------
  function setBrand() { $("#brandA").textContent = nm("a"); $("#brandB").textContent = nm("b"); }
  function showOnly(id) { for (const s of ["setup", "login", "app"]) $("#" + s).hidden = s !== id; }

  async function showLogin() {
    if (!$("#login").hidden) return;
    let names = S.names;
    try { const st = await api("state"); if (!st.setup) return showSetup(); names = st.names; } catch {}
    showOnly("login");
    $("#loginTitle").textContent = `${names.a} & ${names.b}`;
    S.pickWho = null;
    $("#whoPick").innerHTML = ["a", "b"].map((w) => `<button data-who="${w}"><span class="av ${w}">${esc([...names[w]][0] || "?")}</span>${esc(names[w])}</button>`).join("");
    $$("#whoPick button").forEach((b) => b.onclick = () => {
      S.pickWho = b.dataset.who;
      $$("#whoPick button").forEach((x) => x.classList.toggle("on", x === b));
      $("#liPw").focus();
    });
  }
  $("#liGo").onclick = async () => {
    if (!S.pickWho) return ($("#liErr").textContent = "누구인지 골라주세요");
    try {
      await api("login", { method: "POST", body: { who: S.pickWho, password: $("#liPw").value } });
      $("#liPw").value = ""; $("#liErr").textContent = "";
      boot();
    } catch (e) { $("#liErr").textContent = e.message; }
  };
  $("#liPw").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#liGo").click(); });

  function showSetup() {
    showOnly("setup");
    if (!$("#suStart").value) $("#suStart").value = today();
  }
  $("#suGo").onclick = async () => {
    const pw = $("#suPw").value;
    if (pw !== $("#suPw2").value) return ($("#suErr").textContent = "비밀번호가 서로 달라요");
    try {
      await api("setup", { method: "POST", body: { aName: $("#suA").value.trim(), bName: $("#suB").value.trim(), start: $("#suStart").value, password: pw, today: today() } });
      boot();
    } catch (e) { $("#suErr").textContent = e.message; }
  };

  async function boot() {
    try {
      const st = await api("state");
      if (!st.setup) return showSetup();
      let me;
      try { me = await api("me"); } catch (e) { if (e.status === 401) return showLogin(); throw e; }
      S.who = me.who; S.names = me.names; S.start = me.start; S.created = me.created;
      setBrand();
      await loadAnniv();
      showOnly("app");
      await pulse(true);
      setTab(S.tab || "home");
    } catch (e) {
      document.body.insertAdjacentHTML("beforeend", `<div class="gate"><div class="gate-card"><h1>연결 오류</h1><p class="muted">${esc(e.message)}</p></div></div>`);
    }
  }

  // 채팅 새로고침 + 배지 확인
  setInterval(() => { if (!document.hidden && S.tab === "chat" && S.who && S.chat) refreshChat(); }, 2500);
  async function pulse(first) {
    if (!S.who) return;
    try {
      const p = await api("pulse");
      const unread = p.last && p.last.who !== S.who && p.last.id > (p.read[S.who] || 0);
      $("#cBadge").hidden = !unread || S.tab === "chat";
      if (first) S.lastTouchSeen = p.touch;
      else if (p.touch > S.lastTouchSeen && Date.now() - p.touch < 15000) playFx(p.touch);
    } catch {}
  }
  setInterval(() => { if (!document.hidden) pulse(); }, 10000);

  // 위치 자동 새로고침
  setInterval(() => { if (!document.hidden && S.tab === "map" && S.who) refreshLoc(); }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !S.who) return;
    pulse();
    if (S.tab === "chat" && S.chat) refreshChat(); else if (S.tab === "map") refreshLoc(); else if (S.tab === "home" || S.tab === "question") render(true);
  });

  boot();
})();
