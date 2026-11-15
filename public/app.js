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
  const S = { sat: (() => { try { return !!localStorage.getItem("sat"); } catch { return false; } })(),
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
    t.classList.remove("out");
    clearTimeout(toast.t); clearTimeout(toast.t2);
    toast.t = setTimeout(() => { t.classList.add("out"); toast.t2 = setTimeout(() => { t.hidden = true; t.classList.remove("out"); }, 220); }, 2200);
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
  const qIndex = (date) => Math.max(0, diff(QBASE, date));
  // 질문 날짜는 아침 6시에 바뀜 (새벽 1시는 아직 전날 질문)
  const qToday = () => ymd(new Date(Date.now() - 6 * 3600e3));
  const QBASE = "2026-11-15";
  const TS = "s"; // 서술형 슬롯
  const CSLOTS = ["k1", "k2", "k3", "k4"];
  const ALL_SLOTS = [TS, ...CSLOTS];
  // 11월 15일 전 질문은 그때 쓰던 목록으로 다시 만들어서 보여줌
  const isOld = (date) => date < QBASE;
  const OLD_C = ["c1", "c2", "c3"];
  const oldFor = (date, slot) => {
    const O = window.QOLD; if (!O) return { q: "지난 질문", a: ["", ""] };
    const i = Math.max(0, diff(S.created || date, date));
    if (slot === "t" || slot === TS) return { q: O.text(i) };
    return O.choice(i * 3 + Math.max(0, OLD_C.indexOf(slot)));
  };
  const qFor = (date, slot) => {
    if (isOld(date)) return oldFor(date, slot);
    const i = qIndex(date);
    const G = window.QGEN;
    if (slot === "t" || slot === TS) return { q: G ? G.text(i) : QT[i % QT.length] };
    // 추가 질문: 날마다 다른 구간에서 끝없이
    const bm = /^b([ct])(\d+)$/.exec(slot);
    if (bm && G) {
      const k = Number(bm[2]);
      return bm[1] === "t" ? { q: G.text(4000 + i * 37 + k) } : G.choice(9000 + i * 53 + k);
    }
    const k = Math.max(0, CSLOTS.indexOf(slot));
    return G ? G.choice(i * 4 + k + 4) : QC[(i * 4 + k + 4) % QC.length];
  };
  // 예전 버전의 "c" 답은 첫 번째 객관식으로 취급
  const getAns = (date, slot, w) => S.ans[`${date}|${slot}|${w}`] || (isOld(date) && slot === "c1" ? S.ans[`${date}|c|${w}`] : undefined);
  const daySlots = (date) => {
    if (!isOld(date)) return { t: TS, c: CSLOTS };
    const c = OLD_C.filter((sl) => getAns(date, sl, "a") || getAns(date, sl, "b"));
    return { t: "t", c };
  };
  // 하루 한 질문: 짝수 날은 서술형, 홀수 날은 둘 중 하나
  const daySlot = (date) => (qIndex(date) % 2 === 0 ? "t" : "c1");
  const bonusSlot = (k) => (k % 2 ? "bc" : "bt") + k;
  const bonusAnswered = (date) => { let k = 0; while (getAns(date, bonusSlot(k + 1), S.who) || getAns(date, bonusSlot(k + 1), other())) k++; return k; };
  const answeredCount = (date, w) => { const d = daySlots(date); return [d.t, ...d.c].filter((sl) => getAns(date, sl, w)).length; };
  async function loadAnswers(from, to) {
    const { answers } = await api(`answers?from=${from}&to=${to}`);
    for (const k of Object.keys(S.ans)) { const d = k.slice(0, 10); if (d >= from && d <= to) delete S.ans[k]; }
    for (const a of answers) S.ans[`${a.qdate}|${a.slot}|${a.who}`] = a;
  }
  function updateBadge() {
    const t = qToday();
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
    if (document.activeElement && document.activeElement.blur && !document.activeElement.closest("#chatWrap")) document.activeElement.blur();
    document.body.classList.remove("kb");
    const prevI = TABS.indexOf(S.tab), nextI = TABS.indexOf(tab);
    const dir = prevI < 0 || prevI === nextI ? "" : nextI > prevI ? "from-r" : "from-l";
    S.tab = tab;
    try { history.replaceState(null, "", "#" + tab); } catch {}
    $$(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    movePill();
    const isMap = tab === "map", isChat = tab === "chat";
    $("#mapWrap").hidden = !isMap;
    $("#chatWrap").hidden = !isChat;
    $(".topbar").hidden = isChat;
    document.documentElement.classList.toggle("lock", isMap || isChat);
    view.hidden = isMap || isChat;
    window.scrollTo(0, 0);
    const shown = isMap ? $("#mapWrap") : isChat ? $("#chatWrap") : view;
    if (dir) { shown.classList.remove("from-r", "from-l"); void shown.offsetWidth; shown.classList.add(dir); setTimeout(() => shown.classList.remove(dir), 320); }
    if (isMap) { ensureMap(); refreshLoc(true); flyPending(); return; }
    if (isChat) { openChat(); return; }
    const key = S.tab + (S.tab === "calendar" ? S.memView || "" : "");
    view.dataset.tab = "";
    if (viewCache[key]) { view.innerHTML = viewCache[key]; view.dataset.tab = S.tab; }
    else view.innerHTML = "";
    render();
  }
  // 화면을 통째로 갈아끼우지 않고 바뀐 곳만 고쳐서 들썩임·깜빡임 없게
  function morphNode(o, n) {
    if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName) { o.replaceWith(n.cloneNode(true)); return; }
    if (o.nodeType === 3 || o.nodeType === 8) { if (o.data !== n.data) o.data = n.data; return; }
    if (o.nodeType !== 1) return;
    const focused = o === document.activeElement;
    if (o.classList.contains("maplibregl-map")) return;
    for (const a of [...o.attributes]) if (!n.hasAttribute(a.name) && a.name !== "data-l") o.removeAttribute(a.name);
    for (const a of [...n.attributes]) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
    if (o.nodeName === "TEXTAREA" || o.nodeName === "INPUT" || o.nodeName === "SELECT") {
      if (!focused && o.nodeName === "TEXTAREA" && o.value !== n.value) { o.value = n.value; o.textContent = n.textContent; }
      if (!focused && o.nodeName === "INPUT" && o.type !== "file" && o.value !== n.value && !o.dataset.dirty) o.value = n.value;
      return;
    }
    morphKids(o, n);
  }
  function morphKids(op, np) {
    if (op.classList && op.classList.contains("maplibregl-map")) return;
    const on = [...op.childNodes], nn = [...np.childNodes];
    nn.forEach((n, i) => { if (on[i]) morphNode(on[i], n); else op.appendChild(n.cloneNode(true)); });
    for (let i = nn.length; i < on.length; i++) on[i].remove();
  }
  const viewTpl = document.createElement("template");
  let viewHtml = "";
  Object.defineProperty(view, "innerHTML", {
    get() { return Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML").get.call(view); },
    set(h) {
      const d = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
      const sameTab = view.dataset.tab === S.tab && view.dataset.tab;
      if (h === viewHtml && sameTab) return;
      viewHtml = h;
      if (!sameTab || !view.firstChild || view.querySelector(".sk")) { d.set.call(view, h); return; }
      viewTpl.innerHTML = h;
      morphKids(view, viewTpl.content);
    },
  });
  const viewCache = {};
  async function render(keepScroll = false) {
    const y = window.scrollY;
    try {
      if (S.tab === "home") await renderHome();
      else if (S.tab === "question") await renderQuestion();
      else if (S.tab === "calendar") await (S.memView === "cal" ? renderCalendar() : renderAlbum());

    } catch (e) {
      if (e.status !== 401) view.innerHTML = `<div class="card empty">불러오지 못했어요<br>${esc(e.message)}</div>`;
    }
    view.dataset.tab = S.tab;
    viewCache[S.tab + (S.tab === "calendar" ? S.memView || "" : "")] = viewHtml;
    if (keepScroll && Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
  }
  // 불러오는 동안 화면 모양대로 회색 자리 표시 (스켈레톤)
  const skel = (tab) => {
    const row = `<div class="sk-row"><i class="sk sk-ic"></i><div><i class="sk sk-l1"></i><i class="sk sk-l2"></i></div></div>`;
    if (tab === "home") return `<div class="sk sk-hero"></div><div class="sk-list">${row.repeat(5)}</div>`;
    if (tab === "question") return `<i class="sk sk-title"></i><div class="sk sk-card"></div><div class="sk-list">${row.repeat(3)}</div>`;
    if (tab === "calendar") return `<div class="sk sk-seg"></div><div class="sk-grid">${'<i class="sk"></i>'.repeat(9)}</div>`;
    return `<div class="sk sk-card"></div><div class="sk-list">${row.repeat(3)}</div>`;
  };
  const spinner = () => { if (!view.innerHTML.trim() || view.dataset.tab !== S.tab) { view.innerHTML = skel(S.tab); view.dataset.tab = S.tab; } };

  // ---------- 오늘 기분 ----------
  const MOODS = [
    ["happy", "sun", "기분 좋아"], ["flutter", "sparkle", "설레"], ["miss", "heart", "보고 싶어"],
    ["tired", "moon", "피곤해"], ["busy", "clock", "바빠"], ["study", "book", "공부 중"],
    ["exercise", "run", "운동 중"], ["hungry", "bowl", "배고파"], ["gloomy", "cloud", "우울해"],
  ];
  const moodOf = (w) => { const m = S.mood && S.mood[w]; if (!m) return null; const d = MOODS.find((x) => x[0] === m.m); return d ? { ic: d[1], label: d[2], text: m.text, t: m.t } : null; };
  function moodChip(w) {
    const m = moodOf(w);
    return `<button class="mood-chip ${w}" ${w === S.who ? 'data-act="moodSheet"' : ""}>${av(w)}<span><b>${esc(nm(w))}</b><em>${m ? `${ic(m.ic)}${esc(m.text || m.label)}` : w === S.who ? "오늘 기분 남기기" : "아직 없음"}</em></span></button>`;
  }
  function moodSheet() {
    const cur = S.mood && S.mood[S.who];
    openSheet(`
      <h2>${ic("sparkle")}오늘 내 기분</h2>
      <div class="mood-grid">${MOODS.map(([k, i, l]) => `<button class="${cur && cur.m === k ? "on" : ""}" data-act="moodPick" data-m="${k}">${ic(i)}<span>${l}</span></button>`).join("")}</div>
      <label>한 줄 상태 (선택)<input type="text" id="moodText" maxlength="30" placeholder="예: 학원 끝나고 갈게" value="${esc(cur ? cur.text || "" : "")}"></label>
      <div class="row2"><button class="btn gray" data-act="moodClear">지우기</button><button class="btn primary" data-act="moodSave">남기기</button></div>`);
    S.moodPick = cur ? cur.m : null;
  }

  // ---------- 홈 ----------
  async function renderHome() {
    if (!$(".hero", view)) { view.innerHTML = skel("home"); view.dataset.tab = "home"; }
    const t = today();
    const [, locR, bkR, lt, sk] = await Promise.all([
      loadAnswers(qToday(), qToday()), api("loc"), api("bucket"), api(`letters?today=${t}`), api(`streak?today=${qToday()}`),
    ]);
    S.locs = locR.locs; S.locNow = locR.now;
    updateBadge();
    if (S.tab !== "home") return;

    const dp = dplus(t);
    const next = annivList(t, addDays(t, 800)).filter((a) => a.kind !== "start")[0];
    const myCnt = answeredCount(qToday(), S.who);
    const la = S.locs.a, lb = S.locs.b;
    const dist = la && lb ? fmtDist(distM(la, lb)) : null;
    const bk = bkR.bucket, bkDone = bk.filter((x) => x.done).length;
    const meet = S.nextMeet && S.nextMeet >= t ? S.nextMeet : "";
    const cover = S.avatars && S.avatars.cover;
    const mood = (w) => { const m = moodOf(w); return m ? `${ic(m.ic)}${esc(m.text || m.label)}` : w === S.who ? "기분 남기기" : ""; };
    const row = (act, icon, title, value, sub, extra = "") => `
      <button class="li" data-act="${act}" ${extra}>
        <span class="li-ic">${ic(icon)}</span>
        <span class="li-t"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</span>
        <span class="li-v">${value}</span>${ic("right", "li-chev")}
      </button>`;
    const ps = pushState();

    view.innerHTML = `
      <div class="hero${cover ? " has-cover" : ""}" ${cover ? `style="background-image:linear-gradient(180deg,rgba(40,10,30,0) 25%,rgba(40,10,30,.6)),url('/api/avatar/cover?v=${cover}')"` : ""}>
        <div class="dday">${dp > 0 ? dp : dlabel(1 - dp)}${dp > 0 ? "<small>일째</small>" : ""}</div>
        <div class="since">${esc(nm("a"))} ${ic("heart")} ${esc(nm("b"))}, ${+S.start.slice(0, 4)}년 ${+S.start.slice(5, 7)}월 ${+S.start.slice(8)}일부터</div>
        <div class="hero-moods">
          <button class="hm" data-act="moodSheet">${av(S.who)}<span>${mood(S.who)}</span></button>
          ${moodOf(other()) ? `<span class="hm">${av(other())}<span>${mood(other())}</span></span>` : ""}
        </div>
        <div class="hero-acts">
          <button class="ha" data-act="missYou" aria-label="보고싶어">${HEART}</button>
        </div>
      </div>
      ${ps === "default" ? `<button class="notice" data-act="pushOn">${ic("bell")}알림을 켜면 앱을 꺼도 메시지가 와요<b>켜기</b></button>`
        : ps === "needs-home" ? `<div class="notice">${ic("bell")}홈 화면에 추가하면 알림을 받을 수 있어요</div>` : ""}
      ${lt.unread ? `<button class="notice letter" data-act="lettersOpen">${ic("msg")}${esc(nm(other()))}님의 편지가 도착했어요<b>열기</b></button>` : ""}
      <div class="list">
        ${row("tab", "chat", "오늘의 질문", myCnt >= 5 ? ic("check", "done") : `${myCnt}/5`, esc(qFor(qToday(), TS).q), 'data-tab="question"')}
        ${row("meetSheet", "cal", "다음 만남", meet ? dlabel(diff(t, meet)) : "정하기", meet ? fmtK(meet) : "")}
        ${row("annivSheet", "gift", next ? esc(next.title) : "기념일", next ? dlabel(diff(t, next.date)) : "", next ? fmtK(next.date) : "")}
        ${row("tab", "pin", "우리 사이", S.together ? "함께" : dist || "-", S.together ? "같이 있어요" : "", 'data-tab="map"')}
        ${row("bucketOpen", "list", "버킷리스트", bk.length ? `${bkDone}/${bk.length}` : "", "")}
        ${row("lettersOpen", "msg", "편지", lt.unread ? `<i class="dot"></i>` : "", "정한 날에 열리는 편지")}
      </div>
      <h3 class="home-h">함께 하기</h3>
      <div class="grid6">
        ${[["dailyOpen", "camera", "오늘의 한 장"], ["couponOpen", "gift", "사랑 쿠폰"], ["ideaOpen", "sparkle", "데이트 뭐 하지"],
           ["eatOpen", "bowl", "맛집·갈 곳"], ["notesOpen", "star", "서로 알아두기"], ["statsOpen", "list", "우리 기록"]]
          .map(([a, i, l]) => `<button data-act="${a}"><span>${ic(i)}</span>${l}</button>`).join("")}
      </div>`;
  }

  // ---------- 서로 알아두기 (좋아하는 것, 싫어하는 것 등 메모) ----------
  const NOTE_CATS = ["좋아해", "싫어해", "갖고 싶어", "사이즈", "기억할 것"];
  async function notesSheet(about) {
    about = about || S.notesAbout || other();
    S.notesAbout = about;
    const { notes } = await api("notes");
    const mine = notes.filter((n) => n.about === about);
    const groups = NOTE_CATS.map((c) => [c, mine.filter((n) => (n.cat || "기억할 것") === c)]).filter(([, l]) => l.length);
    openSheet(`
      <h2>${ic("star")}서로 알아두기</h2>
      <div class="seg" style="margin-top:8px">${["a", "b"].map((w) => `<button class="${w === about ? "on" : ""}" data-act="notesAbout" data-w="${w}">${esc(nm(w))}</button>`).join("")}</div>
      ${groups.map(([c, l]) => `<div class="sec-t"><span>${c}</span></div>${l.map((n) => `<div class="ev"><span class="tt">${esc(n.text)}</span><button class="x" data-act="noteDel" data-id="${n.id}" aria-label="삭제">${ic("x")}</button></div>`).join("")}`).join("")
        || `<div class="empty">${esc(nm(about))}님에 대해 기억하고 싶은 걸 적어보세요<br>예: 민트초코 싫어함, 신발 240</div>`}
      <div class="note-add">
        <div class="chips">${NOTE_CATS.map((c, i) => `<button class="chip-sel${i === 0 ? " on" : ""}" data-act="noteCat" data-c="${c}">${c}</button>`).join("")}</div>
        <div class="add-row" style="margin-top:8px"><input type="text" id="noteText" maxlength="100" placeholder="예: 떡볶이는 로제"><button class="btn primary" data-act="noteAdd" aria-label="추가">${ic("plus")}</button></div>
      </div>`);
    S.noteCat = NOTE_CATS[0];
  }

  // ---------- 데이트 뭐 하지? (아이디어 뽑기) ----------
  // [아이디어, 장소, 비용]
  const IDEAS = [
    ["인생네컷 찍기", "밖", "조금"], ["방탈출 카페 도전하기", "실내", "보통"], ["보드게임 카페 가기", "실내", "보통"],
    ["코인노래방에서 듀엣곡 부르기", "실내", "조금"], ["편의점 신상 간식 하나씩 골라 먹기", "밖", "조금"], ["공원에서 돗자리 피크닉", "밖", "조금"],
    ["서로 옷 골라주기", "밖", "보통"], ["같은 책 사서 같이 읽기", "실내", "보통"], ["카페에서 같이 공부하기", "실내", "조금"],
    ["영화 보고 서로 별점 매기기", "실내", "보통"], ["떡볶이 맛집 찾아가기", "밖", "조금"], ["공원에서 배드민턴 치기", "밖", "무료"],
    ["볼링 한 게임 내기", "실내", "보통"], ["인형뽑기 하나 뽑을 때까지", "실내", "조금"], ["서로에게 손편지 써서 바꾸기", "어디서나", "무료"],
    ["같이 도시락 싸서 나가기", "밖", "조금"], ["야경 보러 전망대 가기", "밖", "무료"], ["놀이공원 가기", "밖", "많이"],
    ["아쿠아리움 구경하기", "실내", "많이"], ["서점에서 서로 책 골라주기", "실내", "보통"], ["커플 키링 만들기", "실내", "보통"],
    ["자전거 타고 동네 한 바퀴", "밖", "조금"], ["처음 가보는 동네 걸어보기", "밖", "무료"], ["새로 생긴 카페 가보기", "밖", "조금"],
    ["서로 플레이리스트 만들어주기", "어디서나", "무료"], ["전시회 보러 가기", "실내", "보통"], ["처음 만난 곳 다시 가보기", "밖", "무료"],
    ["교복 입고 사진 찍기", "밖", "무료"], ["서로 얼굴 그려주기", "어디서나", "무료"], ["빙수 하나 시켜서 나눠 먹기", "밖", "조금"],
    ["도서관에서 같이 책 읽기", "실내", "무료"], ["시장 구경하면서 길거리 음식 먹기", "밖", "조금"], ["다음 기념일 계획 같이 세우기", "어디서나", "무료"],
    ["영상통화로 같은 영화 보기", "집", "무료"], ["같이 탕후루 만들어 보기", "집", "조금"], ["하루 동안 사진 100장 찍기", "밖", "무료"],
  ];
  function ideaSheet(spin) {
    // 같은 게 연달아 안 나오게 섞어서 차례로
    if (!S.ideaBag || !S.ideaBag.length) S.ideaBag = IDEAS.map((_, i) => i).sort(() => Math.random() - 0.5);
    const [title, place, cost] = IDEAS[S.ideaBag.pop()];
    S.idea = title;
    openSheet(`
      <h2>데이트 뭐 하지?</h2>
      <div class="idea2">
        <b id="ideaText">${esc(title)}</b>
        <div class="idea-tags"><span>${{ "밖": "야외", "집": "집에서" }[place] || place}</span><span>${cost === "무료" ? "돈 안 들어요" : `비용 ${cost}`}</span></div>
      </div>
      <div class="row2"><button class="btn gray" data-act="ideaAgain">${ic("refresh")}다른 거</button><button class="btn primary" data-act="ideaSave">버킷리스트에 담기</button></div>`);
    if (spin) {
      // 짧게 넘어가는 느낌만
      const el = $("#ideaText");
      let n = 0;
      const iv = setInterval(() => {
        el.textContent = IDEAS[Math.floor(Math.random() * IDEAS.length)][0];
        if (++n > 6) { clearInterval(iv); el.textContent = title; el.classList.add("land"); }
      }, 55);
    }
  }


  // ---------- 오늘의 한 장 ----------
  async function dailySheet() {
    const t = today();
    const { days } = await api(`daily?date=${t}`);
    const td = days.find((d) => d.date === t) || { date: t, mine: false, partner: false, open: false };
    const frame = (d, w) => {
      const has = w === S.who ? d.mine : d.partner;
      if (!has) return `<div class="df empty">${w === S.who ? `${ic("camera")}<span>내 사진 올리기</span>` : `<span>${esc(nm(w))}님 아직</span>`}</div>`;
      if (w !== S.who && !d.mine) return `<div class="df lockd">${ic("lock")}<span>내 사진을 올리면 보여요</span></div>`;
      return `<div class="df"><img src="/api/dailyimg?date=${d.date}&w=${w}&thumb=1&v=${Date.now() % 100000}" alt=""></div>`;
    };
    const past = days.filter((d) => d.date !== t && d.open);
    openSheet(`
      <h2>오늘의 한 장</h2>
      <p>하루에 한 장씩 지금 모습을 올려요. 둘 다 올리면 서로 보여요.</p>
      <div class="dpair">
        <button data-act="dailyUp">${frame(td, S.who)}<b>${esc(nm(S.who))}</b></button>
        <div>${frame(td, other())}<b>${esc(nm(other()))}</b></div>
      </div>
      <input type="file" id="dailyInput" accept="image/*" capture="environment" hidden>
      <div class="row2"><button class="btn primary" data-act="dailyUp">${ic("camera")}${td.mine ? "다시 찍기" : "지금 찍어 올리기"}</button></div>
      ${past.length ? `<div class="sec-t"><span>지난 날</span></div>${past.map((d) => `<div class="dpast"><span>${fmtK(d.date)}</span><div class="dpair sm">${frame(d, S.who)}${frame(d, other())}</div></div>`).join("")}` : ""}`);
  }

  // ---------- 사랑 쿠폰 ----------
  const COUPON_PRESETS = ["소원 들어주기권", "떡볶이 쏘기권", "화 풀기권", "1시간 통화권", "사진 찍어주기권", "데이트 코스 정하기권"];
  async function couponSheet(tab) {
    tab = tab || S.couponTab || "got";
    S.couponTab = tab;
    const { coupons } = await api("coupons");
    const list = coupons.filter((c) => (tab === "got" ? c.from_who !== S.who : c.from_who === S.who));
    openSheet(`
      <h2>사랑 쿠폰</h2>
      <div class="seg" style="margin-top:8px"><button class="${tab === "got" ? "on" : ""}" data-act="couponTab" data-t="got">받은 쿠폰</button><button class="${tab === "gave" ? "on" : ""}" data-act="couponTab" data-t="gave">준 쿠폰</button></div>
      ${list.map((c) => `
        <div class="coupon ${c.used ? "used" : ""}">
          <div class="cp-l"><b>${esc(c.title)}</b><span>${c.used ? `${new Date(c.used_t).getMonth() + 1}월 ${new Date(c.used_t).getDate()}일에 씀` : tab === "got" ? `${esc(nm(c.from_who))}님이 줬어요` : "아직 안 썼어요"}</span></div>
          ${tab === "got" && !c.used ? `<button class="btn primary sm" data-act="couponUse" data-id="${c.id}">쓰기</button>` : ""}
          ${tab === "gave" && !c.used ? `<button class="x" data-act="couponDel" data-id="${c.id}" aria-label="삭제">${ic("x")}</button>` : ""}
        </div>`).join("") || `<div class="empty">${tab === "got" ? "아직 받은 쿠폰이 없어요" : "쿠폰을 만들어서 선물해 보세요"}</div>`}
      <div class="note-add">
        <div class="chips">${COUPON_PRESETS.map((c) => `<button class="chip-sel" data-act="couponPreset" data-c="${c}">${c}</button>`).join("")}</div>
        <div class="add-row" style="margin-top:8px"><input type="text" id="couponTitle" maxlength="30" placeholder="쿠폰 이름"><button class="btn primary" data-act="couponGive">주기</button></div>
      </div>`);
  }

  // ---------- 뭐 먹지? ----------
  const FOODS = ["떡볶이", "마라탕", "치킨", "피자", "햄버거", "돈까스", "초밥", "라면", "김밥", "짜장면", "쌀국수", "파스타", "닭갈비", "샌드위치", "분식 세트", "탕후루"];
  function foodSheet(spin) {
    const pick = FOODS[Math.floor(Math.random() * FOODS.length)];
    openSheet(`
      <h2>뭐 먹지?</h2>
      <div class="idea2"><b id="foodText">${spin ? "" : "뭐 먹을지 모르겠으면 눌러봐요"}</b></div>
      <div class="row2"><button class="btn primary" data-act="foodSpin">${ic("refresh")}${spin ? "다시 고르기" : "골라줘"}</button></div>`);
    if (spin) {
      const el = $("#foodText");
      let n = 0, delay = 40;
      const tick = () => {
        el.textContent = FOODS[Math.floor(Math.random() * FOODS.length)];
        n++; delay *= 1.18;
        if (n < 14) setTimeout(tick, delay); else { el.textContent = pick; el.classList.add("land"); }
      };
      tick();
    }
  }

  // ---------- 우리 기록 ----------
  async function statsSheet() {
    openSheet(`<h2>우리 기록</h2><div class="stats">${Array.from({ length: 6 }, () => `<div class="st sk"></div>`).join("")}</div>`);
    const s2 = await api("stats");
    const t = today();
    const items = [
      ["함께한 날", `${dplus(t)}일`], ["주고받은 메시지", `${s2.msgs}개`], ["같이 답한 질문", `${s2.bothDays}일`],
      ["모은 사진", `${s2.photos}장`], ["이룬 버킷리스트", `${s2.bucketDone}개`], ["쓴 편지", `${s2.letters}통`],
    ];
    const box = $("#sheetBox .stats");
    if (box) box.innerHTML = items.map(([k, v]) => `<div class="st"><b>${v}</b><span>${k}</span></div>`).join("");
  }

  // ---------- 다음 만남 ----------
  function meetSheet() {
    openSheet(`
      <h2>${ic("cal")}다음 만남</h2>
      <p>다음에 만나는 날을 정해두면 홈에 D-day가 떠요.</p>
      <label>날짜<input type="date" id="meetDate" value="${S.nextMeet || today()}"></label>
      <div class="row2"><button class="btn gray" data-act="meetClear">지우기</button><button class="btn primary" data-act="meetSave">저장</button></div>`);
  }

  // ---------- 편지 ----------
  async function lettersSheet() {
    const t = today();
    const { letters } = await api(`letters?today=${t}`);
    openSheet(`
      <h2>${ic("msg")}편지</h2>
      <p>날짜를 정해서 보내면 그날 열려요. 오늘 날짜로 보내면 바로 도착해요.</p>
      <div class="row2" style="margin:10px 0 6px"><button class="btn primary" data-act="letterWrite">${ic("pen")}편지 쓰기</button></div>
      ${letters.map((l) => `
        <div class="letter ${l.mine ? "mine" : ""} ${l.open ? "" : "lt-wait"}">
          <div class="lh">${l.mine ? `내가 보낸 편지` : `${esc(nm(l.from))}님의 편지`}<span>${l.open ? fmtK(l.open_date) : `${fmtK(l.open_date)}에 열려요`}</span></div>
          ${l.body !== null ? `<div class="lb">${esc(l.body)}</div>` : `<div class="lb lock">${ic("lock")}아직 열 수 없어요 · ${dlabel(diff(t, l.open_date))}</div>`}
          ${l.mine ? `<button class="x" data-act="letterDel" data-id="${l.id}" aria-label="삭제">${ic("trash")}</button>` : ""}
        </div>`).join("") || `<div class="empty">아직 편지가 없어요</div>`}`);
    for (const l of letters) if (!l.mine && l.open && !l.read) api(`letters/${l.id}/read`, { method: "POST", body: {} }).catch(() => {});
  }
  function letterWrite() {
    openSheet(`
      <h2>${ic("pen")}${esc(nm(other()))}에게 편지</h2>
      <textarea id="letterBody" maxlength="3000" placeholder="하고 싶은 말을 적어보세요" style="width:100%;min-height:200px;margin-top:10px"></textarea>
      <label>열리는 날<input type="date" id="letterDate" value="${today()}"></label>
      <div class="row2"><button class="btn gray" data-act="lettersOpen">취소</button><button class="btn primary" data-act="letterSend">보내기</button></div>`);
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
  // 질문: 날짜별 한 장씩, 옆으로 밀어서 넘김
  async function renderQuestion() {
    spinner();
    const t = qToday();
    const first = S.created && S.created < QBASE ? S.created : QBASE;
    if (!S.qDate || S.qDate > t) S.qDate = t;
    if (S.qDate < first) S.qDate = first;
    const d = S.qDate;
    S.qLoaded = S.qLoaded || {};
    const from = addDays(d, -7) < first ? first : addDays(d, -7);
    const need = !S.qLoaded[d] || d === t || addDays(d, 1) === t;
    const jobs = [need ? loadAnswers(from, d === t ? t : addDays(d, 1) > t ? t : addDays(d, 1)) : null, S.streak == null || d === t ? api(`streak?today=${t}`).catch(() => ({})) : null];
    const [, sk] = await Promise.all(jobs);
    for (let x = from; x <= d; x = addDays(x, 1)) S.qLoaded[x] = true;
    if (sk) S.streak = sk.streak || 0;
    updateBadge();
    if (S.tab !== "question") return;
    const ds = daySlots(d), isT = d === t;
    const mineN = answeredCount(d, S.who), otN = answeredCount(d, other()), tot = 1 + ds.c.length;
    view.innerHTML = `
      <div class="q-nav">
        <button class="icon-btn" data-act="qStep" data-d="-1" ${d <= first ? "disabled" : ""} aria-label="이전 날">${ic("left")}</button>
        <div class="q-nav-t"><b>${isT ? "오늘의 질문" : fmtK(d)}</b><span>${isT ? fmtK(d) : `나 ${mineN}/${tot}, ${esc(nm(other()))} ${otN}/${tot}`}</span></div>
        <button class="icon-btn" data-act="qStep" data-d="1" ${isT ? "disabled" : ""} aria-label="다음 날">${ic("right")}</button>
      </div>
      <div id="qPage" data-date="${d}">
        ${qCard(d, ds.t)}
        ${ds.c.length ? `<section class="qbox"><h3 class="qbox-t">취향 맞추기 <span>한 번만 고를 수 있어요</span></h3>${ds.c.map((c) => choiceOne(d, c)).join("")}</section>` : ""}
      </div>
      <p class="q-hint">${isT ? (S.streak ? `${S.streak}일 연속 함께 답했어요. ` : "") + "옆으로 밀면 지난 질문을 볼 수 있어요" : `<button class="linkbtn" data-act="qToday">오늘 질문으로</button>`}</p>`;
    if (S.qAnim) { const pg = $("#qPage"); pg.classList.remove("q-in-l", "q-in-r"); void pg.offsetWidth; pg.classList.add(S.qAnim); S.qAnim = null; }
  }
  function qGo(step) {
    const t = qToday(), first = S.created && S.created < QBASE ? S.created : QBASE;
    const nd = addDays(S.qDate || t, step);
    if (nd > t || nd < first) {
      const pg = $("#qPage"); if (pg) { pg.classList.remove("q-bump"); void pg.offsetWidth; pg.classList.add("q-bump"); }
      return;
    }
    S.qDate = nd; S.editing = null;
    S.qAnim = step < 0 ? "q-in-l" : "q-in-r";
    render(true);
  }
  // 질문 화면에서 좌우로 밀기
  (() => {
    let st = null;
    view.addEventListener("touchstart", (e) => {
      if (S.tab !== "question" || e.touches.length !== 1 || e.target.closest("textarea, input")) return;
      st = { x: e.touches[0].clientX, y: e.touches[0].clientY, on: false, dx: 0 };
    }, { passive: true });
    view.addEventListener("touchmove", (e) => {
      if (!st) return;
      const dx = e.touches[0].clientX - st.x, dy = e.touches[0].clientY - st.y;
      if (!st.on) {
        if (Math.abs(dy) > 12) { st = null; return; }
        if (Math.abs(dx) > 14) st.on = true; else return;
      }
      st.dx = dx;
      const pg = $("#qPage");
      if (pg) { pg.style.transition = "none"; pg.style.transform = `translateX(${dx * 0.45}px)`; pg.style.opacity = String(1 - Math.min(0.5, Math.abs(dx) / 600)); }
    }, { passive: true });
    view.addEventListener("touchend", () => {
      if (!st) return;
      const { on, dx } = st; st = null;
      const pg = $("#qPage");
      if (pg) { pg.style.transition = ""; pg.style.transform = ""; pg.style.opacity = ""; }
      if (on && Math.abs(dx) > 60) qGo(dx > 0 ? -1 : 1);
    });
  })();

  function bubble(w, text) {
    return `<div class="bubble ${w}">${av(w)}<div style="flex:1;min-width:0"><div class="nm">${esc(nm(w))}</div><div class="body">${esc(text)}</div></div></div>`;
  }
  // 서술형: 질문 → 내 답 → 상대 답 (말풍선 대신 이름표 + 글)
  function qCard(date, slot) {
    const Q = qFor(date, slot), me = S.who, ot = other();
    const mine = getAns(date, slot, me), theirs = getAns(date, slot, ot);
    const key = `${date}|${slot}`;
    const ans = (w, text, edit) => `<div class="qa"><div class="qa-h">${av(w)}<b>${esc(nm(w))}</b>${edit ? `<button class="qa-edit" data-act="editT" data-key="${key}">수정</button>` : ""}</div><p>${esc(text)}</p></div>`;
    let body;
    if (!mine || S.editing === key) {
      body = `<textarea data-ta="${date}|${slot}" placeholder="내 생각을 적어주세요" maxlength="1000">${esc(mine?.answer || "")}</textarea>
        <div class="q-actions">${mine ? `<button class="btn gray sm" data-act="cancelEdit">취소</button>` : ""}<button class="btn primary sm" data-act="saveT" data-date="${date}" data-slot="${slot}">${mine ? "저장" : "답하기"}</button></div>`;
    } else body = ans(me, mine.answer, true);
    if (theirs && !theirs.hidden) body += ans(ot, theirs.answer);
    else body += `<div class="qa-wait">${ic(theirs ? "lock" : "clock")}${theirs ? `${esc(nm(ot))}님 답은 내가 답하면 보여요` : `${esc(nm(ot))}님은 아직이에요`}</div>`;
    return `<section class="qbox"><h3 class="qbox-q">${esc(Q.q)}</h3>${body}</section>`;
  }


  // 둘 중 하나: 한 묶음 안에 줄로 (번호 없이)
  function choiceOne(date, slot) {
    const me = S.who, ot = other();
    const Q = qFor(date, slot);
    const mine = getAns(date, slot, me), theirs = getAns(date, slot, ot);
    const seen = mine && theirs && !theirs.hidden;
    const opts = Q.a.map((txt, v) => {
      const vs = String(v);
      const marks = (mine?.answer === vs ? av(me) : "") + (seen && theirs.answer === vs ? av(ot) : "");
      return `<button class="opt ${mine?.answer === vs ? "on" : ""}" data-act="pickC" data-date="${date}" data-slot="${slot}" data-v="${vs}" ${mine ? "disabled" : ""}><span>${esc(txt)}</span>${marks ? `<i>${marks}</i>` : ""}</button>`;
    }).join("");
    const res = seen ? (mine.answer === theirs.answer ? `<span class="cres same">${ic("heart")}같은 걸 골랐어요</span>` : `<span class="cres">서로 달라요</span>`)
      : mine ? `<span class="cres">${esc(nm(ot))}님 기다리는 중</span>` : theirs ? `<span class="cres">${esc(nm(ot))}님은 골랐어요</span>` : "";
    return `<div class="crow2"><div class="crow2-h"><b>${esc(Q.q)}</b>${res}</div><div class="opts">${opts}</div></div>`;
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

  async function uploadCover(file) {
    try {
      const im = await loadImg(file);
      const f = draw(im, 1200, 0.8);
      const r = await api("cover", { method: "POST", body: { data: f.b64 } });
      S.avatars.cover = r.t;
      settingsSheet(); toast("배경 사진을 바꿨어요");
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
          <button class="x" data-act="evShare" data-id="${e.id}" aria-label="디엠으로 보내기">${ic("send")}</button>
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
        <span class="lb-acts"><button class="icon-btn" data-act="lbSave" aria-label="저장">${ic("download")}</button>${p.chat ? "" : `<button class="icon-btn" data-act="lbDel" aria-label="삭제">${ic("trash")}</button>`}</span>
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
  // 카카오맵 키가 있으면 카카오맵, 없으면 기본 지도
  let kakaoP = null;
  function loadKakao() {
    if (!S.kakaoJs) return Promise.resolve(false);
    if (kakaoP) return kakaoP;
    kakaoP = new Promise((res) => {
      const sc = document.createElement("script");
      sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(S.kakaoJs)}&autoload=false`;
      sc.onload = () => { try { kakao.maps.load(() => { S.useKakao = true; res(true); }); } catch { res(false); } };
      sc.onerror = () => { toast("카카오맵을 못 불러와서 기본 지도로 보여줘요. 도메인 등록을 확인해 주세요"); res(false); };
      document.head.appendChild(sc);
      setTimeout(() => res(false), 5000);
    });
    return kakaoP;
  }
  const newMap = (o) => (S.useKakao ? new KMap(o) : new maplibregl.Map(o));
  const newMarker = (o) => (S.useKakao ? new KMarker(o) : new maplibregl.Marker(o));
  // 지명·가게 이름을 한국어로, 가게·정류장은 가까이서 보이게
  function koLabels(m) {
    for (const ly of m.getStyle().layers) {
      if (ly.type !== "symbol") continue;
      if (/road_one_way|highway-shield|road_shield/.test(ly.id)) { m.setLayoutProperty(ly.id, "visibility", "none"); continue; }
      if (/^poi/.test(ly.id)) { try { m.setLayerZoomRange(ly.id, 14, 24); } catch {} }
      const tf = JSON.stringify((ly.layout && ly.layout["text-field"]) || "");
      if (tf.includes("name") && !tf.includes('"ref"')) m.setLayoutProperty(ly.id, "text-field", ["coalesce", ["get", "name:ko"], ["get", "name"]]);
    }
  }
  // 시트 안의 작은 지도: 가운데 핀은 고정, 지도를 움직여 정확한 자리 맞춤
  let mini = null;
  function miniMap(elId, lat, lon, opts = {}) {
    if (mini) { try { mini.remove(); } catch {} mini = null; }
    const el = document.getElementById(elId);
    if (!el || (!window.maplibregl && !S.useKakao)) return null;
    mini = newMap({
      container: el, style: "https://tiles.openfreemap.org/styles/liberty",
      center: [lon, lat], zoom: opts.zoom || 17.5, maxZoom: 20, attributionControl: false,
      interactive: !opts.still, dragRotate: false, pitchWithRotate: false,
    });
    if (mini.touchZoomRotate && mini.touchZoomRotate.disableRotation) mini.touchZoomRotate.disableRotation();
    mini.on("load", () => { try { koLabels(mini); } catch {} });
    if (opts.onMove) mini.on("moveend", () => { const c = mini.getCenter(); opts.onMove(c.lat, c.lng); });
    return mini;
  }
  function ensureMap() {
    if (map) { setTimeout(() => map.resize(), 30); return; }
    if (S.kakaoJs && !kakaoP) { loadKakao().then(() => { if (!map) ensureMap(); }); return; }
    if (kakaoP && !S.useKakao && !ensureMap.waited) { ensureMap.waited = true; kakaoP.then(() => { if (!map) ensureMap(); }); return; }
    if (!window.maplibregl && !S.useKakao) { $("#mapCard").innerHTML = `<div class="empty">지도를 불러오지 못했어요</div>`; return; }
    map = newMap({
      container: "map",
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [128.6014, 35.8714], zoom: 11.5, maxZoom: 19.5,
      attributionControl: { compact: true },
      dragRotate: false, pitchWithRotate: false,
    });
    if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
    map.on("load", () => {
      // 상세 지도: 가게·정류장·건물 이름까지 한국어로 표시
      const firstSym = (map.getStyle().layers.find((l) => l.type === "symbol") || {}).id;
      map.addSource("sat", { type: "raster", tileSize: 256, maxzoom: 19, attribution: "Esri World Imagery",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] });
      map.addLayer({ id: "sat", type: "raster", source: "sat", layout: { visibility: "none" } }, firstSym);
      koLabels(map);
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
      map.addSource("trail", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "trail", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "c"], "line-width": 5, "line-opacity": 0.85 } });
      map.addLayer({ id: "trail-dot", type: "circle", source: "trail", filter: ["==", "$type", "Point"],
        paint: { "circle-radius": ["coalesce", ["get", "r"], 5], "circle-color": "#fff", "circle-stroke-width": 3, "circle-stroke-color": ["get", "c"] } });
      mapLoaded = true;
      if (S.sat) setSat(true);
      drawMap();
      loadPlaces();
      flyPending();
      if (S.eatOn) loadEats();
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
        markers[w] = newMarker({ element: el, anchor: "bottom" }).setLngLat([l.lon, l.lat]).addTo(map);
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
      placeMarkers.push(newMarker({ element: el, anchor: "center" }).setLngLat([p.lon, p.lat]).addTo(map));
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
        <button class="x" data-act="placeEdit" data-id="${p.id}" aria-label="수정">${ic("pen")}</button>
        <button class="x" data-act="placeGo" data-id="${p.id}" aria-label="보기">${ic("target")}</button>
        <button class="x" data-act="placeDel" data-id="${p.id}" aria-label="삭제">${ic("trash")}</button></div>`;
      }).join("") || `<div class="empty">아직 등록한 장소가 없어요<br>예: 학교, 학원, 우리 집</div>`}
      <div class="row2"><button class="btn gray" data-act="close">닫기</button><button class="btn primary" data-act="placePick">${ic("plus")}장소 추가</button></div>`);
  }
  function placeEditSheet(p) {
    S.plEd = { id: p.id, name: p.name, lat: p.lat, lon: p.lon, radius: p.radius, owner: p.owner || "both" };
    const o = S.plEd;
    const btn = (k, v, label) => `<button class="${o[k] === v ? "on" : ""}" data-act="plEdSet" data-k="${k}" data-v="${v}">${label}</button>`;
    openSheet(`
      <h2>장소 수정</h2>
      <label class="fl">이름</label>
      <input type="text" id="plName" value="${esc(p.name)}" maxlength="20" style="width:100%;box-sizing:border-box">
      <label class="fl">누구 장소</label>
      <div class="pick-r pick-own" style="margin-top:0">${btn("owner", S.who, esc(nm(S.who)))}${btn("owner", other(), esc(nm(other())))}${btn("owner", "both", "둘 다")}</div>
      <label class="fl">알림 반경</label>
      <div class="pick-r pl-r" style="margin-top:0">${[50, 100, 200, 500].map((r) => btn("radius", r, r + "m")).join("")}</div>
      <label class="fl">위치 <span class="fl-sub">지도를 움직여 핀을 맞춰요</span></label>
      <div class="mini-wrap"><div id="miniPl" class="mini"></div><span class="mini-pin" style="--c:#B65FE0">${ic("pin")}</span></div>
      <div class="row2" style="margin-top:16px"><button class="btn gray" data-act="placesSheet">취소</button><button class="btn primary" data-act="plEdSave">저장</button></div>`);
    setTimeout(() => miniMap("miniPl", p.lat, p.lon, { zoom: 17, onMove: (la, lo) => { S.plEd.lat = la; S.plEd.lon = lo; } }), 320);
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
  function setSat(on) {
    S.sat = on;
    try { localStorage.setItem("sat", on ? "1" : ""); } catch {}
    const b = $("#satBtn"); if (b) b.classList.toggle("on", on);
    if (!mapLoaded) return;
    map.setLayoutProperty("sat", "visibility", on ? "visible" : "none");
    // 위성 사진 위에서는 글씨가 잘 보이도록 흰 테두리
    for (const ly of map.getStyle().layers) if (ly.type === "symbol") { try { map.setPaintProperty(ly.id, "text-halo-width", on ? 1.6 : 1); } catch {} }
  }
  let flyMk = null;
  function flyPending() {
    if (!S.flyTo || !mapLoaded) return;
    const { lat, lon } = S.flyTo; S.flyTo = null;
    if (flyMk) flyMk.remove();
    const el = document.createElement("div"); el.className = "fly-mk"; el.innerHTML = ic("pin");
    flyMk = newMarker({ element: el, anchor: "bottom" }).setLngLat([lon, lat]).addTo(map);
    map.flyTo({ center: [lon, lat], zoom: 17 });
  }
  // ---------- 맛집 지도 ----------
  const FOOD_CATS = ["한식", "일식", "중식", "양식", "아시안", "고기", "분식", "카페", "디저트", "술집", "기타"];
  const PLACE_CATS = ["공원", "산책", "카페", "전시", "영화", "공연", "쇼핑", "놀거리", "야경", "여행", "기타"];
  let EAT_CATS = FOOD_CATS;
  const KT = {
    food: { name: "맛집", title: "맛집 지도", add: "맛집 추가", edit: "맛집 수정", sub: "우리만의 맛집을 모아요", empty: "첫 맛집을 추가해보세요", none: "여기에 맞는 맛집이 없어요", find: "우리 맛집에서 찾기", searchPh: "가게 이름 검색 (예: 동성로 파스타)", namePh: "가게 이름", memoPh: "메모 (예: 크림파스타 맛있대, 웨이팅 김)", memoE: "메모 (웨이팅, 주차, 다음에 시킬 것)", menuPh: "먹은 메뉴 (예: 크림파스타, 리조또)", noMenu: "메뉴 기록 없음", hint: "언제 가서 뭘 먹었는지 남겨두면 다음에 시킬 때 좋아요", def: "한식" },
    place: { name: "갈 곳", title: "갈 곳", add: "갈 곳 추가", edit: "갈 곳 수정", sub: "같이 가고 싶은 곳을 모아요", empty: "같이 가고 싶은 곳을 추가해보세요", none: "여기에 맞는 곳이 없어요", find: "우리 갈 곳에서 찾기", searchPh: "장소 이름 검색 (예: 수성못, 미술관)", namePh: "장소 이름", memoPh: "메모 (예: 노을 질 때 가기, 예약 필요)", memoE: "메모 (입장료, 운영 시간, 준비물)", menuPh: "한 것 (예: 사진 찍기, 전시 관람)", noMenu: "기록 없음", hint: "언제 가서 뭘 했는지 남겨두면 추억이 돼요", def: "공원" },
  };
  const TK = () => KT[E.kind] || KT.food;
  function setKind(k) {
    E.kind = k; EAT_CATS = k === "place" ? PLACE_CATS : FOOD_CATS;
    E.list = (E.all || []).filter((e) => (e.kind || "food") === k);
    E.filter = "all"; E.q = ""; E.sel = null;
    try { localStorage.setItem("eatKind", k); } catch {}
  }
  const E = { list: [], all: [], kind: (() => { try { return localStorage.getItem("eatKind") || "food"; } catch { return "food"; } })(), filter: "all", sort: "near", q: "", markers: [], view: "cards", sel: null };
  const CAT_LOOK = { 한식: ["bowl", "#F05A3C"], 일식: ["bowl", "#E8495F"], 중식: ["bowl", "#D9452B"], 양식: ["fork", "#E08A1E"], 아시안: ["bowl", "#2FA36B"], 고기: ["fork", "#C2412D"], 분식: ["bowl", "#F2763A"], 카페: ["cup", "#9A6B4F"], 디저트: ["cake", "#E3609B"], 술집: ["glass", "#6F5BD6"], 기타: ["pin", "#7C7A85"], 공원: ["tree", "#3A9D5D"], 산책: ["route", "#4AA88A"], 전시: ["frame", "#C2547A"], 영화: ["film", "#5B5FD6"], 공연: ["ticket", "#D9534F"], 쇼핑: ["bag", "#E0892E"], 놀거리: ["sparkle", "#8E5BD6"], 야경: ["moon", "#3D4A8F"], 여행: ["route", "#2B8FD6"] };
  const catIc = (c) => (CAT_LOOK[c] || CAT_LOOK.기타)[0];
  const catCol = (c) => (CAT_LOOK[c] || CAT_LOOK.기타)[1];
  const eatColor = (e) => (e.status === "been" ? "#E5406A" : "#8B8993");
  const avgRate = (e) => { const r = [e.ra, e.rb].filter((x) => x); return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0; };
  const stars = (n, size) => `<span class="stars${size ? " " + size : ""}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= Math.round(n) ? "on" : ""}">${ic("star")}</i>`).join("")}</span>`;
  async function loadEats() {
    try {
      const d = await api("eats"); const first = !E.loaded; E.all = d.eats; E.list = d.eats.filter((e) => (e.kind || "food") === E.kind); E.loaded = true;
      EAT_CATS = E.kind === "place" ? PLACE_CATS : FOOD_CATS;
      drawEatMarkers(); if (S.eatOn && !S.trail && !$("#pick")) renderMapCard();
      if (first || E.fitNext) { E.fitNext = false; fitEats(); }
    } catch (e) { toast(e.message); }
  }
  const bothWant = (e) => e.wa && e.wb;
  function eatsFiltered(forMap) {
    let l = E.list;
    if (E.filter === "want") l = l.filter((e) => e.status !== "been");
    else if (E.filter === "been") l = l.filter((e) => e.status === "been");
    else if (E.filter === "both") l = l.filter(bothWant);
    else if (E.filter !== "all") l = l.filter((e) => e.cat === E.filter);
    if (!forMap && E.q) { const k = E.q.toLowerCase(); l = l.filter((e) => (e.name + " " + (e.memo || "") + " " + (e.addr || "")).toLowerCase().includes(k)); }
    const me = S.locs[S.who] || (map && { lat: map.getCenter().lat, lon: map.getCenter().lng });
    l = l.map((e) => ({ ...e, d: me ? distM(me, e) : 0 }));
    const by = { near: (a, b) => a.d - b.d, rate: (a, b) => avgRate(b) - avgRate(a) || b.visitN - a.visitN, recent: (a, b) => b.t - a.t, visit: (a, b) => b.visitN - a.visitN || avgRate(b) - avgRate(a) }[E.sort];
    return l.sort(by);
  }
  function drawEatMarkers() {
    E.markers.splice(0).forEach((m) => m.remove());
    if (!S.eatOn || !map || !mapLoaded) return;
    for (const e of eatsFiltered(true)) {
      const el = document.createElement("button");
      el.className = "eat-mk" + (e.status === "been" ? " been" : "") + (bothWant(e) && e.status !== "been" ? " both" : "") + (E.sel === e.id ? " sel" : "");
      el.dataset.act = "eatMk"; el.dataset.id = e.id;
      el.style.setProperty("--c", catCol(e.cat));
      const r = avgRate(e);
      el.innerHTML = `<span class="eat-ic">${ic(catIc(e.cat))}</span><span class="eat-nm">${esc(e.name)}${r ? `<em>${ic("star")}${r.toFixed(1)}</em>` : ""}</span>`;
      const mk = newMarker({ element: el, anchor: "bottom", offset: [0, 7] }).setLngLat([e.lon, e.lat]).addTo(map);
      mk._eid = e.id;
      E.markers.push(mk);
    }
  }
  function renderEatCard() {
    if (E.view === "list") return renderEatList();
    const l = eatsFiltered();
    const chip = (v, label) => `<button class="chip${E.filter === v ? " on" : ""}" data-act="eatFilter" data-v="${v}">${label}</button>`;
    const usedCats = EAT_CATS.filter((c) => E.list.some((e) => e.cat === c));
    const nb = E.list.filter((e) => e.status === "been").length;
    const card = $("#mapCard");
    const html = `
      <div class="eat2">
        <div class="eat2-head">
          <div class="eat2-t">
            <div class="kind-tg"><button class="${E.kind === "food" ? "on" : ""}" data-act="eatKind" data-v="food">맛집</button><button class="${E.kind === "place" ? "on" : ""}" data-act="eatKind" data-v="place">갈 곳</button></div>
            <span>${E.list.length ? `가본 곳 ${nb} · 가볼 곳 ${E.list.length - nb}` : TK().sub}</span></div>
          ${E.list.length ? `<button class="eat2-ib" data-act="eatRandom" aria-label="오늘 어디 가지">${ic("sparkle")}</button><button class="eat2-ib" data-act="eatView" data-v="list" aria-label="목록으로 보기">${ic("list")}</button>` : ""}
          <button class="eat2-add" data-act="eatAdd">${ic("plus")}추가</button>
          <button class="eat2-ib" data-act="eatClose" aria-label="닫기">${ic("x")}</button>
        </div>
        ${E.list.length ? `<div class="chips eat-chips">${chip("all", "전체")}${chip("want", "가볼 곳")}${chip("been", "가본 곳")}${E.list.some(bothWant) ? chip("both", "둘 다 찜") : ""}${usedCats.map((c) => chip(c, c)).join("")}</div>` : ""}
        <div class="eat-cards" id="eatCards">
          ${l.map((e) => {
            const r = avgRate(e);
            return `<button class="ecard${E.sel === e.id ? " sel" : ""}" data-act="eatOpenOne" data-id="${e.id}">
              <span class="ecard-img" style="--c:${catCol(e.cat)}">${e.cover ? `<img src="/api/eatimg/${e.cover}?thumb=1" alt="" loading="lazy">` : ic(catIc(e.cat))}
                ${bothWant(e) && e.status !== "been" ? `<em class="ecard-both">${ic("heart")}둘 다 찜</em>` : e.status !== "been" ? `<em class="ecard-want">가볼 곳</em>` : ""}</span>
              <span class="ecard-b">
                <b>${esc(e.name)}</b>
                <span class="ecard-m">${esc(e.cat || "기타")}${e.d ? ` · ${fmtDist(e.d)}` : ""}</span>
                <span class="ecard-f">${r ? `<span class="ecard-r">${ic("star")}${r.toFixed(1)}</span>` : ""}${e.visitN ? `<span>${e.visitN}번 감</span>` : ""}${e.imgN ? `<span>사진 ${e.imgN}</span>` : ""}${!r && !e.visitN && !e.imgN ? `<span class="muted">${e.memo ? esc(e.memo.slice(0, 18)) : "아직 기록 없음"}</span>` : ""}</span>
              </span>
            </button>`;
          }).join("")}
          ${!l.length ? `<div class="ecard-empty">${E.list.length ? TK().none : `${ic(E.kind === "place" ? "pin" : "bowl")}<b>${TK().empty}</b><span>가본 곳, 가보고 싶은 곳 모두 좋아요</span>`}</div>` : ""}
        </div>
      </div>`;
    const keep = $("#eatCards") ? $("#eatCards").scrollLeft : 0;
    if (card.querySelector(".eat2")) { const t = document.createElement("template"); t.innerHTML = html.trim(); morphKids(card, t.content); }
    else { card.innerHTML = html; const c = $("#eatCards"); if (c) c.scrollLeft = keep; }
    bindEatCards();
  }
  // 카드를 옆으로 넘기면 지도도 그 가게로
  function bindEatCards() {
    const c = $("#eatCards");
    if (!c || c._bound) return;
    c._bound = true;
    let tm = null;
    c.addEventListener("scroll", () => {
      clearTimeout(tm);
      tm = setTimeout(() => {
        if (E.lock) return;
        const mid = c.scrollLeft + c.clientWidth / 2;
        let best = null, bd = Infinity;
        for (const el of c.querySelectorAll(".ecard")) { const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = el; } }
        if (!best) return;
        const id = Number(best.dataset.id);
        if (id === E.sel) return;
        selectEat(id, false);
      }, 140);
    }, { passive: true });
  }
  // 맛집들이 한눈에 보이게 지도 맞춤 (너무 멀리 있는 곳은 빼고 내 주변 위주)
  function fitEats() {
    if (!map || !mapLoaded) { E.fitNext = true; return; }
    if (!E.list.length) return;
    clearTimeout(E.fitT);
    E.fitT = setTimeout(fitEatsNow, 500);
  }
  function fitEatsNow() {
    if (!S.eatOn) return;
    const me = S.locs[S.who];
    let pts = E.list.map((e) => [e.lon, e.lat]);
    if (me) { const near = E.list.filter((e) => distM(me, e) < 15000); if (near.length) pts = near.map((e) => [e.lon, e.lat]).concat([[me.lon, me.lat]]); }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: { top: 130, bottom: 340, left: 50, right: 70 }, maxZoom: 16, duration: 600 });
  }
  function selectEat(id, scrollCard) {
    E.sel = id;
    const e = E.list.find((x) => x.id === id);
    E.markers.forEach((m) => m.getElement().classList.toggle("sel", m._eid === id));
    $$("#eatCards .ecard").forEach((el) => el.classList.toggle("sel", Number(el.dataset.id) === id));
    if (e && map) map.easeTo({ center: [e.lon, e.lat], zoom: Math.max(map.getZoom(), 15.5), offset: [0, -innerHeight * 0.16], duration: 450 });
    if (scrollCard) {
      const el = $(`#eatCards .ecard[data-id="${id}"]`), c = $("#eatCards");
      if (el && c) { E.lock = true; c.scrollTo({ left: el.offsetLeft - (c.clientWidth - el.offsetWidth) / 2, behavior: "smooth" }); setTimeout(() => (E.lock = false), 600); }
    }
  }
  function renderEatList() {
    const l = eatsFiltered();
    const chip = (v, label) => `<button class="chip${E.filter === v ? " on" : ""}" data-act="eatFilter" data-v="${v}">${label}</button>`;
    const usedCats = EAT_CATS.filter((c) => E.list.some((e) => e.cat === c));
    const sorts = [["near", "가까운 순"], ["rate", "별점 순"], ["visit", "많이 간 순"], ["recent", "최근 추가"]];
    const card = $("#mapCard");
    const html = `
      <div class="eat2 eat2-list">
        <div class="eat2-head">
          <button class="eat2-ib" data-act="eatView" data-v="cards" aria-label="카드로 보기">${ic("left")}</button>
          <div class="eat2-t"><b>${TK().name} 목록</b><span>${E.list.length}곳</span></div>
          <button class="eat2-add" data-act="eatAdd">${ic("plus")}추가</button>
          <button class="eat2-ib" data-act="eatClose" aria-label="닫기">${ic("x")}</button>
        </div>
        <div class="eat-find">
          ${ic("search")}<input type="text" id="eatFind" value="${esc(E.q)}" placeholder="${TK().find}" maxlength="30" autocomplete="off" enterkeyhint="search">
          ${E.q ? `<button class="eat-find-x" data-act="eatFindClear" aria-label="지우기">${ic("x")}</button>` : ""}
        </div>
        <div class="eat-sort">${sorts.map(([v, t]) => `<button class="${E.sort === v ? "on" : ""}" data-act="eatSort" data-v="${v}">${t}</button>`).join("")}</div>
        <div class="chips eat-chips">${chip("all", "전체")}${chip("want", "가볼 곳")}${chip("been", "가본 곳")}${E.list.some(bothWant) ? chip("both", "둘 다 찜") : ""}${usedCats.map((c) => chip(c, c)).join("")}</div>
        <div class="eat-list">${l.length ? l.slice(0, 80).map((e, i) => `
          <button class="eat-li" data-act="eatOpenOne" data-id="${e.id}">
            ${E.sort === "rate" && avgRate(e) && i < 3 ? `<span class="eat-rank r${i + 1}">${i + 1}</span>` : ""}
            ${e.cover ? `<img class="eat-th" src="/api/eatimg/${e.cover}?thumb=1" alt="">` : `<span class="eat-dot" style="--c:${catCol(e.cat)}">${ic(catIc(e.cat))}</span>`}
            <span class="eat-t"><b>${esc(e.name)}</b><span>${[esc(e.cat || "기타"), e.d ? fmtDist(e.d) : "", e.visitN ? `${e.visitN}번 감` : e.status === "been" ? "" : "가볼 곳"].filter(Boolean).join(" · ")}</span></span>
            ${bothWant(e) && e.status !== "been" ? `<span class="eat-both" title="둘 다 찜">${ic("heart")}${ic("heart")}</span>` : ""}
            ${avgRate(e) ? `<span class="eat-r">${ic("star")}${avgRate(e).toFixed(1)}</span>` : ""}
          </button>`).join("") : `<div class="empty" style="padding:22px 0">${E.q ? `"${esc(E.q)}" 찾는 결과가 없어요` : E.list.length ? TK().none : TK().empty}</div>`}</div>
      </div>`;
    if (card.querySelector(".eat2-list")) { const t = document.createElement("template"); t.innerHTML = html.trim(); morphKids(card, t.content); }
    else card.innerHTML = html;
  }
  function setEatOn(on) {
    S.eatOn = on;
    const b = $("#eatBtn"); if (b) b.classList.toggle("on", on);
    if (on) { S.trail = null; E.fitNext = true; if (mapLoaded) map.getSource("trail").setData({ type: "FeatureCollection", features: [] }); loadEats(); }
    drawEatMarkers(); renderMapCard();
  }
  function eatAddSheet() {
    const me = S.locs[S.who];
    openSheet(`
      <h2>${TK().add}</h2>
      <div class="add-row" style="margin-top:10px"><input type="text" id="eatQ" placeholder="${TK().searchPh}" maxlength="60"><button class="btn primary" data-act="eatSearch" aria-label="검색">${ic("search")}</button></div>
      <div id="eatRes">${S.kakao || S.naver ? `<p class="sheet-sub" style="margin-top:12px">${S.kakao ? "카카오맵" : "네이버"} 검색으로 찾아요. 가까운 가게가 먼저 나와요</p>`
        : `<button class="nv-cta" data-act="naverSheet"><span class="kk-logo">K</span><span><b>가게 검색 연결하기</b><em>카카오맵이나 네이버 검색을 연결하면 동네 가게까지 정확히 찾아져요</em></span>${ic("right")}</button>`}</div>
      <button class="btn soft full" data-act="eatPickMap" style="margin-top:10px">${ic("target")}지도에서 직접 고르기</button>`);
    setTimeout(() => $("#eatQ") && $("#eatQ").focus(), 300);
    S.eatBias = me ? me : map ? { lat: map.getCenter().lat, lon: map.getCenter().lng } : null;
  }
  async function eatSearch() {
    const qv = $("#eatQ").value.trim(); if (!qv) return;
    $("#eatRes").innerHTML = `<div class="spin" style="margin:18px auto"></div>`;
    const b = S.eatBias ? `&lat=${S.eatBias.lat}&lon=${S.eatBias.lon}` : "";
    try {
      const { results } = await api(`geo?q=${encodeURIComponent(qv)}${b}`);
      S.eatRes = results;
      $("#eatRes").innerHTML = results.length ? `<div class="list" style="margin-top:12px">${results.map((r, i) => `
        <button class="li" data-act="eatResPick" data-i="${i}"><span class="li-t"><b>${esc(r.name)}</b><span>${r.cat ? esc(r.cat.split(">").pop()) + " · " : ""}${esc(r.addr || "")}${S.eatBias ? (r.addr ? ", " : "") + fmtDist(distM(S.eatBias, r)) : ""}</span></span>${ic("plus", "li-chev")}</button>`).join("")}</div>`
        : `<div class="empty">검색 결과가 없어요<br><small>지도에서 직접 골라주세요</small></div>`;
    } catch (e) { $("#eatRes").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  // 네이버 분류(음식점>한식 등)나 지도 데이터 종류를 우리 분류로
  function catOf(k) {
    const c = String(k);
    if (E.kind === "place") {
      if (/카페|커피|cafe/i.test(c)) return "카페";
      if (/공원|park|수목원|정원|garden|호수|못|숲/i.test(c)) return "공원";
      if (/둘레길|산책|하천|강변|trail/i.test(c)) return "산책";
      if (/미술관|박물관|전시|갤러리|museum|gallery/i.test(c)) return "전시";
      if (/영화|cinema|CGV|메가박스|롯데시네마/i.test(c)) return "영화";
      if (/공연|극장|콘서트|theatre|theater/i.test(c)) return "공연";
      if (/백화점|쇼핑|아울렛|몰|시장|mall|market/i.test(c)) return "쇼핑";
      if (/놀이|테마파크|방탈출|보드게임|볼링|노래방|오락|PC방|만화|공방|체험|amusement/i.test(c)) return "놀거리";
      if (/전망|야경|타워|viewpoint/i.test(c)) return "야경";
      if (/관광|명소|여행|attraction|해수욕|산$/i.test(c)) return "여행";
      return "기타";
    }
    if (/카페|커피|cafe/i.test(c)) return "카페";
    if (/디저트|베이커리|제과|빵|케이크|아이스크림|ice_cream/.test(c)) return "디저트";
    if (/술집|주점|호프|이자카야|bar|pub|와인|포차/i.test(c)) return "술집";
    if (/분식|떡볶이|김밥|fast_food/.test(c)) return "분식";
    if (/육류|고기|삼겹|갈비|곱창|막창|족발|보쌈|닭갈비|치킨/.test(c)) return "고기";
    if (/일식|초밥|돈가스|라멘|우동|이자카야|일본/.test(c)) return "일식";
    if (/중식|중국|마라|훠궈|딤섬/.test(c)) return "중식";
    if (/양식|이탈리|파스타|피자|스테이크|버거|햄버거|브런치|프랑스/.test(c)) return "양식";
    if (/아시아|베트남|태국|쌀국수|인도|멕시/.test(c)) return "아시안";
    if (/한식|국밥|찌개|냉면|국수|해장|한정식|백반|칼국수|순대|감자탕/.test(c)) return "한식";
    return c ? "기타" : "한식";
  }
  function naverSheet(tab) {
    tab = tab || S.connTab || (S.naver && !S.kakao ? "naver" : "kakao");
    S.connTab = tab;
    const kk = tab === "kakao";
    openSheet(`
      <h2>가게 검색 연결</h2>
      <p class="sheet-sub">무료 검색 키를 한 번만 넣으면 둘 다 쓸 수 있어요. 키는 서버에만 저장돼요.</p>
      <div class="seg" style="margin-top:12px">
        <button class="${kk ? "on" : ""}" data-act="connTab" data-v="kakao"><span class="kk-logo sm">K</span>카카오맵 (추천)${S.kakao ? " · 연결됨" : ""}</button>
        <button class="${kk ? "" : "on"}" data-act="connTab" data-v="naver"><span class="nv-logo sm">N</span>네이버${S.naver ? " · 연결됨" : ""}</button>
      </div>
      ${kk ? `
      <ol class="nv-steps">
        <li><a href="https://developers.kakao.com/console/app" target="_blank" rel="noopener">카카오 디벨로퍼스 내 애플리케이션</a>에 카카오로 로그인하고 <b>애플리케이션 추가하기</b>를 눌러요. 앱 이름·회사명은 아무거나 (예: 우리)</li>
        <li>만든 앱을 열고 왼쪽 메뉴 <b>카카오맵</b>에서 <b>사용 설정</b> 상태를 <b>ON</b>으로 바꿔요</li>
        <li>왼쪽 <b>앱 키</b>(또는 플랫폼 키)에서 <b>REST API 키</b>를 복사해서 아래에 붙여넣어요</li>
      </ol>
      <input type="text" id="kkKey" placeholder="REST API 키" autocomplete="off" autocapitalize="off" spellcheck="false" style="margin-top:12px">
      <div class="row2" style="margin-top:14px">${S.kakao ? `<button class="btn gray" data-act="kakaoOff">연결 해제</button>` : `<button class="btn gray" data-act="close">나중에</button>`}<button class="btn primary" data-act="kakaoSave">연결하기</button></div>
      <div class="kk-map">
        <h3>${ic("pin")}카카오맵으로 지도 보기 ${S.kakaoJs ? `<span class="ok-tag">사용 중</span>` : ""}</h3>
        <ol class="nv-steps">
          <li>같은 카카오 앱의 <b>앱 키</b>(또는 플랫폼 키)에서 <b>JavaScript 키</b>를 복사해요 (REST API 키 말고)</li>
          <li><b>플랫폼</b> &gt; <b>Web</b>(또는 JavaScript 키 설정의 <b>JavaScript SDK 도메인</b>)에 <b>https://wooju.pages.dev</b> 를 등록해요</li>
        </ol>
        <input type="text" id="kkJs" placeholder="JavaScript 키" value="${esc(S.kakaoJs || "")}" autocomplete="off" autocapitalize="off" spellcheck="false" style="margin-top:10px">
        <div class="row2" style="margin-top:10px">${S.kakaoJs ? `<button class="btn gray" data-act="kakaoJsOff">기본 지도로</button>` : ""}<button class="btn primary" data-act="kakaoJsSave">카카오맵 쓰기</button></div>
      </div>`
      : `
      <p class="nv-note">네이버는 2026년 7월부터 개발자센터에서 검색 키를 새로 안 내주고, <b>네이버 클라우드 플랫폼</b>에서만 받을 수 있어요. 가입할 때 카드 등록을 요구할 수 있어서 카카오가 더 간단해요.</p>
      <ol class="nv-steps">
        <li><a href="https://console.ncloud.com" target="_blank" rel="noopener">네이버 클라우드 콘솔</a>에 가입하고 로그인해요</li>
        <li>왼쪽 위 메뉴 &gt; <b>Services</b> &gt; <b>Application Services</b> &gt; <b>NAVER API HUB</b>로 가요</li>
        <li><b>Application 등록</b>에서 <b>검색</b>을 고르고 이름을 넣어 완료해요</li>
        <li>만든 Application의 <b>인증 정보</b>에서 Client ID와 Client Secret을 복사해 붙여넣어요</li>
      </ol>
      <input type="text" id="nvId" placeholder="Client ID" autocomplete="off" autocapitalize="off" spellcheck="false" style="margin-top:12px">
      <input type="text" id="nvSec" placeholder="Client Secret" autocomplete="off" autocapitalize="off" spellcheck="false" style="margin-top:8px">
      <div class="row2" style="margin-top:14px">${S.naver ? `<button class="btn gray" data-act="naverOff">연결 해제</button>` : `<button class="btn gray" data-act="close">나중에</button>`}<button class="btn primary" data-act="naverSave">연결하기</button></div>`}`);
  }
  function eatForm(p) {
    setTimeout(() => miniMap("miniAdd", p.lat, p.lon, { onMove: (la, lo) => { S.eatNew.lat = la; S.eatNew.lon = lo; } }), 320);
    S.eatNew = p; S.eatCat = p.cat && EAT_CATS.includes(p.cat) ? p.cat : TK().def; S.eatStatus = "want";
    openSheet(`
      <h2>${TK().add}</h2>
      <input type="text" id="eatName" value="${esc(p.name || "")}" placeholder="${TK().namePh}" maxlength="40" style="margin-top:10px">
      ${p.addr ? `<p class="sheet-sub" style="margin:6px 2px 0">${esc(p.addr)}</p>` : ""}
      <div class="mini-wrap"><div id="miniAdd" class="mini"></div><span class="mini-pin">${ic("pin")}</span><span class="mini-tip">지도를 움직여 핀을 정확한 자리에 맞춰주세요</span></div>
      <div class="seg eat-st" style="margin-top:14px">
        <button class="on" data-act="eatSt" data-v="want">가보고 싶어요</button><button data-act="eatSt" data-v="been">가봤어요</button>
      </div>
      <div class="eat-cats">${EAT_CATS.map((c) => `<button class="cchip${c === S.eatCat ? " on" : ""}" data-act="eatCat" data-v="${c}" style="--c:${catCol(c)}">${ic(catIc(c))}${c}</button>`).join("")}</div>
      <textarea id="eatMemo" rows="2" placeholder="${TK().memoPh}" maxlength="300" style="margin-top:12px"></textarea>
      <div class="row2" style="margin-top:14px"><button class="btn gray" data-act="close">취소</button><button class="btn primary" data-act="eatSave">저장</button></div>`);
  }
  // 맛집 핀은 끝이 뾰족한 모양이라 핀 끝 위치를 좌표로
  function eatPickPoint() {
    const pk = $("#pick").getBoundingClientRect(), mr = map.getContainer().getBoundingClientRect();
    return map.unproject([pk.left + pk.width / 2 - mr.left, pk.top + pk.height * 0.45 + 8 - mr.top]);
  }
  function eatPickMap() {
    closeSheet();
    if (S.tab !== "map") setTab("map");
    const me = S.locs[S.who];
    if (me && map.getZoom() < 15) map.flyTo({ center: [me.lon, me.lat], zoom: 16.5 });
    $("#mapCard").hidden = true;
    const box = document.createElement("div");
    box.id = "pick";
    box.innerHTML = `<div class="pick-dot eat-pick">${ic("bowl")}</div>
      <div class="pick-panel">
        <b>지도를 움직여서 가게를 가운데에 맞추세요</b>
        <div class="row2"><button class="btn gray" data-act="pickCancel">취소</button><button class="btn primary" data-act="eatPickOk">여기로 할게요</button></div>
      </div>`;
    $("#mapWrap").appendChild(box);
  }
  async function eatDetail(e) {
    if (!e) return;
    const mine = e["r" + S.who] || 0, ot = e["r" + other()] || 0;
    const myW = e["w" + S.who], otW = e["w" + other()];
    if (S.eatCur !== e.id) E.more = null;
    S.eatCur = e.id;
    const mo = E.more && E.more.id === e.id ? E.more : null;
    const imgs = mo ? mo.imgs : [], visits = mo ? mo.visits : [];
    const html = `
      ${imgs.length ? `<button class="eat-hero" data-act="eatPhView" data-i="0"><img src="/api/eatimg/${imgs[0].id}" alt=""></button>` : ""}
      <div class="eat-d-top"><span class="eat-dot big" style="--c:${catCol(e.cat)}">${ic(catIc(e.cat))}</span>
        <div style="min-width:0;flex:1"><h2 style="margin:0">${esc(e.name)}</h2><span class="sheet-sub">${esc(e.cat || "기타")}${e.addr ? ", " + esc(e.addr) : ""}</span></div>
        <button class="eat-edit" data-act="eatEdit" aria-label="수정">${ic("pen")}</button>
        <button class="eat-heart ${myW ? "on" : ""}" data-act="eatWant" aria-label="가고 싶어요">${ic("heart")}</button></div>
      ${e.status !== "been" ? `<div class="eat-wantline">${myW && otW ? `<b>둘 다 가고 싶어 해요</b>` : myW ? `나는 찜했어요. ${esc(nm(other()))}님은 아직이에요` : otW ? `<b>${esc(nm(other()))}님이 가고 싶어 해요</b>` : "하트를 누르면 가고 싶은 곳으로 찜돼요"}</div>` : ""}
      <div class="eat-photos">
        <button class="eat-ph-add" data-act="eatPhoto" aria-label="사진 추가">${ic("camera")}<span>사진</span></button>
        ${imgs.map((im, i) => `<button class="eat-ph" data-act="eatPhView" data-i="${i}"><img src="/api/eatimg/${im.id}?thumb=1" alt=""></button>`).join("")}
        ${!mo && e.imgN ? `<span class="eat-ph sk"></span>` : ""}
      </div>
      <input type="file" id="eatFile" accept="image/*" multiple hidden>
      <div class="mini-wrap still"><div id="miniDet" class="mini sm"></div><span class="mini-pin" style="--c:${catCol(e.cat)}">${ic("pin")}</span>
        <button class="mini-btn" data-act="eatEdit">${ic("pen")}위치 수정</button><button class="mini-btn r" data-act="eatFly">${ic("target")}큰 지도</button></div>
      <div class="seg eat-st">
        <button class="${e.status !== "been" ? "on" : ""}" data-act="eatSetSt" data-v="want">가보고 싶어요</button>
        <button class="${e.status === "been" ? "on" : ""}" data-act="eatSetSt" data-v="been">가봤어요${e.been ? ` <small>${fmtK(e.been)}</small>` : ""}</button>
      </div>
      <div class="eat-rates">
        <div><span>내 별점</span><span class="stars big tap">${[1, 2, 3, 4, 5].map((i) => `<button class="${i <= mine ? "on" : ""}" data-act="eatRate" data-v="${i}" aria-label="${i}점">${ic("star")}</button>`).join("")}</span></div>
        <div><span>${esc(nm(other()))} 별점</span>${ot ? stars(ot, "big") : `<span class="muted">아직 안 줬어요</span>`}</div>
      </div>
      <div class="eat-sec">
        <div class="eat-sec-h"><b>다녀온 기록</b><span>${visits.length ? visits.length + "번" : ""}</span><button class="btn soft sm" data-act="eatVisitForm">${ic("plus")}다녀왔어요</button></div>
        <div id="eatVisitBox"></div>
        ${visits.length ? `<div class="eat-visits">${visits.map((v) => `<div class="eat-v"><span class="eat-v-d">${fmtK(v.date)}</span><span class="eat-v-m">${v.menu ? esc(v.menu) : `<span class="muted">${TK().noMenu}</span>`}</span><button class="x" data-act="eatVisitDel" data-id="${v.id}" aria-label="지우기">${ic("x")}</button></div>`).join("")}</div>`
          : mo ? `<p class="muted eat-none">${TK().hint}</p>` : ""}
      </div>
      <textarea id="eatMemoE" rows="2" placeholder="${TK().memoE}" maxlength="300">${esc(e.memo || "")}</textarea>
      <div class="eat-acts g3">
        <button data-act="eatPlan">${ic("cal")}<span>같이 가기</span></button>
        <button data-act="eatDm">${ic("send")}<span>디엠 보내기</span></button>
        <button data-act="eatNav">${ic("route")}<span>길찾기</span></button>
        <button data-act="eatFly">${ic("target")}<span>지도에서 보기</span></button>
        <button data-act="eatNaver">${e.link && /kakao/.test(e.link) ? `<span class="kk-logo sm">K</span><span>카카오맵</span>` : `<span class="nv-logo sm">N</span><span>네이버 지도</span>`}</button>
        <button class="del" data-act="eatDel">${ic("trash")}<span>지우기</span></button>
      </div>`;
    const fresh = $("#sheet").hidden || !$("#sheetBox .eat-d-top");
    if (fresh) openSheet(html);
    else {
      const t = document.createElement("template"); t.innerHTML = html;
      // 작은 지도는 다시 만들지 않고 그대로 둠
      const keep = $("#miniDet"), nw = t.content.querySelector("#miniDet");
      if (keep && nw) nw.setAttribute("data-keep", "1");
      morphKids($("#sheetBox"), t.content, true);
    }
    if (fresh || !($("#miniDet") && $("#miniDet").querySelector("canvas"))) setTimeout(() => miniMap("miniDet", e.lat, e.lon, { still: true, zoom: 17 }), fresh ? 320 : 0);
    const ta = $("#eatMemoE");
    ta.onchange = () => api(`eats/${e.id}`, { method: "POST", body: { memo: ta.value } }).then(() => { const x = E.list.find((y) => y.id === e.id); if (x) x.memo = ta.value; toast("메모를 저장했어요"); }).catch((er) => toast(er.message));
    $("#eatFile").onchange = (ev) => { const f = [...ev.target.files]; ev.target.value = ""; if (f.length) eatUpload(e.id, f); };
    if (!mo) {
      try {
        const d = await api(`eats/${e.id}`);
        E.more = { id: e.id, ...d };
        if (S.eatCur === e.id && !$("#sheet").hidden) eatDetail(E.list.find((x) => x.id === e.id) || e);
      } catch {}
    }
  }
  async function eatUpload(id, files) {
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      toast(`사진 올리는 중 ${i + 1}/${files.length}`);
      try { await api(`eats/${id}/img`, { method: "POST", body: { img: await prepPhoto(files[i]) } }); ok++; } catch (e) { toast(e.message); }
    }
    if (ok) toast(`사진 ${ok}장을 올렸어요`);
    E.more = null; await loadEats();
    if (S.eatCur === id) eatDetail(E.list.find((x) => x.id === id));
  }
  function eatRoulette() {
    S.rl = S.rl || { range: 0, cat: "all", only: "want" };
    const r = S.rl;
    const pool = eatPool();
    const usedCats = EAT_CATS.filter((c) => E.list.some((e) => e.cat === c));
    const chip = (k, v, label) => `<button class="chip${r[k] === v ? " on" : ""}" data-act="rlSet" data-k="${k}" data-v="${v}">${label}</button>`;
    openSheet(`
      <h2>오늘 어디 가지</h2>
      <p class="sheet-sub">${pool.length ? `${pool.length}곳 중에서 하나를 골라줄게요` : "조건에 맞는 곳이 없어요. 아래 조건을 바꿔보세요"}</p>
      <div class="rl-reel ${pool.length ? "" : "off"}" id="rlReel"><div class="rl-strip" id="rlStrip"><span>${pool.length ? "?" : "-"}</span></div></div>
      <div id="rlRes"></div>
      <div class="rl-opts">
        <div class="rl-opt"><span>어디서</span><div class="chips">${chip("only", "want", "가볼 곳")}${E.list.some(bothWant) ? chip("only", "both", "둘 다 찜") : ""}${chip("only", "been", "가본 곳")}${chip("only", "all", "전부")}</div></div>
        ${S.locs[S.who] ? `<div class="rl-opt"><span>거리</span><div class="chips">${chip("range", 0, "상관없음")}${chip("range", 1000, "1km")}${chip("range", 3000, "3km")}${chip("range", 10000, "10km")}</div></div>` : ""}
        ${usedCats.length > 1 ? `<div class="rl-opt"><span>종류</span><div class="chips">${chip("cat", "all", "전부")}${usedCats.map((c) => chip("cat", c, c)).join("")}</div></div>` : ""}
      </div>
      <button class="btn primary full rl-go" data-act="rlGo" ${pool.length ? "" : "disabled"}>${ic("sparkle")}뽑기</button>`);
  }
  function eatPool() {
    const r = S.rl, me = S.locs[S.who];
    return E.list.filter((e) => (r.only === "all" || (r.only === "want" ? e.status !== "been" : r.only === "been" ? e.status === "been" : bothWant(e)))
      && (r.cat === "all" || e.cat === r.cat) && (!r.range || !me || distM(me, e) <= r.range));
  }
  // 슬롯처럼 이름이 굴러가다 천천히 멈춤
  function rlSpin() {
    const pool = eatPool(); if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const strip = $("#rlStrip"), go = $(".rl-go");
    $("#rlRes").innerHTML = "";
    if (go) { go.disabled = true; go.innerHTML = `${ic("sparkle")}고르는 중...`; }
    const names = [];
    const N = 28;
    for (let i = 0; i < N; i++) names.push(pool[Math.floor(Math.random() * pool.length)].name);
    names.push(pick.name);
    strip.style.transition = "none";
    strip.style.transform = "translateY(0)";
    strip.innerHTML = names.map((n) => `<span>${esc(n)}</span>`).join("");
    const h = strip.firstElementChild.offsetHeight;
    void strip.offsetWidth;
    strip.style.transition = "transform 2.6s cubic-bezier(.12,.75,.15,1)";
    strip.style.transform = `translateY(${-h * N}px)`;
    let ticks = 0;
    const buzz = setInterval(() => { try { navigator.vibrate && navigator.vibrate(4); } catch {} if (++ticks > 14) clearInterval(buzz); }, 120);
    setTimeout(() => {
      clearInterval(buzz);
      try { navigator.vibrate && navigator.vibrate([25, 50, 25]); } catch {}
      $("#rlReel").classList.add("won");
      setTimeout(() => $("#rlReel") && $("#rlReel").classList.remove("won"), 700);
      const me = S.locs[S.who], rt = avgRate(pick);
      $("#rlRes").innerHTML = `
        <div class="rl-card">
          ${pick.cover ? `<img src="/api/eatimg/${pick.cover}?thumb=1" alt="">` : `<span class="eat-dot big" style="--c:${catCol(pick.cat)}">${ic(catIc(pick.cat))}</span>`}
          <div><b>${esc(pick.name)}</b><span>${[esc(pick.cat || "기타"), me ? fmtDist(distM(me, pick)) : "", rt ? `별점 ${rt.toFixed(1)}` : "", pick.visitN ? `${pick.visitN}번 감` : ""].filter(Boolean).join(" · ")}</span></div>
          <button class="btn primary sm" data-act="rlShow" data-id="${pick.id}">보러 가기</button>
        </div>`;
      if (go) { go.disabled = false; go.innerHTML = `${ic("refresh")}다시 뽑기`; go.classList.replace("primary", "gray"); }
    }, 2700);
  }
  function eatEditSheet(e, draft) {
    const d = draft || { name: e.name, cat: e.cat || "기타", addr: e.addr || "", been: e.been || "", lat: e.lat, lon: e.lon };
    E.edit = { id: e.id, ...d };
    const moved = distM(e, d) > 3;
    openSheet(`
      <h2>${TK().edit}</h2>
      <label class="fl">이름</label>
      <input type="text" id="edName" value="${esc(d.name)}" maxlength="40">
      <label class="fl">종류</label>
      <div class="eat-cats" style="margin-top:0">${EAT_CATS.map((c) => `<button class="cchip${c === d.cat ? " on" : ""}" data-act="edCat" data-v="${c}" style="--c:${catCol(c)}">${ic(catIc(c))}${c}</button>`).join("")}</div>
      <label class="fl">주소</label>
      <input type="text" id="edAddr" value="${esc(d.addr)}" placeholder="주소 (없어도 돼요)" maxlength="120">
      <label class="fl">위치 <span class="fl-sub" id="edMoved">${moved ? `원래 자리에서 ${fmtDist(distM(e, d))} 옮김` : "지도를 움직여 핀을 맞춰요"}</span></label>
      <div class="mini-wrap"><div id="miniEd" class="mini"></div><span class="mini-pin">${ic("pin")}</span><button class="mini-reset" data-act="edReset">원래 자리</button><button class="mini-reset l" data-act="edPick">크게 보기</button></div>
      ${e.status === "been" ? `<label class="fl">처음 간 날</label><input type="date" id="edBeen" value="${esc(d.been)}" max="${today()}">` : ""}
      <div class="row2" style="margin-top:16px"><button class="btn gray" data-act="edCancel">취소</button><button class="btn primary" data-act="edSave">저장</button></div>`);
    edMini(e);
  }
  function edMini(e) {
    setTimeout(() => miniMap("miniEd", E.edit.lat, E.edit.lon, { onMove: (la, lo) => {
      E.edit.lat = la; E.edit.lon = lo;
      const m = $("#edMoved"); if (m) { const dd = distM(e, { lat: la, lon: lo }); m.textContent = dd > 3 ? `원래 자리에서 ${fmtDist(dd)} 옮김` : "지도를 움직여 핀을 맞춰요"; }
    } }), 320);
  }
  function edCollect() {
    const ed = E.edit;
    if ($("#edName")) ed.name = $("#edName").value;
    if ($("#edAddr")) ed.addr = $("#edAddr").value;
    if ($("#edBeen")) ed.been = $("#edBeen").value;
    return ed;
  }
  function eatPlanSheet() {
    const e = E.list.find((x) => x.id === S.eatCur);
    openSheet(`
      <h2>같이 가기</h2>
      <p class="sheet-sub">${esc(e.name)}에 갈 날을 정하면 달력에 넣고 ${esc(nm(other()))}님에게 디엠으로 알려줘요</p>
      <div class="row2" style="margin-top:12px"><input type="date" id="plD" value="${addDays(today(), 1)}" min="${today()}"><input type="time" id="plT" value="18:00"></div>
      <div class="row2" style="margin-top:14px"><button class="btn gray" data-act="eatPlanBack">뒤로</button><button class="btn primary" data-act="eatPlanSave">${ic("check")}정하기</button></div>`);
  }
  async function eatUpdate(body) {
    const id = S.eatCur;
    try { await api(`eats/${id}`, { method: "POST", body }); } catch (e) { return toast(e.message); }
    await loadEats();
    eatDetail(E.list.find((x) => x.id === id));
  }

  const speedTxt = (l) => { if (!l || l.vel == null || S.locNow - l.t > 10 * 60000) return ""; const v = Number(l.vel); return v >= 4 ? `이동 중 ${v}km/h` : "멈춰 있음"; };
  function renderMapCard() {
    if (S.trail) return renderTrailCard();
    if (S.eatOn) return renderEatCard();
    const la = S.locs.a, lb = S.locs.b, o = other(), lo = S.locs[o];
    const who = (w) => { const l = S.locs[w]; return `<button class="mc-p" data-act="flyTo" data-w="${w}">${av(w)}<span>${l ? ago(l.t, S.locNow) : "-"}</span></button>`; };
    const sp = speedTxt(lo), bt = lo && lo.batt != null ? `배터리 ${lo.batt}%` : "";
    $("#mapCard").innerHTML = `
      <div class="mc">
        ${who(S.who)}
        <button class="mc-mid" data-act="fitMap"><b>${S.together ? "함께 있어요" : la && lb ? fmtDist(distM(la, lb)) : "-"}</b><span>${S.autoLoc === "denied" ? "위치 권한 필요" : S.together ? (la && lb ? fmtDist(distM(la, lb)) : "") : "우리 사이"}</span></button>
        ${who(o)}
      </div>
      ${sp || bt ? `<div class="mc-info">${esc(nm(o))} ${[sp, bt].filter(Boolean).join(", ")}</div>` : ""}
      <div class="mc-acts">
        <button data-act="trailOpen">${ic("route")}<span>이동 기록</span></button>
        <button data-act="navTo" ${lo ? "" : "disabled"}>${ic("target")}<span>길찾기</span></button>
        <button data-act="locReq">${ic("bell")}<span>위치 요청</span></button>
      </div>`;
  }
  // 경로 다듬기: 오차 큰 점·튀는 점 버리고, 한곳에 머문 구간은 한 점으로 묶고, 이동 구간은 살짝 매끄럽게
  function cleanTrail(raw) {
    let p = raw.filter((x) => x.acc == null || x.acc <= 80);
    // 앞뒤는 가까운데 혼자 멀리 튄 점 제거
    for (let pass = 0; pass < 2; pass++) {
      p = p.filter((x, i) => {
        const a = p[i - 1], b = p[i + 1];
        if (!a || !b) return true;
        const da = distM(a, x), db = distM(x, b), ab = distM(a, b);
        return !(da > 120 && db > 120 && ab < Math.min(da, db) * 0.5);
      });
    }
    // 머문 곳 찾기: 반경 60m 안에 5분 넘게 있으면 한 곳
    const stays = [], seg = [];
    let i = 0;
    while (i < p.length) {
      let j = i, cLat = p[i].lat, cLon = p[i].lon, n = 1;
      while (j + 1 < p.length && distM({ lat: cLat, lon: cLon }, p[j + 1]) < 60) {
        j++; n++; cLat += (p[j].lat - cLat) / n; cLon += (p[j].lon - cLon) / n;
      }
      if (j > i && p[j].t - p[i].t >= 5 * 60000) {
        const st = { lat: cLat, lon: cLon, t0: p[i].t, t1: p[j].t, stay: true };
        stays.push(st); seg.push(st); i = j + 1;
      } else { seg.push(p[i]); i++; }
    }
    // 가까이 붙어 있는 머문 곳은 하나로 합침 (사이에 흔들린 점 몇 개가 끼어 있어도)
    for (let k = 0; k < seg.length; k++) {
      const A = seg[k];
      if (!A.stay) continue;
      let j = k + 1;
      while (j < seg.length && !seg[j].stay && distM(A, seg[j]) < 120) j++;
      const B = seg[j];
      if (B && B.stay && distM(A, B) < 100 && B.t0 - A.t1 < 10 * 60000) {
        const wa = A.t1 - A.t0 + 1, wb = B.t1 - B.t0 + 1;
        A.lat = (A.lat * wa + B.lat * wb) / (wa + wb); A.lon = (A.lon * wa + B.lon * wb) / (wa + wb); A.t1 = B.t1;
        stays.splice(stays.indexOf(B), 1);
        seg.splice(k + 1, j - k);
        k--;
      }
    }
    // 이동 구간 매끄럽게 (머문 곳은 그대로)
    const path = seg.map((x, k) => {
      if (x.stay) return x;
      const a = seg[k - 1], b = seg[k + 1];
      if (!a || !b || a.stay || b.stay) return x;
      return { ...x, lat: (a.lat + 2 * x.lat + b.lat) / 4, lon: (a.lon + 2 * x.lon + b.lon) / 4 };
    });
    let dist = 0;
    for (let k = 1; k < path.length; k++) dist += distM(path[k - 1], path[k]);
    return { path, stays, dist };
  }
  // 머문 곳 이름: 등록한 장소나 맛집 근처면 그 이름
  function stayName(st) {
    let best = null, bd = Infinity;
    for (const pl of S.places || []) { const d = distM(st, pl); if (d < Math.max(80, pl.radius || 0) && d < bd) { bd = d; best = pl.name; } }
    for (const e of E.list || []) { const d = distM(st, e); if (d < 60 && d < bd) { bd = d; best = e.name; } }
    return best;
  }
  const durTxt = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? " " + (m % 60) + "분" : ""}` : `${m}분`; };

  // 이동 기록: 사람·날짜 고르면 경로 + 들르고 떠난 장소
  async function loadTrail() {
    const t = S.trail; if (!t) return;
    const d = t.day === 0 ? today() : addDays(today(), -t.day);
    try {
      const r = await api(`history?w=${t.w}&date=${d}`);
      if (!S.trail || S.trail !== t) return;
      t.data = r;
      const c = t.w === "a" ? "#E5406A" : "#5C6BF0";
      if (!E.list.length) { try { E.list = (await api("eats")).eats; } catch {} }
      const cl = cleanTrail(r.points);
      t.clean = cl; t.dist = cl.dist;
      const coords = cl.path.map((p) => [p.lon, p.lat]);
      const feats = [];
      if (coords.length > 1) feats.push({ type: "Feature", properties: { c }, geometry: { type: "LineString", coordinates: coords } });
      if (coords.length) { feats.push({ type: "Feature", properties: { c, r: 5 }, geometry: { type: "Point", coordinates: coords[0] } }); feats.push({ type: "Feature", properties: { c, r: 5 }, geometry: { type: "Point", coordinates: coords[coords.length - 1] } }); }
      for (const st of cl.stays) feats.push({ type: "Feature", properties: { c, r: 9 }, geometry: { type: "Point", coordinates: [st.lon, st.lat] } });
      if (mapLoaded) map.getSource("trail").setData({ type: "FeatureCollection", features: feats });
      if (coords.length > 1) {
        const xs = coords.map((p) => p[0]), ys = coords.map((p) => p[1]);
        map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: { top: 120, bottom: 360, left: 50, right: 50 }, maxZoom: 16 });
      } else if (coords.length) map.flyTo({ center: coords[0], zoom: 15 });
      renderTrailCard();
    } catch (e) { toast(e.message); }
  }
  function renderTrailCard() {
    const t = S.trail, r = t.data;
    const chip = (act, val, cur, label) => `<button class="chip${val === cur ? " on" : ""}" data-act="${act}" data-v="${val}">${label}</button>`;
    let body = `<div class="spin" style="margin:18px auto"></div>`;
    if (r) {
      const tl = [];
      const cl = t.clean || { stays: [] };
      if (r.points.length) tl.push({ t: r.points[0].t, txt: "기록 시작" });
      r.events.forEach((e) => tl.push({ t: e.t, txt: `${e.place} ${e.inside ? "도착" : "떠남"}`, ev: e.inside ? "in" : "out" }));
      cl.stays.forEach((st) => tl.push({ t: st.t0, txt: `${stayName(st) || "한곳"}에 ${durTxt(st.t1 - st.t0)} 머묾`, ev: "stay", lat: st.lat, lon: st.lon }));
      if (r.points.length > 1) tl.push({ t: r.points[r.points.length - 1].t, txt: t.day === 0 ? "마지막 위치" : "기록 끝" });
      tl.sort((x, y) => x.t - y.t);
      body = r.points.length
        ? `<div class="tr-sum"><b>${fmtDist(t.dist)}</b><span>움직인 거리</span></div>
           <div class="tr-tl">${tl.map((x) => x.lat ? `<button class="tr-i ${x.ev || ""}" data-act="trailFly" data-lat="${x.lat}" data-lon="${x.lon}"><i></i><span>${hm(x.t)}</span><b>${esc(x.txt)}</b></button>` : `<div class="tr-i ${x.ev || ""}"><i></i><span>${hm(x.t)}</span><b>${esc(x.txt)}</b></div>`).join("")}</div>`
        : `<div class="empty" style="padding:18px 0">이날 기록이 없어요<br><small>사이트나 OwnTracks가 켜져 있을 때 기록돼요</small></div>`;
    }
    $("#mapCard").innerHTML = `
      <div class="tr">
        <div class="tr-top">
          <div class="chips">${chip("trailWho", S.who, t.w, "나")}${chip("trailWho", other(), t.w, esc(nm(other())))}</div>
          <div class="chips">${chip("trailDay", 0, t.day, "오늘")}${chip("trailDay", 1, t.day, "어제")}${chip("trailDay", 2, t.day, "그제")}</div>
          <button class="icon-btn" data-act="trailClose" aria-label="닫기">${ic("x")}</button>
        </div>
        ${body}
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
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
  }
  const geoMsg = (e) => ({ 1: "위치 권한을 허용해 주세요 (설정 > Safari > 위치)", 2: "위치를 찾을 수 없어요", 3: "위치 찾기 시간 초과" }[e.code] || e.message);
  async function batt() {
    try { if (navigator.getBattery) return Math.round((await navigator.getBattery()).level * 100); } catch {}
    return null;
  }
  async function sendPos(p) {
    const sp = p.coords.speed;
    await api("loc", { method: "POST", body: { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, vel: sp != null && sp >= 0 ? Math.round(sp * 3.6) : null, batt: await batt() } });
    S.lastSent = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now(), acc: p.coords.accuracy };
    refreshLoc();
  }
  // 사이트를 열면 항상 자동으로 내 위치를 보냄 (50m 움직이거나 2분마다)
  function startAutoLoc() {
    if (S.watchId !== null || !navigator.geolocation) return;
    S.autoLoc = "wait";
    S.watchId = navigator.geolocation.watchPosition((p) => {
      S.autoLoc = "on";
      const now = Date.now(), cur = { lat: p.coords.latitude, lon: p.coords.longitude }, acc = p.coords.accuracy || 999;
      const L = S.lastSent, since = L ? now - L.t : Infinity, d = L ? distM(L, cur) : Infinity;
      // 정확한 위치(오차 50m 이하)를 우선 보내고, 흐린 위치는 3분 넘게 못 보냈을 때만
      const good = acc <= 50;
      const due = !L
        || (good && since > 8000 && d > Math.max(20, acc))
        || (good && since > 60000)
        || (good && L.acc > 60 && acc < L.acc / 2)
        || since > 180000;
      if (due) { sendPos(p).catch(() => {}); S.lastSent = { ...cur, t: now, acc }; }
      if (S.tab === "map" && !$("#pick")) renderMapCard();
    }, (e) => {
      if (e.code === 1) { S.autoLoc = "denied"; navigator.geolocation.clearWatch(S.watchId); S.watchId = null; }
      if (S.tab === "map") renderMapCard();
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }
  function stopAutoLoc() { if (S.watchId !== null) { navigator.geolocation.clearWatch(S.watchId); S.watchId = null; } }



  // ---------- DM 채팅 ----------
  const hm = (t) => { const d = new Date(t), h = d.getHours(); return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${pad(d.getMinutes())}`; };
  const fmtTime = (t) => {
    const d = new Date(t), ds = ymd(d);
    if (ds === today()) return hm(t);
    if (ds === addDays(today(), -1)) return "어제 " + hm(t);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm(t)}`;
  };
  const dayLabel = (t) => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${"일월화수목금토"[d.getDay()]}요일`; };
  const linkify = (h) => h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const C = { busy: false, editing: null };

  async function openChat() {
    $("#dmAv").innerHTML = av(other());
    $("#dmName").textContent = nm(other());
    if (!S.chat) { S.chat = { msgs: [], read: { a: 0, b: 0 }, readT: {}, more: true, first: true }; $("#dmList").innerHTML = skelChat(); $("#dmList")._map = null; }
    drawPresence();
    await refreshChat(true);
  }
  const skelChat = () => `<div class="sk-chat">${[60, 40, 70, 50, 65].map((w, i) => `<i class="sk ${i % 2 ? "me" : ""}" style="width:${w}%"></i>`).join("")}</div>`;
  function drawPresence() {
    const c = S.chat || {}, now = Date.now() + (S.clockOff || 0) * 0;
    let txt, on = false;
    if (c.typingOn) { txt = "입력 중..."; on = true; }
    else if (c.seen && Date.now() - S.clockOff - c.seen < 70000) { txt = "활동 중"; on = true; }
    else if (c.seen) txt = `${ago(c.seen, Date.now() - S.clockOff)} 활동`;
    else txt = "우리 둘만의 대화";
    $("#dmSub").innerHTML = `${on ? '<i class="live-dot"></i>' : ""}${txt}`;
  }
  async function refreshChat(stick) {
    if (C.busy) return;
    C.busy = true;
    try {
      const d = await api("messages?limit=40");
      if (d.now) S.clockOff = d.now - Date.now();
      const minId = d.messages.length ? d.messages[0].id : Infinity;
      const older = S.chat.msgs.filter((m) => typeof m.id === "number" && m.id < minId);
      let pending = S.chat.msgs.filter((m) => String(m.id).startsWith("tmp") && !m.done);
      // 서버에 이미 들어간 내 메시지는 보내는 중 말풍선과 짝지어서 같은 자리 유지
      for (const m of d.messages) {
        if (m.who !== S.who || cidOf[m.id] || (S.chat.shown && S.chat.shown.has(m.id))) continue;
        const tm = pending.find((p) => !p.failed && (p.kind || "text") === (m.kind || "text") && (p.text || "") === (m.text || "") && !!(p.local) === !!m.img);
        if (tm) { cidOf[m.id] = String(tm.id); tm.done = true; }
      }
      pending = pending.filter((p) => !p.done);
      const before = S.chat.sig;
      S.chat.msgs = older.concat(d.messages, pending);
      S.chat.read = d.read; S.chat.readT = d.readT || {}; S.chat.seen = d.seen; S.chat.pin = d.pin;
      S.chat.typingOn = !!(d.typing && d.now - d.typing < 6000);
      if (S.chat.first) { S.chat.more = d.messages.length >= 40; S.chat.first = false; }
      S.chat.sig = JSON.stringify([d.messages.map((m) => [m.id, m.text, m.reacts, m.pinned, m.edited]), d.read, S.chat.typingOn]);
      if (stick || before !== S.chat.sig || !$("#dmList .dm-row, #dmList .dm-empty")) drawChat(stick);
      drawPresence(); drawPin();
      const last = d.messages[d.messages.length - 1];
      if (last && last.id > (S.chat.read[S.who] || 0) && S.tab === "chat" && !document.hidden) {
        S.chat.read[S.who] = last.id;
        api("read", { method: "POST", body: { id: last.id } }).catch(() => {});
      }
      $("#cBadge").hidden = true;
    } catch {} finally { C.busy = false; }
  }
  function drawPin() {
    const p = S.chat && S.chat.pin, el = $("#dmPin");
    if (!p) { el.hidden = true; return; }
    el.innerHTML = `${ic("pinned")}<span><b>고정된 메시지</b>${esc(p.text || "사진")}</span>`;
    el.dataset.id = p.id; el.hidden = false;
  }
  function bubbleInner(m, ms) {
    if (m.kind === "heart") return `<span class="big-heart">${HEART}</span>`;
    if (m.kind === "event" && m.meta) {
      const e = m.meta;
      return `<span class="ev-card" data-date="${e.date}"><span class="ev-d"><em>${Number(e.date.slice(5, 7))}월</em><b>${Number(e.date.slice(8))}</b></span><span><b>${esc(e.title)}</b><em>${fmtK(e.date)}${e.time ? " " + esc(e.time) : ""}</em></span></span>${m.text ? `<span class="tx">${linkify(esc(m.text))}</span>` : ""}`;
    }
    if (m.kind === "loc" && m.meta) return `<span class="loc-card" data-lat="${m.meta.lat}" data-lon="${m.meta.lon}">${ic("pin")}<span><b>${m.meta.name ? esc(m.meta.name) : m.who === S.who ? "내 위치" : esc(nm(m.who)) + "님 위치"}</b><em>지도에서 보기</em></span></span>`;
    let rq = "";
    if (m.reply) {
      const src = ms.find((x) => x.id === m.reply);
      rq = `<span class="rq" data-goto="${m.reply}"><b>${src ? esc(nm(src.who)) : "이전 메시지"}</b>${src ? esc(src.text || "사진") : ""}</span>`;
    }
    const imgHtml = m.img || m.local ? `<img class="dm-img" src="${m.local || `/api/chatimg/${m.img}?thumb=1`}" style="aspect-ratio:${m.w || 4}/${m.h || 3}" data-img="${m.img || ""}" alt="">` : "";
    return `${rq}${imgHtml}${m.text ? `<span class="tx">${linkify(esc(m.text))}</span>` : ""}`;
  }
  // 화면 전체를 다시 그리지 않고 바뀐 줄만 바꿔서 깜빡임 없이 (인스타처럼)
  const cidOf = {};
  const keyOf = (m) => "m" + (cidOf[m.id] || m.id);
  function chatParts() {
    const ms = S.chat.msgs, GAP = 20 * 60000, out = [];
    const readUpTo = S.chat.read[other()] || 0;
    if (S.chat.more) out.push(["more", `<button class="dm-more" data-act="dmMore">이전 메시지 보기</button>`]);
    ms.forEach((m, i) => {
      const prev = ms[i - 1], next = ms[i + 1];
      const newDay = !prev || ymd(new Date(prev.t)) !== ymd(new Date(m.t));
      if (newDay) out.push(["d" + ymd(new Date(m.t)), `<div class="dm-day"><span>${dayLabel(m.t)}</span></div>`]);
      else if (m.t - prev.t > GAP) out.push(["t" + keyOf(m), `<div class="dm-time">${hm(m.t)}</div>`]);
      const first = newDay || !prev || prev.who !== m.who || m.t - prev.t > GAP;
      const last = !next || next.who !== m.who || next.t - m.t > GAP || ymd(new Date(next.t)) !== ymd(new Date(m.t));
      const mine = m.who === S.who;
      const rx = Object.entries(m.reacts || {});
      const rxHtml = rx.length ? `<span class="dm-rx">${rx.map(([w, r]) => `<i class="${w} r-${r}">${ic(r)}</i>`).join("")}</span>` : "";
      const tmp = String(m.id).startsWith("tmp");
      const unread = mine && !tmp && m.id > readUpTo ? `<span class="dm-1">1</span>` : "";
      const meta = last ? `<span class="dm-meta">${m.failed ? `<button class="dm-retry" data-act="dmRetry" data-id="${m.id}">다시 보내기</button>` : tmp ? "" : hm(m.t)}${m.edited ? " · 수정됨" : ""}</span>` : (m.edited ? `<span class="dm-meta">수정됨</span>` : "");
      const cls = m.kind === "heart" ? " heart" : m.kind === "loc" ? " loc" : m.kind === "event" ? " evm" : "";
      out.push([keyOf(m), `<div class="dm-row ${mine ? "me" : "ot"}${first ? " first" : ""}${last ? " last" : ""}${rx.length ? " liked" : ""}${tmp ? " sending" : ""}" id="m${m.id}">
        ${mine ? "" : last ? av(m.who) : '<span class="av-sp"></span>'}
        ${mine ? `<span class="dm-side">${unread}${meta}</span>` : ""}
        <div class="dm-bub${cls}${m.img || m.local ? " has-img" : ""}${(m.img || m.local) && !m.text ? " only-img" : ""}" data-mid="${m.id}" data-mine="${mine ? 1 : 0}">${bubbleInner(m, ms)}${rxHtml}</div>
        ${mine ? "" : `<span class="dm-side">${meta}</span>`}
      </div>`, !mine || tmp]);
    });
    const lastMine = [...ms].reverse().find((m) => m.who === S.who && typeof m.id === "number");
    const lastAll = ms[ms.length - 1];
    if (lastMine && lastAll.who === S.who && readUpTo >= lastMine.id && S.chat.readT[other()]) {
      out.push(["seen", `<div class="dm-seen">${fmtTime(S.chat.readT[other()])} 읽음</div>`]);
    }
    if (S.chat.typingOn) out.push(["typing", `<div class="dm-row ot first last typing">${av(other())}<div class="dm-bub"><i></i><i></i><i></i></div></div>`]);
    return out;
  }
  const tplEl = document.createElement("template");
  // 같은 줄이면 바뀐 부분(읽음 1, 시간, 반응)만 바꿔서 사진이 다시 깜빡이지 않게
  function morph(el, nw) {
    if (el.tagName !== nw.tagName || el.children.length !== nw.children.length) return false;
    const keep = el.className.split(" ").filter((c) => c === "fresh");
    el.className = nw.className + (keep.length ? " fresh" : "");
    if (el.id !== nw.id) el.id = nw.id;
    [...nw.children].forEach((c, i) => {
      const o = el.children[i];
      if (o.outerHTML === c.outerHTML) return;
      if (o.classList.contains("dm-bub") && c.classList.contains("dm-bub")) {
        for (const a of ["data-mid", "data-mine", "class"]) o.setAttribute(a, c.getAttribute(a));
        if (o.innerHTML !== c.innerHTML) {
          const oi = o.querySelector("img"), ci = c.querySelector("img");
          if (oi && ci && oi.getAttribute("src") !== ci.getAttribute("src") && oi.complete) {
            // 보내는 중 미리보기를 서버 사진으로 바꿀 때 다 불러온 뒤 교체
            const pre = new Image(); pre.onload = () => { oi.src = ci.getAttribute("src"); oi.dataset.img = ci.dataset.img || ""; }; pre.src = ci.getAttribute("src");
            const rxN = o.querySelector(".dm-rx"), rxC = c.querySelector(".dm-rx");
            if (rxN) rxN.remove(); if (rxC) o.appendChild(rxC.cloneNode(true));
          } else o.innerHTML = c.innerHTML;
        }
      } else o.replaceWith(c.cloneNode(true));
    });
    return true;
  }
  function drawChat(stick, quiet) {
    const L = $("#dmList");
    const atBottom = L.scrollHeight - L.scrollTop - L.clientHeight < 140;
    if (!S.chat.msgs.length) { L.innerHTML = `<div class="dm-empty">${av(other())}<br><b>${esc(nm(other()))}</b>님에게<br>첫 메시지를 보내보세요</div>`; L._map = null; return; }
    if (!L._map) { L.innerHTML = ""; L._map = new Map(); }
    const old = L._map, next = new Map();
    const firstDraw = old.size === 0 || quiet;
    let added = false, cursor = L.firstChild;
    for (const [key, html, animate] of chatParts()) {
      let el = old.get(key);
      if (!el || el._h !== html) {
        tplEl.innerHTML = html.trim();
        const fresh = tplEl.content.firstElementChild;
        fresh._h = html;
        if (!el && !firstDraw && animate) { fresh.classList.add("fresh"); added = true; }
        if (!el && !firstDraw) added = true;
        if (el && morph(el, fresh)) { el._h = html; }
        else {
          if (el) { el.replaceWith(fresh); if (cursor === el) cursor = fresh; }
          el = fresh;
        }
      }
      next.set(key, el);
      if (el !== cursor) L.insertBefore(el, cursor);
      else cursor = cursor.nextSibling;
    }
    for (const [k, el] of old) if (!next.has(k) && el.parentNode) el.remove();
    // 남은 옛 요소(빈 화면 문구 등) 정리
    [...L.children].forEach((el) => { if (![...next.values()].includes(el)) el.remove(); });
    L._map = next;
    S.chat.shown = new Set(S.chat.msgs.map((m) => m.id));
    if (quiet) return;
    if (stick || firstDraw) {
      L.scrollTop = L.scrollHeight;
      L.querySelectorAll("img").forEach((im) => { if (!im.complete) im.addEventListener("load", () => { L.scrollTop = L.scrollHeight; }, { once: true }); });
      $("#dmJump").hidden = true;
    } else if (atBottom) {
      L.scrollTo({ top: L.scrollHeight, behavior: "smooth" });
    } else if (added) {
      $("#dmJump").hidden = false;
    }
  }
  function updateSendBtn() {
    const has = $("#dmText").value.trim().length > 0;
    const b = $("#dmSend");
    b.classList.toggle("has", has);
    b.innerHTML = has ? ic("up") : ic("heart");
    b.setAttribute("aria-label", has ? "보내기" : "하트 보내기");
  }
  function autosize() { const t = $("#dmText"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }
  async function postMsg(body, tmp) {
    try { const r = await api("messages", { method: "POST", body }); tmp.done = true; if (r && r.id) cidOf[r.id] = String(tmp.id); }
    catch (e) { tmp.failed = true; tmp.body = body; drawChat(); toast("전송 실패: 다시 보내기를 눌러주세요"); }
    refreshChat();
  }
  async function sendChat() {
    const inp = $("#dmText");
    const text = inp.value.trim();
    if (C.editing) {
      if (!text) return;
      const id = C.editing; setEdit(null); inp.value = ""; autosize(); updateSendBtn();
      const m = S.chat.msgs.find((x) => x.id === id); if (m) { m.text = text; m.edited = true; drawChat(); }
      try { await api(`messages/${id}/edit`, { method: "POST", body: { text } }); } catch (e) { toast(e.message); }
      return refreshChat();
    }
    if (!text) return sendHeart();
    inp.value = ""; autosize(); updateSendBtn();
    const reply = S.replyTo ? S.replyTo.id : null;
    const tmp = { id: "tmp" + Date.now(), who: S.who, text, reacts: {}, t: Date.now(), reply };
    S.chat.msgs.push(tmp);
    setReply(null);
    drawChat(true);
    postMsg({ text, reply }, tmp);
  }
  function sendHeart() {
    const tmp = { id: "tmp" + Date.now(), who: S.who, text: "", kind: "heart", reacts: {}, t: Date.now() };
    S.chat.msgs.push(tmp); drawChat(true);
    try { navigator.vibrate && navigator.vibrate(15); } catch {}
    postMsg({ kind: "heart" }, tmp);
  }
  async function sendMyLoc() {
    toast("위치 찾는 중...");
    try {
      const p = await getPos();
      const body = { kind: "loc", lat: p.coords.latitude, lon: p.coords.longitude };
      const tmp = { id: "tmp" + Date.now(), who: S.who, text: "", kind: "loc", meta: { lat: body.lat, lon: body.lon }, reacts: {}, t: Date.now() };
      S.chat.msgs.push(tmp); drawChat(true);
      postMsg(body, tmp);
      sendPos(p).catch(() => {});
    } catch (e) { toast(e.code ? geoMsg(e) : e.message); }
  }
  const RX = ["heart", "sparkle", "star", "fire", "like", "hug"];
  async function reactMsg(id, r, bub) {
    if (!id || String(id).startsWith("tmp")) return;
    if (bub) bub.insertAdjacentHTML("beforeend", `<svg class="dm-pop r-${r}"><use href="#i-${r}"/></svg>`);
    const m = S.chat.msgs.find((x) => String(x.id) === String(id));
    if (m) { m.reacts = { ...(m.reacts || {}) }; if (m.reacts[S.who] === r) delete m.reacts[S.who]; else m.reacts[S.who] = r; }
    setTimeout(() => drawChat(), bub ? 600 : 0);
    try { const res = await api(`messages/${id}/react`, { method: "POST", body: { r } }); if (m) m.reacts = res.reacts; } catch (e) { toast(e.message); }
  }
  async function sendChatPhotos(files) {
    for (const f of files) {
      const local = URL.createObjectURL(f);
      const tmp = { id: "tmp" + Date.now() + Math.random(), who: S.who, text: "", reacts: {}, t: Date.now(), local, w: 4, h: 3 };
      S.chat.msgs.push(tmp); drawChat(true);
      try {
        const p = await prepPhoto(f, 720);
        tmp.w = p.w; tmp.h = p.h;
        const r = await api("messages", { method: "POST", body: { img: p } });
        if (r && r.id) cidOf[r.id] = String(tmp.id);
      } catch (e) { tmp.failed = true; toast("사진 전송 실패: " + e.message); }
    }
    refreshChat(true);
  }
  function setReply(m) {
    S.replyTo = m;
    if (m) C.editing = null;
    const box = $("#dmReply");
    if (!m) { if (!C.editing) { box.hidden = true; box.innerHTML = ""; } return; }
    box.innerHTML = `<div><b>${esc(nm(m.who))}에게 답장</b><span>${esc(m.text || (m.kind === "heart" ? "하트" : "사진"))}</span></div><button data-act="replyCancel" aria-label="취소">${ic("x")}</button>`;
    box.hidden = false;
    $("#dmText").focus();
  }
  function setEdit(m) {
    C.editing = m ? m.id : null;
    const box = $("#dmReply");
    if (!m) { box.hidden = true; box.innerHTML = ""; return; }
    S.replyTo = null;
    box.innerHTML = `<div><b>메시지 수정</b><span>${esc(m.text)}</span></div><button data-act="editCancel" aria-label="취소">${ic("x")}</button>`;
    box.hidden = false;
    const t = $("#dmText"); t.value = m.text; autosize(); updateSendBtn(); t.focus();
  }
  function flashMsg(id) {
    const row = $("#m" + id);
    if (!row) return false;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
    return true;
  }
  async function gotoMsg(id) {
    for (let i = 0; i < 12 && !$("#m" + id); i++) {
      if (!S.chat.more) break;
      await ACT.dmMore();
    }
    if (!flashMsg(id)) toast("메시지를 찾을 수 없어요");
  }
  let typingAt = 0;
  $("#dmText").addEventListener("input", () => {
    autosize(); updateSendBtn();
    if (Date.now() - typingAt > 3000 && $("#dmText").value.trim()) { typingAt = Date.now(); api("typing", { method: "POST", body: {} }).catch(() => {}); }
  });

  // 길게 누르면 반응 + 메뉴
  function openRx(bub) {
    const id = bub.dataset.mid;
    if (String(id).startsWith("tmp")) return;
    const m = S.chat.msgs.find((x) => String(x.id) === id);
    const mineR = m && m.reacts ? m.reacts[S.who] : null;
    const rect = bub.getBoundingClientRect();
    const canEdit = m && m.who === S.who && m.text && Date.now() - m.t < 15 * 60000;
    const box = $("#rx");
    box.innerHTML = `<div class="rx-bg" data-act="rxClose"></div>
      <div class="rx-bar" style="top:${Math.max(70, rect.top - 64)}px">
        ${RX.map((r) => `<button class="${mineR === r ? "on" : ""} r-${r}" data-act="rxPick" data-r="${r}" data-id="${id}">${ic(r)}</button>`).join("")}
      </div>
      <div class="rx-menu" style="top:${Math.min(innerHeight - 290, rect.bottom + 10)}px">
        <button data-act="rxReply" data-id="${id}">${ic("send")}답장</button>
        ${m && m.text ? `<button data-act="rxCopy" data-id="${id}">${ic("copy")}복사</button>` : ""}
        <button data-act="rxPin" data-id="${id}">${ic("pinned")}${m && m.pinned ? "고정 해제" : "위에 고정"}</button>
        ${canEdit ? `<button data-act="rxEdit" data-id="${id}">${ic("pen")}수정</button>` : ""}
        ${bub.dataset.mine === "1" ? `<button class="del" data-act="rxDel" data-id="${id}">${ic("trash")}보내기 취소</button>` : ""}
      </div>`;
    box.hidden = false;
    bub.classList.add("held");
    S.rxBub = bub;
  }
  function closeRx() { $("#rx").hidden = true; if (S.rxBub) S.rxBub.classList.remove("held"); S.rxBub = null; }
  async function searchSheet() {
    openSheet(`
      <h2>메시지 검색</h2>
      <div class="add-row" style="margin-top:10px"><input type="text" id="srchQ" placeholder="찾을 말" maxlength="40"><button class="btn primary" data-act="srchGo" aria-label="검색">${ic("search")}</button></div>
      <div id="srchRes"></div>`);
    setTimeout(() => $("#srchQ") && $("#srchQ").focus(), 300);
  }
  async function doSearch() {
    const qv = $("#srchQ").value.trim();
    if (!qv) return;
    const { results } = await api(`msgsearch?q=${encodeURIComponent(qv)}`);
    const re = new RegExp(qv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    $("#srchRes").innerHTML = results.length ? `<div class="list" style="margin-top:12px">${results.map((r) => `
      <button class="li" data-act="srchPick" data-id="${r.id}"><span class="li-t"><b>${esc(r.text).replace(re, (x) => `<mark>${x}</mark>`)}</b><span>${esc(nm(r.who))} · ${fmtTime(r.t)}</span></span></button>`).join("")}</div>`
      : `<div class="empty">찾는 메시지가 없어요</div>`;
  }
  // 톡 두 번 = 하트, 길게 = 메뉴, 사진·위치·답장 미리보기 톡 = 이동
  (() => {
    let lastTap = { id: null, t: 0 }, pressT = null, opened = false, tapTimer = null;
    const L = $("#dmList");
    L.addEventListener("click", (e) => {
      const rq = e.target.closest(".rq");
      if (rq) { gotoMsg(Number(rq.dataset.goto)); return; }
      const ec = e.target.closest(".ev-card");
      if (ec) { const d = ec.dataset.date; S.cal = { y: +d.slice(0, 4), m: +d.slice(5, 7) - 1, sel: d }; S.memView = "cal"; setTab("calendar"); return; }
      const lc = e.target.closest(".loc-card");
      if (lc) { S.flyTo = { lat: +lc.dataset.lat, lon: +lc.dataset.lon }; setTab("map"); return; }
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
    // 옆으로 밀면 답장 (인스타처럼)
    let sw = null;
    L.addEventListener("touchstart", (e) => {
      const row = e.target.closest(".dm-row:not(.typing)");
      if (row && e.touches.length === 1) sw = { row, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, on: false };
    }, { passive: true });
    L.addEventListener("touchmove", (e) => {
      if (!sw) return;
      const dx = e.touches[0].clientX - sw.x, dy = e.touches[0].clientY - sw.y;
      if (!sw.on) {
        if (Math.abs(dy) > 10) { sw = null; return; }
        if (Math.abs(dx) > 12) { sw.on = true; sw.row.classList.add("swiping"); }
        else return;
      }
      const mine = sw.row.classList.contains("me");
      let d = mine ? Math.min(0, dx) : Math.max(0, dx);
      d = Math.sign(d) * Math.min(90, Math.abs(d) * 0.6);
      sw.dx = d;
      sw.row.style.transform = `translateX(${d}px)`;
      sw.row.style.setProperty("--sw", Math.min(1, Math.abs(d) / 50));
      if (Math.abs(d) >= 50 && !sw.buzz) { sw.buzz = true; try { navigator.vibrate && navigator.vibrate(8); } catch {} }
    }, { passive: true });
    L.addEventListener("touchend", () => {
      if (!sw) return;
      const { row, dx, on } = sw; sw = null;
      if (!on) return;
      row.classList.remove("swiping");
      row.style.transform = ""; row.style.removeProperty("--sw");
      if (Math.abs(dx) >= 50) {
        const bub = row.querySelector(".dm-bub");
        const m = bub && S.chat.msgs.find((x) => String(x.id) === bub.dataset.mid);
        if (m && !String(m.id).startsWith("tmp")) setReply(m);
      }
    });
    L.addEventListener("touchstart", (e) => {
      const bub = e.target.closest(".dm-bub");
      if (!bub) return;
      pressT = setTimeout(() => { pressT = null; opened = true; try { navigator.vibrate && navigator.vibrate(10); } catch {} openRx(bub); }, 420);
    }, { passive: true });
    const cancel = () => { if (pressT) { clearTimeout(pressT); pressT = null; } };
    L.addEventListener("touchend", cancel); L.addEventListener("touchmove", cancel, { passive: true });
    L.addEventListener("contextmenu", (e) => { const bub = e.target.closest(".dm-bub"); if (bub) { e.preventDefault(); openRx(bub); } });
    L.addEventListener("scroll", () => { if (L.scrollHeight - L.scrollTop - L.clientHeight < 80) $("#dmJump").hidden = true; }, { passive: true });
  })();
  $("#dmFile").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; if (f.length) sendChatPhotos(f); });
  // 보내기 버튼을 눌러도 키보드가 내려가지 않게
  ["pointerdown", "mousedown"].forEach((ev) => $("#dmSend").addEventListener(ev, (e) => e.preventDefault()));
  $("#dmText").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  $("#dmText").addEventListener("focus", () => { document.body.classList.add("typing"); $("#dmPlusMenu").hidden = true; setTimeout(() => { const L = $("#dmList"); L.scrollTop = L.scrollHeight; }, 300); });
  $("#dmText").addEventListener("blur", () => { document.body.classList.remove("typing"); $("#chatWrap").style.height = ""; });
  const isField = (el) => el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "file", "button", "range", "color"].includes(el.type)));
  document.addEventListener("focusin", (e) => { if (isField(e.target)) document.body.classList.add("kb"); });
  const kbCheck = () => { const a = document.activeElement; if (!isField(a) || !a.offsetParent) document.body.classList.remove("kb"); };
  document.addEventListener("focusout", (e) => { if (isField(e.target)) setTimeout(kbCheck, 60); });
  document.addEventListener("touchstart", kbCheck, { passive: true });
  if (window.visualViewport) visualViewport.addEventListener("resize", () => { if (visualViewport.height > innerHeight * 0.85) kbCheck(); });
  setInterval(kbCheck, 1500);
  if (window.visualViewport) {
    const fit = () => {
      if (!document.body.classList.contains("typing")) return;
      if (window.scrollY) window.scrollTo(0, 0);
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
  // 보고싶어 받았을 때: 하트가 화면 위로 둥실
  function missFx() {
    const box = document.createElement("div");
    box.className = "miss-fx";
    box.innerHTML = Array.from({ length: 9 }, (_, i) => `<span style="left:${10 + i * 10}%;--d:${(i % 3) * 0.15}s;--s:${18 + (i % 4) * 6}px">${HEART}</span>`).join("");
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3200);
  }
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
    b.innerHTML = `<span class="bn-ic">${ic(tab === "map" ? "pin" : tab === "home" ? "heart" : "msg")}</span><span class="bn-t"><b>${esc(title)}</b><span>${esc(body)}</span></span>`;
    b.dataset.act = "bannerGo";
    S.bannerTab = tab;
    b.hidden = false;
    b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
    clearTimeout(showBanner.t);
    showBanner.t = setTimeout(() => (b.hidden = true), 4500);
  }

  // ---------- 시트 ----------
  function openSheet(html) {
    const sh = $("#sheet"), was = !sh.hidden && !sh.classList.contains("closing");
    sh.classList.remove("closing");
    $("#sheetBox").innerHTML = html;
    sh.hidden = false;
    // 이미 열려 있으면 내용만 부드럽게 바꿈
    if (was) { const b = $("#sheetBox"); b.classList.remove("swap"); void b.offsetWidth; b.classList.add("swap"); }
  }
  function closeSheet() {
    const sh = $("#sheet");
    if (sh.hidden || sh.classList.contains("closing")) return;
    sh.classList.add("closing");
    setTimeout(() => { sh.hidden = true; sh.classList.remove("closing"); }, 220);
  }
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
      <p class="note">UserID는 한글 이름 말고 꼭 <b>${S.who}</b> (${esc(nm("a"))} = a, ${esc(nm("b"))} = b). 위치 권한은 <b>항상 허용</b>, <b>정확한 위치</b> 켬으로 해주세요.</p>
      <p class="note"><b>이동 기록을 정확하게 하려면</b> OwnTracks 지도 화면 위쪽 모드 버튼을 눌러 <b>Move</b>로 바꿔주세요. 기본값(Significant)은 몇백 m씩 건너뛰어서 경로가 엉성해져요. 배터리는 조금 더 써요.</p>
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
  // 설정: 목록으로 단순하게, 누르면 각 화면
  function settingsSheet() {
    const ps = pushState();
    const row = (act, icon, title, sub, danger) => `<button class="li${danger ? " danger" : ""}" data-act="${act}"><span class="li-ic">${ic(icon)}</span><span class="li-t"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</span>${ic("right", "li-chev")}</button>`;
    openSheet(`
      <div class="me-av">
        <button class="me-av-pic" data-act="avatarPick" aria-label="프로필 사진 바꾸기">${av(S.who, "xl")}<span class="cam">${ic("camera")}</span></button>
        <div><b>${esc(nm(S.who))}</b><span>사진을 눌러서 프로필 사진 바꾸기</span>${avSrc(S.who) ? `<button class="link" data-act="avatarDel">사진 지우기</button>` : ""}</div>
        <input type="file" id="avInput" accept="image/*" hidden>
      </div>
      <input type="file" id="coverInput" accept="image/*" hidden>
      <div class="list" style="margin-top:12px">
        ${row("coverPick", "image", "홈 배경 사진", S.avatars && S.avatars.cover ? "바꾸기" : "둘이 찍은 사진 넣기")}
        ${row("infoSheet", "heart", "이름 · 사귄 날", `${esc(nm("a"))}, ${esc(nm("b"))} · ${fmtDot(S.start)}`)}
        ${row(ps === "granted" ? "pushTest" : "pushOn", "bell", "알림", ps === "granted" ? "켜짐 · 눌러서 테스트" : ps === "needs-home" ? "홈 화면에 추가해야 켤 수 있어요" : ps === "denied" ? "아이폰 설정에서 허용해 주세요" : "꺼짐 · 눌러서 켜기")}
        ${row("otSheet", "pin", "화면 꺼도 위치 공유", "OwnTracks 연결")}
        ${row("nfcSheet", "phone", "폰 맞대기 (NFC)", "스티커로 맞대면 터지게")}
        ${row("naverSheet", "search", "가게 검색 연결", S.kakao ? "카카오맵 연결됨" : S.naver ? "네이버 연결됨" : "카카오맵·네이버로 정확하게 찾기")}
        ${row("pwSheet", "lock", "비밀번호 바꾸기", "")}
      </div>
      <div class="list" style="margin-top:12px">
        ${S.avatars && S.avatars.cover ? row("coverDel", "image", "배경 사진 지우기", "", true) : ""}
        ${row("locDel", "trash", "내 위치 지우기", "", true)}
        ${row("logout", "logout", "로그아웃", "", true)}
      </div>`);
  }
  function infoSheet() {
    openSheet(`
      <h2>${ic("heart")}이름 · 사귄 날</h2>
      <label>${esc(nm("a"))} 이름<input id="stA" type="text" maxlength="20" value="${esc(nm("a"))}"></label>
      <label>${esc(nm("b"))} 이름<input id="stB" type="text" maxlength="20" value="${esc(nm("b"))}"></label>
      <label>사귄 날<input id="stStart" type="date" value="${S.start}"></label>
      <div class="row2"><button class="btn gray" data-act="settingsBack">뒤로</button><button class="btn primary" data-act="saveSettings">저장</button></div>`);
  }
  function pwSheet() {
    openSheet(`
      <h2>${ic("lock")}비밀번호 바꾸기</h2>
      <label>현재 비밀번호<input id="pwOld" type="password"></label>
      <label>새 비밀번호<input id="pwNew" type="password" placeholder="4자 이상"></label>
      <p class="muted" style="font-size:12px;margin-top:8px">바꾸면 상대방도 다시 로그인해야 하고, OwnTracks와 맞대기 링크도 새로 넣어야 해요.</p>
      <div class="row2"><button class="btn gray" data-act="settingsBack">뒤로</button><button class="btn primary" data-act="savePw">바꾸기</button></div>`);
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

  document.addEventListener("input", (e) => { if (e.target.id === "eatFind") { E.q = e.target.value.trim(); renderEatCard(); } });
  document.addEventListener("change", (e) => { if (e.target.id === "eatSort") { E.sort = e.target.value; renderEatCard(); } });
  // ---------- 부드러운 손동작 ----------
  // 사진은 다 불러온 뒤 살며시 나타나게
  document.addEventListener("load", (e) => { const im = e.target; if (im.tagName === "IMG") im.setAttribute("data-l", "1"); }, true);
  document.addEventListener("error", (e) => { const im = e.target; if (im.tagName === "IMG") im.setAttribute("data-l", "1"); }, true);
  // 시트: 손잡이나 맨 위에서 아래로 끌면 닫힘
  (() => {
    const box = $("#sheetBox");
    let st = null;
    box.addEventListener("touchstart", (e) => {
      if (box.scrollTop > 0 || e.target.closest("input, textarea, select")) return;
      st = { y: e.touches[0].clientY, dy: 0, t: Date.now() };
    }, { passive: true });
    box.addEventListener("touchmove", (e) => {
      if (!st) return;
      const dy = e.touches[0].clientY - st.y;
      if (dy < 0 && !st.on) { st = null; return; }
      if (!st.on && dy > 8) { st.on = true; box.style.animation = "none"; }
      if (!st.on) return;
      st.dy = Math.max(0, dy);
      box.style.transition = "none";
      box.style.transform = `translateY(${st.dy}px)`;
      $("#sheet").style.background = `rgba(30,20,30,${0.4 * Math.max(0, 1 - st.dy / 400)})`;
    }, { passive: true });
    box.addEventListener("touchend", () => {
      if (!st) return;
      const { on, dy, t } = st; st = null;
      if (!on) return;
      const fast = dy / Math.max(1, Date.now() - t) > 0.6;
      box.style.transition = "transform .28s cubic-bezier(.2,.9,.3,1)";
      if (dy > 120 || (fast && dy > 40)) {
        box.style.transform = "translateY(110%)";
        setTimeout(() => { const sh = $("#sheet"); sh.hidden = true; sh.style.background = ""; box.style.transform = ""; box.style.transition = ""; box.style.animation = ""; }, 260);
      } else {
        box.style.transform = "";
        $("#sheet").style.background = "";
        setTimeout(() => { box.style.transition = ""; box.style.animation = ""; }, 300);
      }
    });
  })();
  // 사진 크게 보기: 옆으로 밀면 다음 사진, 아래로 밀면 닫힘
  (() => {
    const lb = $("#lightbox");
    let st = null;
    lb.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1 || !e.target.closest(".lb-img")) return;
      st = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, dy: 0, ax: null };
    }, { passive: true });
    lb.addEventListener("touchmove", (e) => {
      if (!st) return;
      st.dx = e.touches[0].clientX - st.x; st.dy = e.touches[0].clientY - st.y;
      if (!st.ax && Math.hypot(st.dx, st.dy) > 10) st.ax = Math.abs(st.dx) > Math.abs(st.dy) ? "x" : "y";
      const im = lb.querySelector(".lb-img img"); if (!im) return;
      im.style.transition = "none";
      if (st.ax === "x") im.style.transform = `translateX(${st.dx}px)`;
      else if (st.ax === "y" && st.dy > 0) { im.style.transform = `translateY(${st.dy}px) scale(${1 - Math.min(0.3, st.dy / 1000)})`; lb.style.background = `rgba(15,10,15,${0.94 * Math.max(0.2, 1 - st.dy / 400)})`; }
    }, { passive: true });
    lb.addEventListener("touchend", () => {
      if (!st) return;
      const { ax, dx, dy } = st; st = null;
      const im = lb.querySelector(".lb-img img"); if (!im) return;
      im.style.transition = "transform .25s cubic-bezier(.2,.9,.3,1), opacity .25s";
      if (ax === "x" && Math.abs(dx) > 70) {
        const d = dx < 0 ? 1 : -1, ni = S.lbIdx + d;
        if (ni >= 0 && ni < S.lbList.length) {
          im.style.transform = `translateX(${dx < 0 ? -innerWidth : innerWidth}px)`; im.style.opacity = "0";
          setTimeout(() => { S.lbIdx = ni; drawLightbox(); const n = lb.querySelector(".lb-img img"); if (n) { n.classList.add(d > 0 ? "lb-in-r" : "lb-in-l"); } }, 180);
          return;
        }
      }
      if (ax === "y" && dy > 120) {
        im.style.transform = `translateY(${innerHeight}px)`; lb.classList.add("lb-out");
        setTimeout(() => { lb.hidden = true; lb.classList.remove("lb-out"); lb.style.background = ""; }, 240);
        return;
      }
      im.style.transform = ""; lb.style.background = "";
    });
  })();

  // ---------- 버튼 동작 ----------
  const ACT = {
    tab: (el) => setTab(el.dataset.tab),
    bucketOpen: () => bucketSheet(),
    dailyOpen: () => dailySheet(),
    dailyUp: () => $("#dailyInput").click(),
    couponOpen: () => couponSheet(),
    couponTab: (el) => couponSheet(el.dataset.t),
    couponPreset(el) { $("#couponTitle").value = el.dataset.c; },
    async couponGive() {
      const title = $("#couponTitle").value.trim();
      if (!title) return toast("쿠폰 이름을 적어주세요");
      await api("coupons", { method: "POST", body: { title } });
      toast(`${nm(other())}님에게 쿠폰을 줬어요`); couponSheet("gave");
    },
    async couponUse(el) {
      if (!confirm("이 쿠폰을 쓸까요?")) return;
      try { await api(`coupons/${el.dataset.id}/use`, { method: "POST", body: {} }); toast("쿠폰을 썼어요"); couponSheet("got"); } catch (e) { toast(e.message); }
    },
    async couponDel(el) { await api(`coupons/${el.dataset.id}`, { method: "DELETE" }); couponSheet("gave"); },
    foodOpen: () => foodSheet(false),
    foodSpin: () => foodSheet(true),
    statsOpen: () => statsSheet(),
    notesOpen: () => notesSheet(),
    notesAbout: (el) => notesSheet(el.dataset.w),
    noteCat(el) { S.noteCat = el.dataset.c; $$(".chip-sel").forEach((b) => b.classList.toggle("on", b === el)); },
    async noteAdd() {
      const text = $("#noteText").value.trim();
      if (!text) return toast("내용을 적어주세요");
      await api("notes", { method: "POST", body: { about: S.notesAbout, cat: S.noteCat, text } });
      notesSheet();
    },
    async noteDel(el) { await api(`notes/${el.dataset.id}`, { method: "DELETE" }); notesSheet(); },
    ideaOpen: () => ideaSheet(),
    ideaAgain: () => ideaSheet(true),
    async ideaSave() { await api("bucket", { method: "POST", body: { title: S.idea } }); toast("버킷리스트에 담았어요"); closeSheet(); render(true); },
    infoSheet: () => infoSheet(),
    pwSheet: () => pwSheet(),
    settingsBack: () => settingsSheet(),
    meetSheet: () => meetSheet(),
    async meetSave() { const d = $("#meetDate").value; await api("meet", { method: "POST", body: { date: d } }); S.nextMeet = d; closeSheet(); render(true); },
    async meetClear() { await api("meet", { method: "POST", body: { date: "" } }); S.nextMeet = ""; closeSheet(); render(true); },
    lettersOpen: () => lettersSheet(),
    letterWrite: () => letterWrite(),
    async letterSend() {
      const body = $("#letterBody").value.trim();
      if (!body) return toast("편지 내용을 적어주세요");
      const d = $("#letterDate").value || today();
      await api("letters", { method: "POST", body: { body, open_date: d } });
      toast(d <= today() ? "편지를 보냈어요" : `${fmtK(d)}에 열리는 편지를 보냈어요`);
      lettersSheet(); render(true);
    },
    async letterDel(el) { if (!confirm("이 편지를 지울까요?")) return; await api(`letters/${el.dataset.id}`, { method: "DELETE" }); lettersSheet(); },
    moodSheet: () => moodSheet(),
    moodPick(el) { S.moodPick = el.dataset.m; $$(".mood-grid button").forEach((b) => b.classList.toggle("on", b === el)); },
    async moodSave() {
      if (!S.moodPick) return toast("기분을 골라주세요");
      const text = $("#moodText").value.trim();
      await api("mood", { method: "POST", body: { m: S.moodPick, text } });
      S.mood[S.who] = { m: S.moodPick, text, t: Date.now() };
      closeSheet(); render(true);
    },
    async moodClear() { await api("mood", { method: "POST", body: { m: null } }); S.mood[S.who] = null; closeSheet(); render(true); },
    async missYou(el) {
      el.classList.remove("sent"); void el.offsetWidth; el.classList.add("sent");
      try { navigator.vibrate && navigator.vibrate(20); } catch {}
      const r = await api("miss", { method: "POST", body: {} });
      toast(r.throttled ? "방금 보냈어요" : `${nm(other())}님에게 보고싶다고 전했어요`);
    },
    coverPick: () => $("#coverInput").click(),
    async coverDel() { await api("cover", { method: "DELETE" }); delete S.avatars.cover; settingsSheet(); toast("배경 사진을 지웠어요"); },
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
    dmPhoto: () => { $("#dmPlusMenu").hidden = true; $("#dmFile").click(); },
    rxClose: closeRx,
    async evShare(el) {
      const e = (S.calData.events || []).find((x) => String(x.id) === el.dataset.id);
      if (!e) return;
      try {
        await api("messages", { method: "POST", body: { kind: "event", ev: { date: e.date, time: e.time || "", title: e.title } } });
        toast(`${nm(other())}님에게 일정을 보냈어요`);
        if (S.chat) S.chat.sig = "";
      } catch (er) { toast(er.message); }
    },
    async lbSave() {
      const p = S.lbList[S.lbIdx]; if (!p) return;
      const url = p.src || `/api/photo/${p.id}`;
      try {
        toast("사진 준비 중...");
        const blob = await (await fetch(url, { credentials: "same-origin" })).blob();
        const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
        const file = new File([blob], `wooju-${(p.date || ymd(new Date(p.t || Date.now()))).replace(/-/g, "")}-${p.id}.${ext}`, { type: blob.type || "image/jpeg" });
        // 아이폰: 공유 창에서 '이미지 저장'을 누르면 사진 앱에 저장
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file); a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast("저장했어요");
      } catch (e) { toast("저장하지 못했어요"); }
    },
    qStep(el) { qGo(Number(el.dataset.d)); },
    qToday() { S.qDate = qToday(); S.qAnim = "q-in-r"; render(); window.scrollTo({ top: 0, behavior: "smooth" }); },
    eatOpen() { if (S.tab !== "map") setTab("map"); setTimeout(() => setEatOn(true), S.tab === "map" ? 0 : 300); },
    eatToggle() { setEatOn(!S.eatOn); },
    eatClose() { setEatOn(false); },
    eatFilter(el) { E.filter = el.dataset.v; drawEatMarkers(); renderEatCard(); },
    eatAdd: () => eatAddSheet(),
    eatSearch: () => eatSearch(),
    eatResPick(el) { const r = S.eatRes[+el.dataset.i]; eatForm({ ...r, cat: catOf(r.kind || "") }); },
    naverSheet: () => naverSheet(),
    connTab(el) { naverSheet(el.dataset.v); },
    async kakaoSave() {
      const key = $("#kkKey").value.trim();
      if (!key) return toast("REST API 키를 붙여넣어 주세요");
      const b = $("[data-act=kakaoSave]"); b.disabled = true; b.textContent = "확인 중...";
      try {
        await api("kakaokey", { method: "POST", body: { key } });
        S.kakao = true; toast("카카오맵 검색을 연결했어요");
        S.tab === "map" ? eatAddSheet() : closeSheet();
      } catch (e) { toast(e.message); b.disabled = false; b.textContent = "연결하기"; }
    },
    async kakaoJsSave() {
      const key = $("#kkJs").value.trim();
      if (!key) return toast("JavaScript 키를 붙여넣어 주세요");
      try { await api("kakaojs", { method: "POST", body: { key } }); } catch (e) { return toast(e.message); }
      toast("카카오맵으로 바꿨어요. 다시 불러올게요");
      setTimeout(() => location.reload(), 900);
    },
    async kakaoJsOff() {
      await api("kakaojs", { method: "POST", body: { key: "" } });
      toast("기본 지도로 바꿨어요"); setTimeout(() => location.reload(), 800);
    },
    async kakaoOff() { if (!confirm("카카오 검색 연결을 해제할까요?")) return; await api("kakaokey", { method: "POST", body: { key: "" } }); S.kakao = false; toast("연결을 해제했어요"); closeSheet(); },
    async naverOff() { if (!confirm("네이버 검색 연결을 해제할까요?")) return; await api("naverkey", { method: "POST", body: { id: "", secret: "" } }); S.naver = false; toast("연결을 해제했어요"); closeSheet(); },
    async naverSave() {
      const id = $("#nvId").value.trim(), secret = $("#nvSec").value.trim();
      const b = $("[data-act=naverSave]"); b.disabled = true; b.textContent = "확인 중...";
      try {
        await api("naverkey", { method: "POST", body: { id, secret } });
        S.naver = !!(id && secret);
        toast(S.naver ? "네이버 검색을 연결했어요" : "연결을 해제했어요");
        S.tab === "map" ? eatAddSheet() : closeSheet();
      } catch (e) { toast(e.message); b.disabled = false; b.textContent = "연결하기"; }
    },
    eatNaver() { const e = E.list.find((x) => x.id === S.eatCur); if (e.link) return window.open(e.link, "_blank"); window.open(`https://map.naver.com/p/search/${encodeURIComponent(e.name)}?c=${e.lon},${e.lat},17,0,0,0,dh`, "_blank"); },
    eatPickMap: () => eatPickMap(),
    eatPickOk() {
      const c = eatPickPoint();
      pickClose();
      eatForm({ name: "", lat: c.lat, lon: c.lng });
      setTimeout(() => $("#eatName") && $("#eatName").focus(), 300);
    },
    eatSt(el) { S.eatStatus = el.dataset.v; $$(".eat-st button").forEach((b) => b.classList.toggle("on", b === el)); },
    eatCat(el) { S.eatCat = el.dataset.v; $$(".eat-cats .cchip").forEach((b) => b.classList.toggle("on", b === el)); },
    async eatSave() {
      const p = S.eatNew, name = $("#eatName").value.trim();
      if (!name) return toast("이름을 적어주세요");
      try {
        const r = await api("eats", { method: "POST", body: { name, lat: p.lat, lon: p.lon, addr: p.addr || "", cat: S.eatCat, status: S.eatStatus, memo: $("#eatMemo").value, link: p.link || "", kind: E.kind } });
        closeSheet();
        if (S.tab !== "map") setTab("map");
        if (!S.eatOn) S.eatOn = true, $("#eatBtn") && $("#eatBtn").classList.add("on");
        await loadEats();
        map.flyTo({ center: [p.lon, p.lat], zoom: 16 });
        toast(`${name}을(를) 추가했어요`);
        setTimeout(() => eatDetail(E.list.find((x) => x.id === r.id)), 900);
      } catch (e) { toast(e.message); }
    },
    eatKind(el) {
      if (E.kind === el.dataset.v) return;
      setKind(el.dataset.v);
      drawEatMarkers(); $("#mapCard").innerHTML = ""; renderEatCard(); fitEats();
    },
    eatSort(el) { E.sort = el.dataset.v; renderEatCard(); },
    eatFindClear() { E.q = ""; renderEatCard(); },
    eatView(el) { E.view = el.dataset.v; $("#mapCard").innerHTML = ""; renderEatCard(); },
    eatMk(el) {
      const id = Number(el.dataset.id);
      if (E.view === "cards" && E.sel !== id) { selectEat(id, true); return; }
      eatDetail(E.list.find((x) => x.id === id));
    },
    eatOpenOne(el) { eatDetail(E.list.find((x) => String(x.id) === el.dataset.id)); },
    eatSetSt(el) { eatUpdate({ status: el.dataset.v }); },
    eatRate(el) { const e = E.list.find((x) => x.id === S.eatCur); const v = Number(el.dataset.v); eatUpdate({ rate: e && e["r" + S.who] === v ? 0 : v }); },
    eatFly() { const e = E.list.find((x) => x.id === S.eatCur); closeSheet(); if (S.tab !== "map") setTab("map"); if (!S.eatOn) setEatOn(true); setTimeout(() => map.flyTo({ center: [e.lon, e.lat], zoom: 17 }), 300); },
    eatNav() { const e = E.list.find((x) => x.id === S.eatCur); location.href = `https://map.kakao.com/link/to/${encodeURIComponent(e.name)},${e.lat},${e.lon}`; },
    async eatDm() {
      const e = E.list.find((x) => x.id === S.eatCur);
      try { await api("messages", { method: "POST", body: { kind: "loc", lat: e.lat, lon: e.lon, name: e.name, text: "" } }); toast(`${nm(other())}님에게 보냈어요`); if (S.chat) S.chat.sig = ""; } catch (er) { toast(er.message); }
    },
    async eatDel() {
      const e = E.list.find((x) => x.id === S.eatCur);
      if (!confirm(`${e.name}을(를) 지울까요?`)) return;
      await api(`eats/${e.id}`, { method: "DELETE" });
      closeSheet(); loadEats();
    },
    eatWant() {
      const id = S.eatCur, e = E.list.find((x) => x.id === id);
      if (e) { e["w" + S.who] = e["w" + S.who] ? 0 : 1; eatDetail(e); drawEatMarkers(); }
      try { navigator.vibrate && navigator.vibrate(10); } catch {}
      api(`eats/${id}/want`, { method: "POST", body: {} }).then((r) => { if (r.on && e && e["w" + other()]) toast("둘 다 가고 싶은 곳이에요"); loadEats(); }).catch((er) => toast(er.message));
    },
    eatPhoto() { $("#eatFile").click(); },
    eatPhView(el) {
      const list = (E.more.imgs || []).map((im) => ({ src: `/api/eatimg/${im.id}`, chat: true, who: im.who, t: im.t, id: "e" + im.id }));
      openLightbox(list, +el.dataset.i);
    },
    eatVisitForm() {
      const box = $("#eatVisitBox");
      if (box.innerHTML) { box.innerHTML = ""; return; }
      box.innerHTML = `<div class="eat-vf"><input type="date" id="vfD" value="${today()}" max="${today()}"><input type="text" id="vfM" placeholder="${TK().menuPh}" maxlength="120"><button class="btn primary sm" data-act="eatVisitSave">저장</button></div>`;
      setTimeout(() => $("#vfM") && $("#vfM").focus(), 50);
    },
    async eatVisitSave() {
      const id = S.eatCur;
      try { await api(`eats/${id}/visit`, { method: "POST", body: { date: $("#vfD").value, menu: $("#vfM").value } }); } catch (e) { return toast(e.message); }
      toast("다녀온 기록을 남겼어요");
      E.more = null; await loadEats(); eatDetail(E.list.find((x) => x.id === id));
    },
    async eatVisitDel(el) {
      if (!confirm("이 기록을 지울까요?")) return;
      await api(`eatvisit/${el.dataset.id}`, { method: "DELETE" });
      const id = S.eatCur; E.more = null; await loadEats(); eatDetail(E.list.find((x) => x.id === id));
    },
    eatPlan: () => eatPlanSheet(),
    eatEdit() { const e = E.list.find((x) => x.id === S.eatCur); if (e) eatEditSheet(e); },
    edCat(el) { E.edit.cat = el.dataset.v; $$(".eat-cats .cchip").forEach((b) => b.classList.toggle("on", b === el)); },
    edReset() { const e = E.list.find((x) => x.id === E.edit.id); if (mini) mini.easeTo({ center: [e.lon, e.lat], zoom: 17.5 }); },
    edCancel() { const e = E.list.find((x) => x.id === E.edit.id); E.edit = null; closeSheet(); setTimeout(() => eatDetail(e), 260); },
    edPick() {
      const ed = edCollect();
      closeSheet();
      if (S.tab !== "map") setTab("map");
      map.flyTo({ center: [ed.lon, ed.lat], zoom: 17.5, offset: [0, -0.05 * innerHeight] });
      $("#mapCard").hidden = true;
      const box = document.createElement("div");
      box.id = "pick";
      box.innerHTML = `<div class="pick-dot eat-pick">${ic(catIc(ed.cat))}</div>
        <div class="pick-panel">
          <b>지도를 움직여서 ${esc(ed.name)} 자리에 핀을 맞추세요</b>
          <div class="row2"><button class="btn gray" data-act="edPickCancel">취소</button><button class="btn primary" data-act="edPickOk">여기로 옮기기</button></div>
        </div>`;
      $("#mapWrap").appendChild(box);
    },
    edPickCancel() { pickClose(); const e = E.list.find((x) => x.id === E.edit.id); eatEditSheet(e, E.edit); },
    edPickOk() {
      const c = eatPickPoint();
      pickClose();
      E.edit.lat = c.lat; E.edit.lon = c.lng;
      eatEditSheet(E.list.find((x) => x.id === E.edit.id), E.edit);
    },
    async edSave() {
      const ed = edCollect(), e = E.list.find((x) => x.id === ed.id);
      const name = ed.name.trim();
      if (!name) return toast("이름을 적어주세요");
      const body = { name, cat: ed.cat, addr: ed.addr.trim() };
      if (distM(e, ed) > 3) { body.lat = ed.lat; body.lon = ed.lon; }
      if (e.status === "been" && ed.been) body.been = ed.been;
      try { await api(`eats/${ed.id}`, { method: "POST", body }); } catch (er) { return toast(er.message); }
      E.edit = null;
      toast("수정했어요");
      closeSheet();
      await loadEats();
      if (body.lat) map.flyTo({ center: [body.lon, body.lat], zoom: 16.5 });
      setTimeout(() => eatDetail(E.list.find((x) => x.id === ed.id)), 280);
    },
    eatPlanBack() { closeSheet(); setTimeout(() => eatDetail(E.list.find((x) => x.id === S.eatCur)), 260); },
    async eatPlanSave() {
      const e = E.list.find((x) => x.id === S.eatCur), date = $("#plD").value, time = $("#plT").value;
      if (!date) return toast("날짜를 골라주세요");
      try {
        await api("events", { method: "POST", body: { date, time, title: `${e.name} 가기`, memo: e.addr || "" } });
        await api("messages", { method: "POST", body: { kind: "event", ev: { date, time, title: `${e.name} 가기` } } });
        if (!e["w" + S.who]) api(`eats/${e.id}/want`, { method: "POST", body: {} }).catch(() => {});
        if (S.chat) S.chat.sig = "";
        toast(`${fmtK(date)}에 가기로 했어요. 달력에 넣었어요`);
        closeSheet();
      } catch (er) { toast(er.message); }
    },
    rlSet(el) { const v = el.dataset.v; S.rl[el.dataset.k] = /^\d+$/.test(v) ? Number(v) : v; eatRoulette(); },
    rlGo: () => rlSpin(),
    rlShow(el) {
      const e = E.list.find((x) => String(x.id) === el.dataset.id);
      closeSheet();
      map.flyTo({ center: [e.lon, e.lat], zoom: 16.5 });
      setTimeout(() => eatDetail(e), 900);
    },
    eatRandom: () => eatRoulette(),
    eatRandomOld() {
      const w = E.list.filter((e) => e.status !== "been");
      if (!w.length) return;
      const e = w[Math.floor(Math.random() * w.length)];
      map.flyTo({ center: [e.lon, e.lat], zoom: 16.5 });
      toast(`오늘은 ${e.name} 어때요?`);
      setTimeout(() => eatDetail(e), 1100);
    },
    rxPin(el) {
      const id = el.dataset.id; closeRx();
      api(`messages/${id}/pin`, { method: "POST", body: {} }).then((r) => { toast(r.pinned ? "위에 고정했어요" : "고정을 풀었어요"); refreshChat(); }).catch((e) => toast(e.message));
    },
    rxEdit(el) { const m = S.chat.msgs.find((x) => String(x.id) === el.dataset.id); closeRx(); if (m) setEdit(m); },
    editCancel() { setEdit(null); $("#dmText").value = ""; autosize(); updateSendBtn(); },
    pinGo(el) { gotoMsg(Number(el.dataset.id)); },
    dmJump() { const L = $("#dmList"); L.scrollTo({ top: L.scrollHeight, behavior: "smooth" }); $("#dmJump").hidden = true; },
    dmSearch: () => searchSheet(),
    srchGo: () => doSearch(),
    srchPick(el) { closeSheet(); setTimeout(() => gotoMsg(Number(el.dataset.id)), 250); },
    dmPlus() { const m = $("#dmPlusMenu"); m.hidden = !m.hidden; },
    async dmEvent() {
      $("#dmPlusMenu").hidden = true;
      const d = await api(`calendar?from=${today()}&to=${addDays(today(), 90)}`);
      S.evPick = d.events || [];
      openSheet(`<h2>일정 보내기</h2><p class="sheet-sub">앞으로 90일 일정이에요</p>
        ${S.evPick.length ? `<div class="list">${S.evPick.map((e, i) => `<button class="li" data-act="evPickSend" data-i="${i}"><span class="li-t"><b>${esc(e.title)}</b><span>${fmtK(e.date)}${e.time ? " " + e.time : ""}</span></span>${ic("send", "li-chev")}</button>`).join("")}</div>`
          : `<div class="empty">다가오는 일정이 없어요<br><small>추억 탭 달력에서 일정을 만들 수 있어요</small></div>`}`);
    },
    evPickSend(el) {
      const e = S.evPick[+el.dataset.i]; closeSheet();
      const meta = { date: e.date, time: e.time || "", title: e.title };
      const tmp = { id: "tmp" + Date.now(), who: S.who, text: "", kind: "event", meta, reacts: {}, t: Date.now() };
      S.chat.msgs.push(tmp); drawChat(true);
      postMsg({ kind: "event", ev: meta }, tmp);
    },
    dmLoc() { $("#dmPlusMenu").hidden = true; sendMyLoc(); },
    dmHeart() { $("#dmPlusMenu").hidden = true; sendHeart(); },
    dmRetry(el) {
      const m = S.chat.msgs.find((x) => String(x.id) === el.dataset.id);
      if (!m) return;
      m.failed = false; drawChat();
      postMsg(m.body || { text: m.text }, m);
    },
    rxReply(el) { const m = S.chat.msgs.find((x) => String(x.id) === el.dataset.id); closeRx(); if (m) setReply(m); },
    async rxCopy(el) {
      const m = S.chat.msgs.find((x) => String(x.id) === el.dataset.id); closeRx();
      try { await navigator.clipboard.writeText(m.text); toast("복사했어요"); } catch { toast("복사할 수 없어요"); }
    },
    replyCancel: () => setReply(null),
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
    placeEdit(el) { const p = (S.places || []).find((x) => String(x.id) === el.dataset.id); if (p) placeEditSheet(p); },
    plEdSet(el) {
      const k = el.dataset.k, v = k === "radius" ? Number(el.dataset.v) : el.dataset.v;
      S.plEd[k] = v;
      el.parentNode.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === el));
    },
    async plEdSave() {
      const o = S.plEd, name = $("#plName").value.trim();
      if (!name) return toast("장소 이름을 적어주세요");
      try { await api(`places/${o.id}`, { method: "POST", body: { name, lat: o.lat, lon: o.lon, radius: o.radius, owner: o.owner } }); } catch (e) { return toast(e.message); }
      toast("장소를 수정했어요");
      await loadPlaces(); placesSheet();
    },
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
      const top0 = L.scrollTop;
      drawChat(false, true);
      L.scrollTop = top0 + (L.scrollHeight - h0);
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
      const date = el.dataset.date, slot = el.dataset.slot || "t";
      const ta = $(`textarea[data-ta="${date}|${slot}"]`);
      const v = ta.value.trim();
      if (!v) return toast("답을 적어주세요");
      el.disabled = true;
      try {
        await api("answers", { method: "POST", body: { qdate: date, slot, answer: v } });
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
      el.classList.add("on");
      try {
        await api("answers", { method: "POST", body: { qdate: el.dataset.date, slot: el.dataset.slot, answer: el.dataset.v } });
      } catch (e) { toast(e.message); }
      setTimeout(() => render(true), 350);
    },
    qBonus() { S.bonusOpen = Math.max(S.bonusOpen || 0, bonusAnswered(today())) + 1; render(true); },
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
    satToggle: () => setSat(!S.sat),
    trailOpen() { if (S.eatOn) setEatOn(false); S.trail = { w: other(), day: 0 }; renderMapCard(); loadTrail(); },
    trailFly(el) { map.flyTo({ center: [+el.dataset.lon, +el.dataset.lat], zoom: 16.5 }); },
    trailClose() { S.trail = null; if (mapLoaded) map.getSource("trail").setData({ type: "FeatureCollection", features: [] }); renderMapCard(); fitMap(); },
    trailWho(el) { S.trail = { ...S.trail, w: el.dataset.v, data: null }; renderTrailCard(); loadTrail(); },
    trailDay(el) { S.trail = { ...S.trail, day: Number(el.dataset.v), data: null }; renderTrailCard(); loadTrail(); },
    navTo() {
      const l = S.locs[other()]; if (!l) return;
      location.href = `https://map.kakao.com/link/to/${encodeURIComponent(nm(other()))},${l.lat},${l.lon}`;
    },
    async locReq() {
      try { await api("locreq", { method: "POST", body: {} }); toast(`${nm(other())}님에게 위치를 물어봤어요`); } catch (e) { toast(e.message); }
    },
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
    if (e.target.id === "coverInput" && e.target.files.length) uploadCover(e.target.files[0]);
    if (e.target.id === "dailyInput" && e.target.files.length) {
      const f = e.target.files[0];
      (async () => {
        toast("올리는 중...");
        try { const p = await prepPhoto(f, 400); await api("daily", { method: "POST", body: { data: p.data, thumb: p.thumb } }); toast("오늘의 한 장을 올렸어요"); dailySheet(); }
        catch (err) { toast(err.message); }
      })();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    if (e.target.id === "evTitle") ACT.evAdd();
    if (e.target.id === "bkTitle") ACT.bkAdd();
    if (e.target.id === "noteText") ACT.noteAdd();
    if (e.target.id === "srchQ") doSearch();
    if (e.target.id === "eatQ") eatSearch();
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
    $("#loginTitle").textContent = "우주";
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
      S.who = me.who; S.names = me.names; S.start = me.start; S.created = me.created; S.avatars = me.avatars || {}; S.mood = me.mood || {}; S.nextMeet = me.nextMeet || ""; S.naver = !!me.naver; S.kakao = !!me.kakao; S.kakaoJs = me.kakaoJs || "";
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
  setInterval(() => { if (!document.hidden && S.tab === "chat" && S.who && S.chat) refreshChat(); }, 1200);
  async function pulse(first) {
    if (!S.who) return;
    try {
      const p = await api("pulse");
      const unread = p.last && p.last.who !== S.who && p.last.id > (p.read[S.who] || 0);
      $("#cBadge").hidden = !unread || S.tab === "chat";
      if (first) {
        S.lastTouchSeen = p.touch;
        S.together = p.together;
        S.lastMissSeen = p.miss ? p.miss.t : 1;
        S.lastBannerMsg = p.last ? p.last.id : 0;
        S.lastPlaceSeen = p.place ? p.place.t : 0;
        return;
      }
      if (p.now) S.clockOff = p.now - Date.now();
      if (p.miss && p.miss.t > (S.lastMissSeen || 0)) {
        if (S.lastMissSeen && p.miss.who !== S.who) { showBanner(nm(p.miss.who), `${nm(p.miss.who)}님이 보고 싶대요`, "home"); missFx(); }
        S.lastMissSeen = p.miss.t;
      }
      if (p.moodT) {
        const o = other(), mt = (S.mood && S.mood[o] && S.mood[o].t) || 0;
        if (p.moodT[o] && p.moodT[o] !== mt) api("me").then((m) => { S.mood = m.mood || {}; if (S.tab === "home") render(true); }).catch(() => {});
      }
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
