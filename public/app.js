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
  const avSrc = (w) => (S.avatars && S.avatars[w] ? `/api/avatar/${w}?v=${S.avatars[w]}` : null);
  const av = (w, cls = "") => avSrc(w) ? `<span class="av ${w} ${cls} has-img"><img src="${avSrc(w)}" alt=""></span>` : `<span class="av ${w} ${cls}">${esc(ini(w))}</span>`;
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
  const CSLOTS = ["c1", "c2", "c3"];
  const ALL_SLOTS = ["t", ...CSLOTS];
  const qFor = (date, slot) => {
    const i = qIndex(date);
    const G = window.QGEN;
    if (slot === "t") return { q: G ? G.text(i) : QT[i % QT.length] };
    const k = Math.max(0, CSLOTS.indexOf(slot));
    return G ? G.choice(i * 3 + k) : QC[(i * 3 + k) % QC.length];
  };
  // 예전 버전의 "c" 답은 첫 번째 객관식으로 취급
  const getAns = (date, slot, w) => S.ans[`${date}|${slot}|${w}`] || (slot === "c1" ? S.ans[`${date}|c|${w}`] : undefined);
  const answeredCount = (date, w) => ALL_SLOTS.filter((sl) => getAns(date, sl, w)).length;
  async function loadAnswers(from, to) {
    const { answers } = await api(`answers?from=${from}&to=${to}`);
    for (const k of Object.keys(S.ans)) { const d = k.slice(0, 10); if (d >= from && d <= to) delete S.ans[k]; }
    for (const a of answers) S.ans[`${a.qdate}|${a.slot}|${a.who}`] = a;
  }
  function updateBadge() {
    const t = today();
    $("#qBadge").hidden = answeredCount(t, S.who) >= ALL_SLOTS.length;
  }

  // ---------- 화면 전환 ----------
  const TABS = ["home", "chat", "question", "calendar", "map"];
  // 탭바 유리 알약이 선택한 탭으로 미끄러지듯 이동
  function movePill() {
    const on = $(".tabbar button.on"), pill = $(".tab-pill");
    if (!on || !pill) return;
    pill.style.width = on.offsetWidth + "px";
    pill.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  window.addEventListener("resize", movePill);
  function setTab(tab) {
    if (!TABS.includes(tab)) tab = "home";
    S.tab = tab;
    try { history.replaceState(null, "", "#" + tab); } catch {}
    $$(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    movePill();
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
      else if (S.tab === "calendar") await (S.memView === "cal" ? renderCalendar() : renderAlbum());

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
    const up = annivList(t, addDays(t, 800)).filter((a) => a.kind !== "start").slice(0, 3);
    const next = up[0];
    const myCnt = answeredCount(t, S.who);
    const otCnt = answeredCount(t, other());
    const la = S.locs.a, lb = S.locs.b;
    const dist = la && lb ? fmtDist(distM(la, lb)) : null;
    const bk = bkR.bucket, bkDone = bk.filter((b) => b.done).length;
    S.homePhotos = phR.photos;

    const nextDays = next ? diff(t, next.date) : null;
    view.innerHTML = `
      <div class="hero">
        <div class="pair"><span class="pair-av">${av("a")}${av("b")}</span>${esc(nm("a"))} ${ic("heart")} ${esc(nm("b"))}</div>
        <div class="dday">${dp > 0 ? dp : dlabel(1 - dp)}${dp > 0 ? "<small>일째</small>" : ""}</div>
        <div class="since">${fmtDot(S.start)}부터 함께</div>
        <button class="hero-tap" data-act="swOpen" aria-label="폰 맞대기">${HEART}<span>맞대기</span></button>
      </div>
      ${(() => {
        const ps = pushState();
        if (ps === "granted" || ps === "unsupported") return "";
        if (ps === "needs-home") return `<div class="card push-card">${ic("bell")}<div><b>앱을 꺼도 알림 받기</b><span>공유 버튼 ${ic("right", "arr")} 홈 화면에 추가 후, 그 아이콘으로 열어서 알림을 켜주세요</span></div></div>`;
        if (ps === "denied") return `<div class="card push-card">${ic("bell")}<div><b>알림이 꺼져 있어요</b><span>아이폰 설정 ${ic("right", "arr")} 알림에서 허용해 주세요</span></div></div>`;
        return `<button class="card push-card" data-act="pushOn">${ic("bell")}<div><b>알림 켜기</b><span>앱을 꺼도 메시지와 장소 알림이 와요</span></div></button>`;
      })()}
      <div class="tiles">
        <button class="tile" data-act="tab" data-tab="question">
          <span class="ti">${ic("chat")}</span><span class="tl">오늘의 질문</span>
          <b>${myCnt}<small>/4</small></b><span class="th">${myCnt < 4 ? "답하러 가기" : `${esc(nm(other()))} ${otCnt}/4`}</span>
        </button>
        <button class="tile" data-act="tab" data-tab="map">
          <span class="ti">${ic("pin")}</span><span class="tl">우리 사이</span>
          <b>${S.together ? "함께" : dist || "-"}</b><span class="th">${S.together ? "같이 있어요" : dist ? "거리" : "위치 없음"}</span>
        </button>
        <button class="tile" data-act="annivSheet">
          <span class="ti">${ic("gift")}</span><span class="tl">${next ? esc(next.title) : "기념일"}</span>
          <b>${next ? dlabel(nextDays) : "-"}</b><span class="th">${next ? fmtK(next.date).replace(/ \(.\)/, "") : "추가하기"}</span>
        </button>
        <button class="tile" data-act="bucketOpen">
          <span class="ti">${ic("list")}</span><span class="tl">버킷리스트</span>
          <b>${bkDone}<small>/${bk.length}</small></b><span class="th">${bk.length ? "이룬 것" : "적어보기"}</span>
        </button>
      </div>
      ${S.homePhotos.length ? `<div class="strip plain">${S.homePhotos.slice(0, 8).map((p, i) => `<button data-act="openHomePhoto" data-i="${i}"><img loading="lazy" src="/api/photo/${p.id}?thumb=1" alt=""></button>`).join("")}</div>` : ""}`;
  }

  function annivSheetList() {
    const t = today();
    const up = annivList(t, addDays(t, 800)).filter((a) => a.kind !== "start").slice(0, 8);
    openSheet(`
      <h2>${ic("gift")}다가오는 기념일</h2>
      ${up.map((a) => `
        <div class="ann">
          <div class="ic">${ic(a.kind === "custom" ? "star" : "gift")}</div>
          <div class="t"><b>${esc(a.title)}</b><span>${fmtK(a.date)}${a.date.slice(0, 4) !== t.slice(0, 4) ? " · " + a.date.slice(0, 4) : ""}</span></div>
          <div class="d">${dlabel(diff(t, a.date))}</div>
          ${a.kind === "custom" ? `<button class="x" data-act="annivDel" data-id="${a.id}" aria-label="삭제">${ic("x")}</button>` : ""}
        </div>`).join("")}
      <div class="row2"><button class="btn gray" data-act="close">닫기</button><button class="btn primary" data-act="annivAdd" data-date="${t}">${ic("plus")}기념일 추가</button></div>`);
  }

  // ---------- 질문 ----------
  async function renderQuestion() {
    spinner();
    const t = today();
    S.qDays = S.qDays || 14;
    let from = addDays(t, -S.qDays);
    const hasMore = !S.created || from > S.created;
    if (S.created && from < S.created) from = S.created;
    if (from > t) from = t;
    await loadAnswers(from, t);
    updateBadge();
    if (S.tab !== "question") return;

    const prog = (w) => `<span class="qp-chip">${av(w)}${answeredCount(t, w)}/4</span>`;
    let arch = "";
    for (let d = addDays(t, -1); d >= from; d = addDays(d, -1)) {
      const open = S.openArch.has(d);
      const dot = (w) => `<i class="${answeredCount(d, w) ? w : ""}"></i>`;
      arch += `
        <div class="arch${open ? " open" : ""}">
          <button data-act="toggleArch" data-date="${d}">
            <span class="ad">${fmtK(d)}</span>
            <span class="tt">${esc(qFor(d, "t").q)}</span>
            <span class="dots">${dot(S.who)}${dot(other())}</span>
            ${ic("right", "chev")}
          </button>
          ${open ? `<div class="inner">${qCard(d, "t")}${CSLOTS.map((sl, k) => choiceOne(d, sl, k)).join("")}</div>` : ""}
        </div>`;
    }
    view.innerHTML = `
      <div class="q-top">
        <div><h2>오늘의 질문</h2><span>${fmtK(t)}</span></div>
        <div class="qp-row">${prog(S.who)}${prog(other())}</div>
      </div>
      ${qCard(t, "t")}
      <div class="q-sec">둘 중 하나 <span>한 번만 고를 수 있어요</span></div>
      ${CSLOTS.map((sl, k) => choiceOne(t, sl, k)).join("")}
      ${arch ? `<div class="q-sec" style="margin-top:26px">지난 질문 <span>매일 저장돼요</span></div>${arch}` : ""}
      ${arch && hasMore ? `<button class="btn gray block" data-act="qMore" style="margin-top:8px">더 지난 질문 보기</button>` : ""}`;
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
    }
    return `<div class="q-card q-main">
      <div class="q-text">${esc(Q.q)}</div>${body}</div>`;
  }

  function choiceOne(date, slot, k) {
    const me = S.who, ot = other();
    const Q = qFor(date, slot);
    const mine = getAns(date, slot, me), theirs = getAns(date, slot, ot);
    const seen = mine && theirs && !theirs.hidden;
    const btns = Q.a.map((txt, v) => {
      const vs = String(v);
      const who = (mine?.answer === vs ? av(me) : "") + (seen && theirs.answer === vs ? av(ot) : "");
      return `<button class="choice ${mine?.answer === vs ? "mine" : ""} ${mine ? "locked" : ""}" data-act="pickC" data-date="${date}" data-slot="${slot}" data-v="${vs}" ${mine ? "disabled" : ""}>
        <span>${esc(txt)}</span>${who ? `<span class="who">${who}</span>` : ""}</button>`;
    }).join("");
    let foot = "";
    if (seen) foot = mine.answer === theirs.answer ? `<div class="match">${ic("heart")}통했다!</div>` : `<div class="match diff">서로 달라요</div>`;
    else if (mine) foot = `<div class="cwait">${ic("clock")}${esc(nm(ot))}님이 고르면 보여요</div>`;
    else if (theirs) foot = `<div class="cwait">${ic("lock")}${esc(nm(ot))}님은 골랐어요</div>`;
    return `<div class="q-card q-choice"><div class="cq"><span class="cn">${k + 1}</span>${esc(Q.q)}</div><div class="choices">${btns}</div>${foot}</div>`;
  }

  // ---------- 프로필 사진 (정사각형으로 잘라서 저장) ----------
  async function uploadAvatar(file) {
    try {
      const im = await loadImg(file);
      const sz = 320, c = document.createElement("canvas");
      c.width = c.height = sz;
      const m = Math.min(im.naturalWidth, im.naturalHeight);
      c.getContext("2d").drawImage(im, (im.naturalWidth - m) / 2, (im.naturalHeight - m) / 2, m, m, 0, 0, sz, sz);
      const data = c.toDataURL("image/jpeg", 0.85).split(",")[1];
      const r = await api("avatar", { method: "POST", body: { data } });
      S.avatars[S.who] = r.t;
      settingsSheet(); toast("프로필 사진을 바꿨어요");
      if (S.chat) drawChat();
      if (map) { Object.values(markers).forEach((mk) => mk.remove()); for (const k in markers) delete markers[k]; drawMap(); }
    } catch (e) { toast(e.message); }
  }

  // ---------- 추억: 공유 앨범 ----------
  const segHtml = () => `<div class="seg"><button class="${S.memView !== "cal" ? "on" : ""}" data-act="memView" data-v="album">${ic("image")}앨범</button><button class="${S.memView === "cal" ? "on" : ""}" data-act="memView" data-v="cal">${ic("cal")}캘린더</button></div>`;
  async function renderAlbum(more) {
    if (!more || !S.album) { spinner(); const d = await api("album"); S.album = { photos: d.photos, total: d.total }; }
    else { const d = await api(`album?offset=${S.album.photos.length}`); S.album.photos = S.album.photos.concat(d.photos); S.album.total = d.total; }
    if (S.tab !== "calendar" || S.memView === "cal") return;
    const ph = S.album.photos;
    let html = "", cur = "";
    ph.forEach((p, i) => {
      const ym = p.date.slice(0, 7);
      if (ym !== cur) {
        if (cur) html += `</div>`;
        cur = ym;
        html += `<div class="al-month">${+ym.slice(0, 4)}년 ${+ym.slice(5)}월</div><div class="al-grid">`;
      }
      html += `<button data-act="openAlbum" data-i="${i}"><img loading="lazy" src="/api/photo/${p.id}?thumb=1" alt=""><span>${+p.date.slice(8)}일</span></button>`;
    });
    if (cur) html += `</div>`;
    view.innerHTML = `
      ${segHtml()}
      <div class="al-head">
        <div><h2>우리 앨범</h2><span>${S.album.total}장의 추억</span></div>
        <button class="btn primary sm" data-act="albumUp">${ic("plus")}사진 올리기</button>
      </div>
      <input type="file" id="alInput" accept="image/*" multiple hidden>
      ${ph.length ? html : `<div class="card empty">${ic("image")}<br>아직 사진이 없어요<br>같이 찍은 사진을 올려보세요</div>`}
      ${ph.length < S.album.total ? `<button class="btn gray block" data-act="albumMore" style="margin-top:12px">더 보기</button>` : ""}`;
  }
  async function albumUpload(files) {
    const date = today();
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      toast(`사진 올리는 중 ${i + 1}/${files.length}`);
      try { const p = await prepPhoto(files[i]); await api("photos", { method: "POST", body: { date, ...p } }); ok++; }
      catch (e) { toast(e.message); }
    }
    S.album = null; S.calData = null;
    await render(true);
    if (ok) toast(`사진 ${ok}장을 올렸어요`);
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
      ${segHtml()}
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
  async function prepPhoto(file, thumbMax = 400) {
    const im = await loadImg(file);
    let f = draw(im, 1600, 0.82);
    if (f.b64.length > 1200000) f = draw(im, 1280, 0.72);
    if (f.b64.length > 1400000) f = draw(im, 1000, 0.65);
    const th = draw(im, thumbMax, 0.74);
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
        ${p.chat ? '<span style="width:40px"></span>' : `<button class="icon-btn" data-act="lbDel" aria-label="삭제">${ic("trash")}</button>`}
      </div>
      <div class="lb-img">
        <img src="${p.src || `/api/photo/${p.id}`}" alt="">
        ${S.lbIdx > 0 ? `<button class="nav l" data-act="lbNav" data-d="-1">${ic("left")}</button>` : ""}
        ${S.lbIdx < S.lbList.length - 1 ? `<button class="nav r" data-act="lbNav" data-d="1">${ic("right")}</button>` : ""}
      </div>
      <div class="lb-bot">${p.chat ? `<b>${esc(nm(p.who))}</b><span>${fmtTime(p.t)}</span>` : `<b>${fmtK(p.date)}${p.caption ? " · " + esc(p.caption) : ""}</b><span>${esc(nm(p.who))}님이 올림 · 우리 ${dplus(p.date)}일째</span>`}</div>`;
  }

  // ---------- 버킷리스트 (홈에서 여는 시트) ----------
  async function bucketSheet() {
    const { bucket } = await api("bucket");
    const done = bucket.filter((b) => b.done).length;
    const keep = $("#bkTitle") ? $("#bkTitle").value : "";
    openSheet(`
      <h2>${ic("list")}우리의 버킷리스트</h2>
      <p>${bucket.length ? `${bucket.length}개 중 ${done}개 이뤘어요` : "같이 하고 싶은 걸 적고 하나씩 이뤄봐요"}</p>
      <div class="progress" style="margin:4px 0 14px"><i style="width:${bucket.length ? (done / bucket.length) * 100 : 0}%"></i></div>
      <div class="add-row" style="margin-bottom:12px">
        <input type="text" id="bkTitle" placeholder="예: 같이 바다 보러 가기" maxlength="80" value="${esc(keep)}">
        <button class="btn primary" data-act="bkAdd" aria-label="추가">${ic("plus")}</button>
      </div>
      ${bucket.map((b) => `
        <div class="bk ${b.done ? "done" : ""}">
          <button class="ck" data-act="bkToggle" data-id="${b.id}" data-done="${b.done}" aria-label="완료">${ic("check")}</button>
          <div class="tt"><b>${esc(b.title)}</b><span>${b.done && b.done_date ? fmtDot(b.done_date) + " 이룸" : esc(nm(b.who)) + "의 소원"}</span></div>
          <button class="x" data-act="bkDel" data-id="${b.id}" aria-label="삭제">${ic("x")}</button>
        </div>`).join("") || `<div class="empty">첫 번째 버킷을 적어보세요</div>`}`);
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
      // 지명을 한국어로 + 가게/정류장 그림 아이콘은 숨겨서 깔끔하게
      for (const ly of map.getStyle().layers) {
        if (ly.type !== "symbol") continue;
        if (/^poi|airport|road_one_way|highway-shield|road_shield/.test(ly.id)) { map.setLayoutProperty(ly.id, "visibility", "none"); continue; }
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
      map.addSource("places", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "places-fill", type: "fill", source: "places", paint: { "fill-color": "#B65FE0", "fill-opacity": 0.12 } }, "link");
      map.addLayer({ id: "places-line", type: "line", source: "places", paint: { "line-color": "#B65FE0", "line-width": 2, "line-opacity": 0.6, "line-dasharray": [2, 1.5] } }, "link");
      mapLoaded = true;
      drawMap();
      loadPlaces();
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
      const html = `<div class="pinv">${avSrc(w) ? `<img src="${avSrc(w)}" alt="">` : esc(ini(w))}</div><div class="lb">${esc(nm(w))} · ${ago(l.t, S.locNow)}</div>`;
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
  // ---------- 장소 ----------
  const placeMarkers = [];
  function circlePoly(lat, lon, r) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      pts.push([lon + (r / (111320 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (r / 110540) * Math.sin(a)]);
    }
    return pts;
  }
  async function loadPlaces() {
    try {
      const d = await api("places");
      S.places = d.places; S.placeState = d.state;
      drawPlaces();
    } catch {}
  }
  function drawPlaces() {
    if (!map || !mapLoaded) return;
    map.getSource("places").setData({
      type: "FeatureCollection",
      features: (S.places || []).map((p) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [circlePoly(p.lat, p.lon, p.radius)] } })),
    });
    placeMarkers.splice(0).forEach((m) => m.remove());
    for (const p of S.places || []) {
      const el = document.createElement("div");
      el.className = "pl-mk";
      el.innerHTML = `${ic("pin")}${p.owner === "a" || p.owner === "b" ? esc(nm(p.owner)) + " · " : ""}${esc(p.name)}`;
      if (p.owner === "a" || p.owner === "b") el.classList.add("own-" + p.owner);
      placeMarkers.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p.lon, p.lat]).addTo(map));
    }
  }
  const ownerLabel = (o) => (o === "a" || o === "b" ? nm(o) : "둘 다");
  function placesSheet() {
    const insideOf = (pid) => (S.placeState || []).filter((x) => x.place_id === pid && x.inside).map((x) => x.who);
    openSheet(`
      <h2>${ic("pin")}우리 장소</h2>
      <p>등록한 장소에 도착하거나 떠나면 상대에게 알림이 가요. 화면이 꺼져 있을 때도 받으려면 OwnTracks 연결과 알림 켜기가 필요해요.</p>
      ${(S.places || []).map((p) => {
        const ins = insideOf(p.id);
        return `<div class="ev"><span class="bar" style="background:#B65FE0"></span><span class="tt">${esc(p.name)} <span class="own-tag ${p.owner || "both"}">${esc(ownerLabel(p.owner))}</span><br><small class="muted">반경 ${p.radius}m${ins.length ? " · 지금 " + ins.map((w) => esc(nm(w))).join(", ") + " 여기 있음" : ""}</small></span>
        <button class="x" data-act="placeGo" data-id="${p.id}" aria-label="보기">${ic("target")}</button>
        <button class="x" data-act="placeDel" data-id="${p.id}" aria-label="삭제">${ic("trash")}</button></div>`;
      }).join("") || `<div class="empty">아직 등록한 장소가 없어요<br>예: 학교, 학원, 우리 집</div>`}
      <div class="row2"><button class="btn gray" data-act="close">닫기</button><button class="btn primary" data-act="placePick">${ic("plus")}장소 추가</button></div>`);
  }
  function placePick() {
    closeSheet();
    const me = S.locs[S.who];
    if (me) map.flyTo({ center: [me.lon, me.lat], zoom: 16, offset: [0, -0.05 * innerHeight] });
    $("#mapCard").hidden = true;
    S.pickR = 50; S.pickOwner = S.who;
    const box = document.createElement("div");
    box.id = "pick";
    box.innerHTML = `<div class="pick-ring" id="pickRing"></div><div class="pick-dot"></div>
      <div class="pick-panel">
        <b>지도를 움직여서 가운데에 장소를 맞추세요</b>
        <div class="pick-r pick-own">
          <button class="on" data-act="pickOwn" data-o="${S.who}">${esc(nm(S.who))}</button>
          <button data-act="pickOwn" data-o="${other()}">${esc(nm(other()))}</button>
          <button data-act="pickOwn" data-o="both">둘 다</button>
        </div>
        <input type="text" id="pickName" placeholder="장소 이름 (예: 학교, 집)" maxlength="20" style="margin-top:10px">
        <div class="pick-r">${[50, 100, 200, 500].map((r) => `<button class="${r === 50 ? "on" : ""}" data-act="pickR" data-r="${r}">${r}m</button>`).join("")}</div>
        <div class="row2" style="margin-top:10px"><button class="btn gray" data-act="pickCancel">취소</button><button class="btn primary" data-act="pickSave">저장</button></div>
      </div>`;
    $("#mapWrap").appendChild(box);
    updatePickRing();
    map.on("zoom", updatePickRing);
  }
  function updatePickRing() {
    const ring = $("#pickRing");
    if (!ring || !map) return;
    const c = map.getCenter();
    const mPerPx = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * Math.pow(2, map.getZoom()));
    const px = Math.max(16, (S.pickR / mPerPx) * 2);
    ring.style.width = ring.style.height = px + "px";
  }
  function pickClose() { const b = $("#pick"); if (b) b.remove(); $("#mapCard").hidden = false; if (map) map.off("zoom", updatePickRing); }

  function fitMap() {
    const pts = ["a", "b"].map((w) => S.locs[w]).filter(Boolean).map((l) => [l.lon, l.lat]);
    if (!map || !pts.length) return;
    const pad = { top: 160, bottom: 380, left: 60, right: 60 };
    if (pts.length === 1) map.flyTo({ center: pts[0], zoom: 15 });
    else map.fitBounds([[Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1])], [Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])]], { padding: pad, maxZoom: 16 });
  }
  function renderMapCard() {
    const la = S.locs.a, lb = S.locs.b;
    const person = (w) => {
      const l = S.locs[w];
      return `<button class="person" data-act="flyTo" data-w="${w}">${av(w)}<div class="meta"><b>${esc(nm(w))}${w === S.who ? " (나)" : ""}</b>
        <span>${l ? `${ic("clock")}${ago(l.t, S.locNow)}${l.batt != null ? ` ${ic("batt")}${l.batt}%` : ""}` : "위치 없음"}</span></div></button>`;
    };
    const auto = S.autoLoc === "on" ? "이 화면을 열어두면 자동으로 공유돼요" : S.autoLoc === "denied" ? "위치 권한을 허용해야 공유돼요" : "위치 확인 중...";
    $("#mapCard").innerHTML = `
      <div class="dist">
        <div class="ic">${ic("route")}</div>
        <div>${S.together ? `<b>함께 있어요</b><span>${la && lb ? fmtDist(distM(la, lb)) + " 거리" : ""}</span>` : la && lb ? `<b>${fmtDist(distM(la, lb))}</b><span>지금 우리 사이 거리</span>` : `<b>-</b><span>둘 다 위치가 있어야 보여요</span>`}</div>
        <button class="icon-btn fit" data-act="fitMap" aria-label="모두 보기">${ic("target")}</button>
      </div>
      <div class="people">${person(S.who)}${person(other())}</div>
      <div class="auto-line"><i class="${S.autoLoc === "on" ? "on" : ""}"></i>${auto}</div>
      <div class="map-actions two">
        <button class="btn gray" data-act="placesSheet">${ic("pin")}장소 알림</button>
        <button class="btn gray" data-act="otSheet">${ic("phone")}화면 꺼도 공유</button>
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
  // 사이트를 열면 항상 자동으로 내 위치를 보냄 (50m 움직이거나 2분마다)
  function startAutoLoc() {
    if (S.watchId !== null || !navigator.geolocation) return;
    S.autoLoc = "wait";
    S.watchId = navigator.geolocation.watchPosition((p) => {
      S.autoLoc = "on";
      const now = Date.now(), cur = { lat: p.coords.latitude, lon: p.coords.longitude };
      const due = !S.lastSent || now - S.lastSent.t > 60000 || (now - S.lastSent.t > 10000 && distM(S.lastSent, cur) > 25);
      if (due) sendPos(p).catch(() => {});
      if (S.tab === "map" && !$("#pick")) renderMapCard();
    }, (e) => {
      if (e.code === 1) { S.autoLoc = "denied"; navigator.geolocation.clearWatch(S.watchId); S.watchId = null; }
      if (S.tab === "map") renderMapCard();
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  }
  function stopAutoLoc() { if (S.watchId !== null) { navigator.geolocation.clearWatch(S.watchId); S.watchId = null; } }



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
      const rx = Object.entries(m.reacts || {});
      const rxHtml = rx.length ? `<span class="dm-rx">${rx.map(([w, r]) => `<i class="${w} r-${r}">${ic(r)}</i>`).join("")}</span>` : "";
      const fresh = S.chat.seen && !S.chat.seen.has(m.id) ? " fresh" : "";
      const imgHtml = m.img || m.local
        ? `<img class="dm-img" src="${m.local || `/api/chatimg/${m.img}?thumb=1`}" style="aspect-ratio:${m.w || 4}/${m.h || 3}" data-img="${m.img || ""}" alt="">` : "";
      h += `<div class="dm-row ${mine ? "me" : "ot"}${first ? " first" : ""}${last ? " last" : ""}${rx.length ? " liked" : ""}${fresh}">
        ${mine ? "" : last ? av(m.who) : '<span class="av-sp"></span>'}
        <div class="dm-bub${imgHtml ? " has-img" : ""}${imgHtml && !m.text ? " only-img" : ""}" data-mid="${m.id}" data-mine="${mine ? 1 : 0}">${imgHtml}${m.text ? `<span class="tx">${linkify(esc(m.text))}</span>` : ""}${rxHtml}</div></div>`;
    });
    const lastM = ms[ms.length - 1];
    if (lastM.who === S.who && !String(lastM.id).startsWith("tmp")) {
      h += `<div class="dm-seen">${(S.chat.read[other()] || 0) >= lastM.id ? "읽음" : "전송됨"}</div>`;
    }
    L.innerHTML = h;
    S.chat.seen = new Set(ms.map((m) => m.id));
    if (stick || atBottom) {
      L.scrollTop = L.scrollHeight;
      L.querySelectorAll("img").forEach((im) => im.addEventListener("load", () => { if (stick || atBottom) L.scrollTop = L.scrollHeight; }, { once: true }));
    }
  }
  async function sendChat() {
    const inp = $("#dmText");
    const text = inp.value.trim();
    if (!text) return;
    inp.value = ""; $("#dmSend").hidden = true;
    S.chat.msgs.push({ id: "tmp" + Date.now(), who: S.who, text, reacts: {}, t: Date.now() });
    drawChat(true);
    try { await api("messages", { method: "POST", body: { text } }); }
    catch (e) { toast("전송 실패: " + e.message); inp.value = text; }
    refreshChat(true);
  }
  const RX = ["heart", "sparkle", "star", "fire", "like", "hug"];
  async function reactMsg(id, r, bub) {
    if (!id || String(id).startsWith("tmp")) return;
    if (bub) bub.insertAdjacentHTML("beforeend", `<svg class="dm-pop r-${r}"><use href="#i-${r}"/></svg>`);
    const m = S.chat.msgs.find((x) => String(x.id) === String(id));
    try {
      const res = await api(`messages/${id}/react`, { method: "POST", body: { r } });
      if (m) m.reacts = res.reacts;
      setTimeout(() => drawChat(), bub ? 650 : 0);
    } catch (e) { toast(e.message); }
  }
  async function sendChatPhotos(files) {
    for (const f of files) {
      const local = URL.createObjectURL(f);
      const tmp = { id: "tmp" + Date.now() + Math.random(), who: S.who, text: "", reacts: {}, t: Date.now(), local, w: 4, h: 3 };
      S.chat.msgs.push(tmp); drawChat(true);
      try {
        const p = await prepPhoto(f, 720);
        tmp.w = p.w; tmp.h = p.h;
        await api("messages", { method: "POST", body: { img: p } });
      } catch (e) { toast("사진 전송 실패: " + e.message); }
    }
    refreshChat(true);
  }
  // 반응 고르기 창
  function openRx(bub) {
    const id = bub.dataset.mid;
    if (String(id).startsWith("tmp")) return;
    const m = S.chat.msgs.find((x) => String(x.id) === id);
    const mineR = m && m.reacts ? m.reacts[S.who] : null;
    const rect = bub.getBoundingClientRect();
    const box = $("#rx");
    box.innerHTML = `<div class="rx-bg" data-act="rxClose"></div>
      <div class="rx-bar" style="top:${Math.max(70, rect.top - 64)}px">
        ${RX.map((r) => `<button class="${mineR === r ? "on" : ""} r-${r}" data-act="rxPick" data-r="${r}" data-id="${id}">${ic(r)}</button>`).join("")}
      </div>
      ${bub.dataset.mine === "1" ? `<button class="rx-del" style="top:${Math.min(innerHeight - 120, rect.bottom + 10)}px" data-act="rxDel" data-id="${id}">${ic("trash")}보내기 취소</button>` : ""}`;
    box.hidden = false;
    bub.classList.add("held");
    S.rxBub = bub;
  }
  function closeRx() { $("#rx").hidden = true; if (S.rxBub) S.rxBub.classList.remove("held"); S.rxBub = null; }
  // 두 번 톡 = 하트, 길게 누르기 = 반응/보내기 취소, 사진 톡 = 크게 보기
  (() => {
    let lastTap = { id: null, t: 0 }, pressT = null, opened = false, tapTimer = null;
    const L = $("#dmList");
    L.addEventListener("click", (e) => {
      const bub = e.target.closest(".dm-bub");
      if (!bub || e.target.closest("a") || opened) { opened = false; return; }
      const now = Date.now();
      if (lastTap.id === bub.dataset.mid && now - lastTap.t < 320) {
        clearTimeout(tapTimer);
        reactMsg(bub.dataset.mid, "heart", bub);
        lastTap = { id: null, t: 0 };
        return;
      }
      lastTap = { id: bub.dataset.mid, t: now };
      const im = e.target.closest(".dm-img");
      if (im && im.dataset.img) {
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => {
          const list = S.chat.msgs.filter((m) => m.img).map((m) => ({ src: `/api/chatimg/${m.img}`, chat: true, who: m.who, t: m.t, id: m.img }));
          openLightbox(list, Math.max(0, list.findIndex((x) => String(x.id) === im.dataset.img)));
        }, 330);
      }
    });
    L.addEventListener("touchstart", (e) => {
      const bub = e.target.closest(".dm-bub");
      if (!bub) return;
      pressT = setTimeout(() => { pressT = null; opened = true; try { navigator.vibrate && navigator.vibrate(10); } catch {} openRx(bub); }, 450);
    }, { passive: true });
    const cancel = () => { if (pressT) { clearTimeout(pressT); pressT = null; } };
    L.addEventListener("touchend", cancel); L.addEventListener("touchmove", cancel, { passive: true });
    L.addEventListener("contextmenu", (e) => { const bub = e.target.closest(".dm-bub"); if (bub) { e.preventDefault(); openRx(bub); } });
  })();
  $("#dmFile").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; if (f.length) sendChatPhotos(f); });
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

  // ---------- 폰 맞대기 ----------
  const T = { polling: null, near: null };
  // 처음 화면을 터치할 때 소리 감지 시작 (아이폰은 열 때마다 마이크 허용을 한 번 물어봄)
  const onGesture = () => {}; // 소리 감지(마이크)는 사용 안 함
  document.addEventListener("click", onGesture, true);
  document.addEventListener("touchend", onGesture, true);

  // 서버 시계와 내 시계 차이 (두 폰이 같은 순간에 재생하려고)
  S.clockOff = 0;
  async function timedApi(path, opt) {
    const t0 = Date.now();
    const r = await api(path, opt);
    const t1 = Date.now();
    if (r && r.now && t1 - t0 < 1500) S.clockOff = r.now - (t0 + t1) / 2;
    return r;
  }
  // 정해진 재생 시각(서버 기준)에 맞춰 애니메이션 시작
  function scheduleFx(touch, at, kind) {
    if (!touch || touch <= S.lastTouchSeen) return;
    S.lastTouchSeen = touch;
    S.fxKind = kind || "near";
    const wait = (at || touch) - S.clockOff - Date.now();
    if (wait < -2500 && kind !== "meet") return; // 너무 늦게 알았으면 생략 (만남은 늦어도 보여줌)
    if (wait < -60000) return;
    setTimeout(() => playFx(touch), Math.max(0, wait));
  }
  async function sendTouch(kind) {
    try {
      const r = await timedApi("touch", { method: "POST", body: { kind } });
      if (r.match) return scheduleFx(r.touch, r.at, "near");
    } catch {}
  }
  const HEART = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 21s-7.8-4.8-9.6-9.7C1.1 7.6 3.4 4 7 4c2.1 0 3.7 1.1 5 3 1.3-1.9 2.9-3 5-3 3.6 0 5.9 3.6 4.6 7.3C19.8 16.2 12 21 12 21z"/></svg>`;
  function playFx(t) {
    S.lastTouchSeen = Math.max(S.lastTouchSeen, t || Date.now());
    const fx = $("#fx");
    const R = (a, b) => a + Math.random() * (b - a);
    const grad = (id, c1, c2) => `<svg viewBox="0 0 24 24"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><path fill="url(#${id})" d="M12 21s-7.8-4.8-9.6-9.7C1.1 7.6 3.4 4 7 4c2.1 0 3.7 1.1 5 3 1.3-1.9 2.9-3 5-3 3.6 0 5.9 3.6 4.6 7.3C19.8 16.2 12 21 12 21z"/></svg>`;
    const floaters = Array.from({ length: 12 }, () => `<span style="left:${R(6, 90)}%;--sz:${R(12, 24).toFixed(0)}px;--dur:${R(3, 4.4).toFixed(2)}s;--dl:${R(0.9, 2.2).toFixed(2)}s;--sw:${R(-30, 30).toFixed(0)}px">${HEART}</span>`).join("");
    fx.innerHTML = `
      <div class="fx-h l">${grad("fxa", "#FFB3C6", "#F2668B")}</div>
      <div class="fx-h r">${grad("fxb", "#D9C8FF", "#9B7CF6")}</div>
      <div class="fx-ripple"></div>
      <div class="fx-big">${grad("fxc", "#FF9BB4", "#C86BE6")}</div>
      <div class="fx-float">${floaters}</div>
      <div class="fx-text"><b>${S.fxKind === "meet" ? "우리 만났어요" : S.fxKind === "tap" ? "마음이 통했어요" : "우리 지금 닿았어요"}</b><span>${esc(nm("a"))} ${ic("heart")} ${esc(nm("b"))}</span></div>`;
    fx.hidden = false;
    fx.classList.remove("out");
    try { navigator.vibrate && navigator.vibrate([30, 80, 30]); } catch {}
    clearTimeout(playFx.t); clearTimeout(playFx.t2);
    const close = () => { fx.classList.add("out"); playFx.t2 = setTimeout(() => (fx.hidden = true), 500); };
    playFx.t = setTimeout(close, 4200);
    fx.onclick = close;
  }



  // ---------- 폰 맞대기: 가까이 감지(초음파, 사이트 켜면 자동) ----------
  const FREQ = { a: 18000, b: 18900 };
  const nearEnabled = () => store.get("cp_near") !== "0";
  // 기본 감도: 폰끼리 거의 붙여야 반응 (예전 값은 무시)
  const sensThr = () => Number(store.get("cp_sens2") || 32);
  function nearStatusText() {
    if (!nearEnabled()) return "소리 감지 꺼짐";
    if (T.nearDenied) return "마이크가 거부됐어요. 사이트를 다시 열고 허용해 주세요";
    if (T.near && T.actx && T.actx.state !== "running") return "화면을 한 번 터치하면 소리가 시작돼요";
    if (T.near) return "듣는 중";
    return "화면을 터치하면 시작돼요";
  }
  async function startNear() {
    // 이미 켜져 있는데 오디오가 멈춰 있으면 터치 순간에 다시 재생
    if (T.actx && T.actx.state !== "running") { try { T.actx.resume(); } catch {} }
    if (T.near || T.nearBusy || T.nearDenied || !nearEnabled() || document.hidden || !S.who) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { T.nearDenied = true; return; }
    T.nearBusy = true;
    try {
      try { if (navigator.audioSession) navigator.audioSession.type = "play-and-record"; } catch {}
      // 아이폰은 터치한 그 순간에 오디오를 시작해야 소리가 나서, 마이크보다 먼저 켬
      const ctx = T.actx && T.actx.state !== "closed" ? T.actx : new (window.AudioContext || window.webkitAudioContext)();
      T.actx = ctx;
      ctx.resume();
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = FREQ[S.who];
      gain.gain.value = 0.6;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (ctx.state !== "running") { try { await ctx.resume(); } catch {} }
      const an = ctx.createAnalyser();
      an.fftSize = 8192; an.smoothingTimeConstant = 0.3;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.frequencyBinCount);
      const binHz = ctx.sampleRate / an.fftSize;
      const snrAt = (f) => {
        const tb = Math.round(f / binHz);
        // 소리가 완전히 없으면 -Infinity가 나와서 값이 튀지 않게 막음
        const v = (i) => (Number.isFinite(buf[i]) ? Math.max(buf[i], -140) : -140);
        let peak = -140; for (let i = tb - 2; i <= tb + 2; i++) peak = Math.max(peak, v(i));
        let nz = 0, c = 0;
        for (let i = tb - 50; i < tb - 15; i++) { nz += v(i); c++; }
        for (let i = tb + 15; i < Math.min(buf.length, tb + 50); i++) { nz += v(i); c++; }
        // 너무 작은 소리는 무시 (멀리서 희미하게 들리는 경우)
        if (peak < -85) return 0;
        return Math.max(0, peak - nz / c);
      };
      let hits = 0, lastNear = 0, tick = 0;
      const loop = setInterval(() => {
        an.getFloatFrequencyData(buf);
        const snr = snrAt(FREQ[other()]);
        const self = snrAt(FREQ[S.who]);
        const bar = $("#sensBar"), sb = $("#selfBar");
        if (bar) bar.style.width = Math.min(100, (snr / 50) * 100) + "%";
        if (sb) sb.style.width = Math.min(100, (self / 50) * 100) + "%";
        if (++tick % 15 === 0) { const ns = $("#nearStat"); if (ns) ns.textContent = nearStatusText(); }
        hits = snr > sensThr() ? hits + 1 : 0;
        if (hits >= 5 && Date.now() - lastNear > 1500) { lastNear = Date.now(); hits = 0; sendTouch("near"); }
      }, 60);
      const beat = setInterval(() => {}, 60000);
      // 상대 폰이 먼저 성공을 받았을 수 있어서 자주 확인 (재생은 정해진 시각에 같이)
      const poll = setInterval(async () => {
        if (document.hidden) return;
        const r = await timedApi("touch").catch(() => null);
        if (r && r.touch > S.lastTouchSeen && Date.now() - S.clockOff - r.touch < 6000) scheduleFx(r.touch, r.at, r.kind);
      }, 500);
      T.near = { stream, ctx, osc, loop, beat, poll };
    } catch (e) {
      if (e && e.name === "NotAllowedError") T.nearDenied = true; // 거부하면 다시 열 때까지 안 물어봄
    } finally { T.nearBusy = false; }
  }
  function nearStop() {
    const n = T.near;
    if (!n) return;
    clearInterval(n.loop); clearInterval(n.beat); clearInterval(n.poll);
    try { n.osc.stop(); } catch {}
    n.stream.getTracks().forEach((t) => t.stop());
    n.ctx.close().catch(() => {});
    T.actx = null;
    try { if (navigator.audioSession) navigator.audioSession.type = "auto"; } catch {}
    T.near = null;
  }
  // 다른 앱으로 가면 끄고, 돌아와서 터치하면 다시 켬
  document.addEventListener("visibilitychange", () => { if (document.hidden) nearStop(); });

  // ---------- 폰 붙이고 쓸기 ----------
  const SW = { open: false, poll: null, ctx: null, pts: [], raf: 0 };
  function swOpen() {
    const el = $("#sw");
    el.innerHTML = `
      <canvas id="swc"></canvas>
      <div class="sw-edge l"></div><div class="sw-edge r"></div>
      <div class="sw-top">
        <button class="icon-btn" data-act="swClose" aria-label="닫기">${ic("x")}</button>
      </div>
      <div class="sw-guide">
        <div class="sw-ph"><i></i><i></i></div>
        <b>폰을 옆으로 딱 붙이고</b>
        <span>한 화면에서 옆 화면으로 손가락을 쭉 밀어 넘기세요<br>${esc(nm(other()))}님도 이 화면을 열어둬야 해요</span>
      </div>
      <button class="sw-tap" data-act="tapHeart">${ic("heart")}떨어져 있으면 같이 누르기</button>`;
    el.hidden = false;
    SW.open = true;
    const c = $("#swc");
    const fit = () => { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; };
    fit(); SW.fit = fit; addEventListener("resize", fit);
    SW.ctx = c.getContext("2d");
    SW.pts = [];
    cancelAnimationFrame(SW.raf);
    const draw = () => {
      const g = SW.ctx, d = devicePixelRatio, now = performance.now();
      g.clearRect(0, 0, c.width, c.height);
      SW.pts = SW.pts.filter((p) => now - p.t < 650);
      for (const p of SW.pts) {
        const a = 1 - (now - p.t) / 650;
        const grd = g.createRadialGradient(p.x * d, p.y * d, 0, p.x * d, p.y * d, 26 * d * a + 4);
        grd.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
        grd.addColorStop(0.4, `rgba(255,140,175,${0.6 * a})`);
        grd.addColorStop(1, "rgba(200,110,230,0)");
        g.fillStyle = grd;
        g.beginPath(); g.arc(p.x * d, p.y * d, 26 * d * a + 4, 0, Math.PI * 2); g.fill();
      }
      if (SW.open) SW.raf = requestAnimationFrame(draw);
    };
    draw();
    // 상대 폰에서 먼저 성공을 받았을 수 있어서 자주 확인
    clearInterval(SW.poll);
    SW.poll = setInterval(async () => {
      if (document.hidden) return;
      const r = await timedApi("touch").catch(() => null);
      if (r && r.touch > S.lastTouchSeen && Date.now() - S.clockOff - r.touch < 6000) scheduleFx(r.touch, r.at, r.kind);
    }, 500);
    bindSwipe(c);
  }
  function swClose() {
    SW.open = false; clearInterval(SW.poll); cancelAnimationFrame(SW.raf);
    removeEventListener("resize", SW.fit);
    $("#sw").hidden = true; $("#sw").innerHTML = "";
  }
  function bindSwipe(c) {
    const EDGE = 30;
    let stroke = null;
    const edgeOf = (x) => (x <= EDGE ? "l" : x >= innerWidth - EDGE ? "r" : null);
    const send = async (dir, edge, tLocal) => {
      try {
        const r = await timedApi("touch", { method: "POST", body: { kind: "swipe", dir, edge, t: tLocal + S.clockOff } });
        if (r.match) scheduleFx(r.touch, r.at, "swipe");
      } catch {}
    };
    c.addEventListener("pointerdown", (e) => {
      const edge = edgeOf(e.clientX);
      stroke = { x: e.clientX, y: e.clientY, t: Date.now(), start: edge, last: { x: e.clientX, y: e.clientY, t: Date.now() }, vx: 0, sentExit: false };
      SW.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (edge) { send("e", edge, Date.now()); $(".sw-edge." + edge).classList.add("hit"); setTimeout(() => $(".sw-edge." + edge) && $(".sw-edge." + edge).classList.remove("hit"), 500); }
    });
    c.addEventListener("pointermove", (e) => {
      if (!stroke) return;
      const now = Date.now(), dt = Math.max(1, now - stroke.last.t);
      stroke.vx = (e.clientX - stroke.last.x) / dt;
      stroke.last = { x: e.clientX, y: e.clientY, t: now };
      SW.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      // 화면 끝까지 밀고 나가는 순간
      const edge = edgeOf(e.clientX);
      if (!stroke.sentExit && edge && edge !== stroke.start && Math.abs(stroke.vx) > 0.15 && ((edge === "r" && stroke.vx > 0) || (edge === "l" && stroke.vx < 0))) {
        stroke.sentExit = true;
        send("x", edge, now);
        $(".sw-edge." + edge).classList.add("hit");
        setTimeout(() => $(".sw-edge." + edge) && $(".sw-edge." + edge).classList.remove("hit"), 500);
      }
    });
    const end = () => { stroke = null; };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  // ---------- 알림 ----------
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      S.swReg = await navigator.serviceWorker.register("/sw.js");
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data && e.data.type === "open") { const t = (e.data.url.split("#")[1] || "home"); setTab(t); }
      });
      // 이미 허용했으면 구독 정보를 다시 서버에 알려줌
      if (window.Notification && Notification.permission === "granted") subscribePush(true);
    } catch {}
  }
  function pushState() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.Notification) {
      return isIOS && !isStandalone() ? "needs-home" : "unsupported";
    }
    return Notification.permission; // default | granted | denied
  }
  const b64ToU8 = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
  async function subscribePush(silent) {
    try {
      const reg = S.swReg || (await navigator.serviceWorker.ready);
      const { key } = await api("push");
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
      await api("push/sub", { method: "POST", body: sub.toJSON() });
      if (!silent) toast("알림을 켰어요");
    } catch (e) { if (!silent) toast("알림을 켤 수 없어요: " + e.message); }
  }
  async function enablePush() {
    const st = pushState();
    if (st === "needs-home") return toast("아이폰은 홈 화면에 추가한 앱에서만 알림이 돼요");
    if (st === "unsupported") return toast("이 브라우저는 알림을 지원하지 않아요");
    if (st === "denied") return toast("알림이 차단돼 있어요. 설정에서 허용해 주세요");
    const r = await Notification.requestPermission();
    if (r === "granted") { await subscribePush(); settingsSheet(); }
    else toast("알림을 허용하지 않았어요");
  }
  function showBanner(title, body, tab) {
    const b = $("#banner");
    b.innerHTML = `<span class="bn-ic">${ic(tab === "map" ? "pin" : "msg")}</span><span class="bn-t"><b>${esc(title)}</b><span>${esc(body)}</span></span>`;
    b.dataset.act = "bannerGo";
    S.bannerTab = tab;
    b.hidden = false;
    b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
    clearTimeout(showBanner.t);
    showBanner.t = setTimeout(() => (b.hidden = true), 4500);
  }

  // ---------- 시트 ----------
  function openSheet(html) { $("#sheetBox").innerHTML = html; $("#sheet").hidden = false; }
  function closeSheet() { $("#sheet").hidden = true; }
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });

  function otSheet() {
    const url = `${location.origin}/api/owntracks`;
    openSheet(`
      <h2>${ic("phone")}화면 꺼도 위치 공유</h2>
      <p>무료 앱 <b>OwnTracks</b>에서 왼쪽 위 <b>(i)</b> ${ic("right", "arr")} <b>Settings</b>로 들어가 아래처럼 입력하세요.</p>
      <div class="kv"><span class="k">Mode</span><span class="v">HTTP</span></div>
      <div class="kv"><span class="k">URL</span><span class="v" id="kvUrl">${esc(url)}</span><button data-act="copy" data-t="kvUrl">${ic("copy")}</button></div>
      <div class="kv"><span class="k">Authentication</span><span class="v">켜기 (ON)</span></div>
      <div class="kv"><span class="k">UserID</span><span class="v" id="kvUser">${S.who}</span><button data-act="copy" data-t="kvUser">${ic("copy")}</button></div>
      <div class="kv"><span class="k">Password</span><span class="v">로그인 비밀번호</span></div>
      <div class="kv"><span class="k">DeviceID</span><span class="v">phone</span></div>
      <p class="note">UserID는 한글 이름 말고 꼭 <b>${S.who}</b> (${esc(nm("a"))} = a, ${esc(nm("b"))} = b). 지도 위 모드는 <b>Move</b>, 위치 권한은 <b>항상 허용</b>으로 해두면 가장 확실해요.</p>
      <div class="row2"><button class="btn gray" data-act="close">닫기</button></div>`);
  }



  document.addEventListener("input", (e) => { if (e.target.id === "sensRange") store.set("cp_sens2", String(62 - Number(e.target.value))); });
  async function nfcSheet() {
    let link = "";
    try { link = (await api("nfclink")).url; } catch {}
    openSheet(`
      <h2>${ic("phone")}폰 맞대기 설정</h2>
      <p>아이폰은 화면이 켜져 있으면 NFC 스티커를 저절로 읽어요. 그래서 각자 폰 뒤에 스티커를 붙이고, 상대 스티커를 읽으면 이 링크가 열리게 해두면 돼요. 앱 설치도 권한도 필요 없어요.</p>
      <div class="nfc-step"><b>1</b><div><strong>NFC 스티커 준비</strong><span>NTAG213/215 스티커 2개 (쿠팡·다이소 등, 개당 수백 원). 각자 폰 케이스 <b>뒷면 위쪽</b>에 붙여요.</span></div></div>
      <div class="nfc-step"><b>2</b><div><strong>내 맞대기 링크 복사</strong><span>${esc(nm(S.who))}님 전용 링크예요. 남한테 보여주지 마세요.</span>
        <div class="kv" style="margin-top:8px"><span class="v" id="nfcLink">${esc(link)}</span><button data-act="copy" data-t="nfcLink">${ic("copy")}</button></div></div></div>
      <div class="nfc-step"><b>3</b><div><strong>단축어 자동화 만들기</strong><span>단축어 앱 ${ic("right", "arr")} 자동화 ${ic("right", "arr")} 새로운 자동화 ${ic("right", "arr")} <b>NFC</b> ${ic("right", "arr")} 스캔을 누르고 <b>${esc(nm(other()))}님 폰 뒤의 스티커</b>에 내 폰을 대요 ${ic("right", "arr")} 이름 정하기 ${ic("right", "arr")} <b>즉시 실행</b> 선택 ${ic("right", "arr")} 새로운 빈 단축어 ${ic("right", "arr")} 동작 추가에서 <b>URL 열기</b> ${ic("right", "arr")} 2번 링크 붙여넣기</span></div></div>
      <div class="nfc-step"><b>4</b><div><strong>맞대기</strong><span>둘 다 화면을 켜고(잠금 해제) 폰 뒷면 위쪽끼리 맞대면 두 폰에서 동시에 터져요.</span></div></div>
      <p class="note">${esc(nm(other()))}님도 자기 폰에서 똑같이 하되, 3번에서 <b>${esc(nm(S.who))}님 폰의 스티커</b>를 스캔해야 해요. 비밀번호를 바꾸면 링크도 바뀌니까 단축어의 링크를 새로 넣어주세요.</p>
      <div class="row2"><button class="btn gray" data-act="close">닫기</button></div>`);
  }
  function settingsSheet() {
    openSheet(`
      <h2>${ic("gear")}설정</h2>
      <div class="me-av">
        <button class="me-av-pic" data-act="avatarPick" aria-label="프로필 사진 바꾸기">${av(S.who, "xl")}<span class="cam">${ic("camera")}</span></button>
        <div><b>${esc(nm(S.who))}</b><span>프로필 사진을 눌러서 바꿀 수 있어요</span>${avSrc(S.who) ? `<button class="link" data-act="avatarDel">사진 지우기</button>` : ""}</div>
        <input type="file" id="avInput" accept="image/*" hidden>
      </div>
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
      <h2 style="font-size:16px;margin-top:4px">${ic("bell")}알림</h2>
      ${(() => {
        const st = pushState();
        if (st === "granted") return `<p class="muted" style="font-size:13px">이 기기에서 메시지와 장소 도착/출발 알림을 받아요.</p><div class="row2"><button class="btn soft" data-act="pushTest">테스트 알림 보내기</button></div>`;
        if (st === "needs-home") return `<p class="note">아이폰은 Safari 공유 버튼 ${ic("right", "arr")} <b>홈 화면에 추가</b>로 앱을 설치한 뒤, 그 앱에서 알림을 켜야 해요 (iOS 16.4 이상).</p>`;
        if (st === "denied") return `<p class="note">알림이 차단돼 있어요. 아이폰 설정 ${ic("right", "arr")} 알림 ${ic("right", "arr")} 이 앱에서 허용해 주세요.</p>`;
        if (st === "unsupported") return `<p class="muted" style="font-size:13px">이 브라우저는 알림을 지원하지 않아요.</p>`;
        return `<div class="row2"><button class="btn primary" data-act="pushOn">${ic("bell")}알림 켜기</button></div>`;
      })()}
      <hr>
      <h2 style="font-size:16px;margin-top:4px">${ic("heart")}폰 맞대기</h2>
      <p class="muted" style="font-size:13px">두 폰 뒷면을 맞대면 같은 순간 애니메이션이 나와요. NFC 스티커와 단축어 앱으로 한 번만 설정하면 돼요.</p>
      <div class="row2"><button class="btn primary" data-act="nfcSheet">${ic("phone")}맞대기 설정하기</button></div>
      <hr>
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
    bucketOpen: () => bucketSheet(),
    swOpen: () => swOpen(),
    swClose: () => swClose(),
    nfcSheet: () => nfcSheet(),
    async tapHeart(el) {
      el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse");
      try { navigator.vibrate && navigator.vibrate(15); } catch {}
      const sent = Date.now();
      try {
        const r = await timedApi("touch", { method: "POST", body: { kind: "tap" } });
        if (r.match) return scheduleFx(r.touch, r.at, "tap");
      } catch {}
      toast(`${nm(other())}님도 같이 누르면 터져요`);
      // 상대가 조금 늦게 누를 수 있어서 잠깐 확인
      let n = 0;
      clearInterval(S.tapPoll);
      S.tapPoll = setInterval(async () => {
        if (++n > 8) return clearInterval(S.tapPoll);
        const r = await timedApi("touch").catch(() => null);
        if (r && r.touch > S.lastTouchSeen && r.touch >= sent - 3000) { clearInterval(S.tapPoll); scheduleFx(r.touch, r.at, r.kind); }
      }, 400);
    },
    annivSheet: () => annivSheetList(),
    avatarPick: () => $("#avInput").click(),
    async avatarDel() {
      await api("avatar", { method: "DELETE" });
      delete S.avatars[S.who]; settingsSheet(); setBrand(); toast("프로필 사진을 지웠어요");
    },
    albumGo() { S.memView = "album"; setTab("calendar"); },
    memView(el) { S.memView = el.dataset.v; render(); },
    albumUp: () => $("#alInput").click(),
    albumMore: () => renderAlbum(true),
    openAlbum(el) { openLightbox(S.album.photos, Number(el.dataset.i)); },
    dmSend: () => sendChat(),
    dmPhoto: () => $("#dmFile").click(),
    rxClose: closeRx,
    rxPick(el) { const bub = S.rxBub; closeRx(); reactMsg(el.dataset.id, el.dataset.r, bub); },
    async rxDel(el) {
      closeRx();
      await api(`messages/${el.dataset.id}`, { method: "DELETE" }).catch(() => {});
      S.chat.msgs = S.chat.msgs.filter((m) => String(m.id) !== el.dataset.id);
      drawChat();
    },
    pushOn: () => enablePush(),
    placesSheet: () => placesSheet(),
    placePick: () => placePick(),
    pickCancel: () => pickClose(),
    pickOwn(el) { S.pickOwner = el.dataset.o; $$(".pick-own button").forEach((b) => b.classList.toggle("on", b === el)); },
    pickR(el) { S.pickR = Number(el.dataset.r); $$(".pick-r:not(.pick-own) button").forEach((b) => b.classList.toggle("on", b === el)); updatePickRing(); },
    async pickSave() {
      const name = $("#pickName").value.trim();
      if (!name) return toast("장소 이름을 적어주세요");
      // 화면의 점 위치를 그대로 좌표로 바꿈 (지도 가운데와 점 위치가 달라서 생기던 오차 수정)
      const dr = $(".pick-dot").getBoundingClientRect(), mr = map.getContainer().getBoundingClientRect();
      const c = map.unproject([dr.left + dr.width / 2 - mr.left, dr.top + dr.height / 2 - mr.top]);
      try {
        await api("places", { method: "POST", body: { name, lat: c.lat, lon: c.lng, radius: S.pickR, owner: S.pickOwner } });
        pickClose(); await loadPlaces(); toast(`${name}을(를) 등록했어요`);
      } catch (e) { toast(e.message); }
    },
    async placeDel(el) {
      if (!confirm("이 장소를 지울까요?")) return;
      await api(`places/${el.dataset.id}`, { method: "DELETE" });
      await loadPlaces(); placesSheet();
    },
    placeGo(el) {
      const p = (S.places || []).find((x) => String(x.id) === el.dataset.id);
      closeSheet();
      if (p) map.flyTo({ center: [p.lon, p.lat], zoom: 15.5 });
    },
    async pushTest() {
      try { const r = await api("push/test", { method: "POST", body: {} }); toast(r.sent ? "테스트 알림을 보냈어요" : "이 기기는 알림이 꺼져 있어요"); }
      catch (e) { toast(e.message); }
    },
    bannerGo() { $("#banner").hidden = true; setTab(S.bannerTab || "chat"); },
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
    toggleNear() {
      const on = !nearEnabled();
      store.set("cp_near", on ? "1" : "0");
      if (on) { T.nearDenied = false; startNear(); } else nearStop();
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
      if (el.disabled) return;
      $$(`[data-act="pickC"][data-date="${el.dataset.date}"][data-slot="${el.dataset.slot}"]`).forEach((b) => (b.disabled = true));
      el.classList.add("mine", "pop");
      try {
        await api("answers", { method: "POST", body: { qdate: el.dataset.date, slot: el.dataset.slot, answer: el.dataset.v } });
      } catch (e) { toast(e.message); }
      setTimeout(() => render(true), 350);
    },
    qMore() { S.qDays = (S.qDays || 30) + 30; render(true); },
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
      if (!$("#sheet").hidden && $("#sheetBox").textContent.includes("다가오는 기념일")) annivSheetList();
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
        S.calData = null; S.album = null; render(true);
      } catch (e) { toast(e.message); }
    },

    // 버킷
    async bkAdd() {
      const title = $("#bkTitle").value.trim();
      if (!title) return toast("하고 싶은 걸 적어주세요");
      $("#bkTitle").value = "";
      await api("bucket", { method: "POST", body: { title } });
      bucketSheet();
    },
    async bkToggle(el) {
      const done = el.dataset.done !== "1";
      await api(`bucket/${el.dataset.id}`, { method: "POST", body: { done, date: today() } });
      if (done) toast("하나 이뤘어요!");
      bucketSheet();
    },
    async bkDel(el) {
      if (!confirm("이 버킷을 지울까요?")) return;
      await api(`bucket/${el.dataset.id}`, { method: "DELETE" });
      bucketSheet();
    },

    // 지도
    async sendNow() {
      toast("위치 찾는 중...");
      try { await sendPos(await getPos()); toast("내 위치를 보냈어요"); }
      catch (e) { toast(e.code ? geoMsg(e) : e.message); }
    },

    otSheet,
    async otSetup() {
      const pw = $("#otPw").value;
      if (!pw) return toast("비밀번호를 입력하세요");
      const u8 = new TextEncoder().encode(`${S.who}:${pw}`);
      const basic = btoa(String.fromCharCode(...u8));
      const r = await fetch("/api/owntracks", { method: "POST", headers: { authorization: "Basic " + basic, "content-type": "application/json" }, body: "{}" });
      if (r.status === 401) return toast("비밀번호가 틀렸어요");
      const conf = {
        _type: "configuration", mode: 3, url: location.origin + "/api/owntracks",
        auth: true, username: S.who, password: pw, deviceId: "phone", tid: S.who.toUpperCase(),
        monitoring: 2, locatorDisplacement: 50, locatorInterval: 120, ignoreInaccurateLocations: 150,
        allowRemoteLocation: true, cmd: true,
      };
      const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(conf))));
      location.href = "owntracks:///config?inline=" + encodeURIComponent(b64);
      setTimeout(() => toast("OwnTracks가 안 열리면 앱을 먼저 설치하세요"), 1500);
    },
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
    if (e.target.id === "alInput" && e.target.files.length) albumUpload([...e.target.files]);
    if (e.target.id === "avInput" && e.target.files.length) uploadAvatar(e.target.files[0]);
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
      S.who = me.who; S.names = me.names; S.start = me.start; S.created = me.created; S.avatars = me.avatars || {};
      setBrand();
      await loadAnniv();
      showOnly("app");
      await pulse(true);
      S.lastSent = null; startAutoLoc();
      setTab(TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home");
      registerSW();
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
      if (first) {
        S.lastTouchSeen = p.touch;
        S.together = p.together;
        S.lastBannerMsg = p.last ? p.last.id : 0;
        S.lastPlaceSeen = p.place ? p.place.t : 0;
        return;
      }
      if (p.now) S.clockOff = p.now - Date.now();
      const lim = p.kind === "meet" ? 60000 : 6000;
      if (p.touch > S.lastTouchSeen && Date.now() - S.clockOff - p.touch < lim) scheduleFx(p.touch, p.at, p.kind);
      if (S.together !== p.together) { S.together = p.together; if (S.tab === "home") render(true); if (S.tab === "map") renderMapCard(); }
      if (unread && p.last.id > (S.lastBannerMsg || 0) && S.tab !== "chat") {
        showBanner(nm(p.last.who), p.last.text || "사진을 보냈어요", "chat");
      }
      if (p.last) S.lastBannerMsg = Math.max(S.lastBannerMsg || 0, p.last.id);
      if (p.place && p.place.t > (S.lastPlaceSeen || 0)) {
        S.lastPlaceSeen = p.place.t;
        if (p.place.who !== S.who) showBanner(`${nm(p.place.who)}님 ${p.place.inside ? "도착" : "출발"}`, p.place.inside ? `${p.place.place}에 도착했어요` : `${p.place.place}에서 떠났어요`, "map");
      }
    } catch {}
  }
  setInterval(() => { if (!document.hidden) pulse(); }, 10000);

  // 위치 자동 새로고침
  setInterval(() => { if (!document.hidden && S.tab === "map" && S.who) refreshLoc(); }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !S.who) return;
    pulse();
    api("me").then((m) => { S.avatars = m.avatars || {}; }).catch(() => {});
    S.lastSent = null; stopAutoLoc(); startAutoLoc();
    if (S.tab === "chat" && S.chat) refreshChat(); else if (S.tab === "map") refreshLoc(); else if (S.tab === "home" || S.tab === "question") render(true);
  });

  boot();
})();
