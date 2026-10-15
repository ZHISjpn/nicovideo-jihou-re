(() => {
  "use strict";
  if (window.__jihouLiteLoaded) return;
  window.__jihouLiteLoaded = true;

  // ====================== 設定 ======================
  const CONFIG = {
    // --- マーキーエリア（時報・ニュース共通。プレーヤー直上に表示） ---
    BAR_HEIGHT: 56,          // マーキーエリアの高さ(px)
    // --- 時報 ---
    JIHOU_W: 544,            // 時報動画の元サイズ
    JIHOU_H: 56,
    VOLUME: 0.5,             // 時報の音量 0.0〜1.0
    DIM: 0.55,               // 時報中に動画を暗くする濃さ 0〜1
    ONLY_WHEN_PLAYING: false, // false: 再生中・一時停止中・停止中のどれでも時報を出す（一時停止・停止中なら、時報のあとも維持）／true: 再生中のときだけ
    // --- ニュース／お知らせ ---
    NEWS_ENABLED: true,
    NEWS_ROTATE_SEC: 10,     // 表示を止めておく秒数（その後、次へスクロール）
    NEWS_SLIDE_MS: 450,      // 切り替え時のスクロール時間
    NEWS_ORDER: "random",    // 表示順。"random"＝無作為（ページを開くたびに変わる）／"newest"＝日時の新しい順
    NEWS_REFRESH_MIN: 10,    // フィード再取得の間隔(分)
    MAX_PER_FEED: 0,         // 各フィードから使う最大件数（0＝XMLに含まれるすべての項目）
    SKIP_KEEP_DAYS: 30,      // スキップした記事を覚えておく日数
  };
  // 読み込むフィード（background.js の FEED_URLS のキーと対応）。すべての項目を合わせて、日時の新しい順に表示される。
  const FEEDS = [
    { key: "news", label: "ニュース" },
    { key: "notice", label: "お知らせ" },
  ];

  // 時報スケジュールとイベントは schedule.js で設定する
  const SCHEDULE = globalThis.JIHOU_SCHEDULE || [];
  // ==================================================

  const api = typeof browser !== "undefined" ? browser : chrome;
  const MAXZ = "2147483647";
  const state = { jihou: false, barVisible: false };

  // ---------- ON/OFF設定 ----------
  // アカウントページ（account.js が出す設定パネル）で切り替える。storage.local に保存される。
  //   { "0000": true, "0200": false, "events": true }  … キーは schedule.js の id / "events"。未設定はON
  const SETTINGS_KEY = "jihouEnabled";
  let enabledMap = {};
  let settingsLoaded = false;
  const isEnabled = (key) => enabledMap[key] !== false;
  api.storage.local.get(SETTINGS_KEY)
    .then((got) => { enabledMap = got[SETTINGS_KEY] || {}; })
    .catch(() => {})
    .then(() => { settingsLoaded = true; });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SETTINGS_KEY]) enabledMap = changes[SETTINGS_KEY].newValue || {};
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- イベント定義の読み込み ----------
  function parseAt(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(str || "").trim());
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  }
  function normEvent(e) {
    return { ...e, atMs: parseAt(e.at) };
  }
  const EVENTS = (globalThis.JIHOU_EVENTS || [])
    .filter((e) => e && e.enabled !== false)
    .map(normEvent)
    .filter((e) => {
      if (!e.id || !e.file || e.atMs == null) {
        console.warn("[時報Lite] イベント設定が不正です（id / file / at を確認）:", e);
        return false;
      }
      if (!e.url) console.warn("[時報Lite] イベントに url が未設定です:", e.id);
      return true;
    });

  // ---------- UI ----------
  // 動画を暗くする膜（時報中のみ）。バー本体とは別要素にして重なり順を分ける
  const dimEl = document.createElement("div");
  dimEl.id = "jihou-lite-dim";
  dimEl.style.cssText =
    `all:initial;display:none;position:absolute;background:#000;pointer-events:none;z-index:${MAXZ};`;

  // バー本体。通常時は低い z-index にして、サイトの検索候補などの下に回す
  const host = document.createElement("div");
  host.id = "jihou-lite-host";
  host.style.cssText = "all:initial;position:absolute;left:0;top:0;width:0;height:0;z-index:1;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      #bar { position: absolute; display: none; overflow: hidden; background: #000;
             font-family: "Meiryo","Yu Gothic UI","Hiragino Sans",sans-serif; }
      #news { position: absolute; inset: 0; display: flex; align-items: stretch; }
      #bar[data-mode="jihou"] #news { display: none; }
      .side { flex: 0 0 28px; border: 0; margin: 0; padding: 0; background: #2e2e2e;
              cursor: pointer; position: relative; }
      .side:hover { background: #444; }
      .side::before { content: ""; position: absolute; left: 50%; top: 50%;
                      border-style: solid; transform: translate(-50%, -50%); }
      #prev::before { border-width: 6px 8px 6px 0; border-color: transparent #9a9a9a transparent transparent; }
      #next::before { border-width: 6px 0 6px 8px; border-color: transparent transparent transparent #9a9a9a; }
      #viewport { position: relative; flex: 1 1 auto; overflow: hidden; background: #000; }
      .item { position: absolute; left: 0; top: 0; width: 100%; height: 100%;
              display: block; padding: 0 14px; line-height: var(--h, 56px);
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
              color: #fff; text-decoration: none; font-size: 15px; will-change: transform; }
      .item:hover { text-decoration: underline; }
      #divider { flex: 0 0 1px; align-self: center; height: 28px; background: #555; }
      #skip { flex: 0 0 52px; border: 0; margin: 0; padding: 0; background: #000; color: #ddd;
              cursor: pointer; font-size: 22px; line-height: 1; }
      #skip:hover { background: #222; color: #fff; }
      #jihou { position: absolute; inset: 0; display: none; align-items: center;
               justify-content: center; background: #000; }
      #bar[data-mode="jihou"] #jihou { display: flex; }
      #jihou.clickable { cursor: pointer; }
      #jv { background: #000; display: block; }
    </style>
    <div id="bar" data-mode="news">
      <div id="news">
        <button class="side" id="prev" title="前へ" aria-label="前へ"></button>
        <div id="viewport"></div>
        <div id="divider"></div>
        <button id="skip" title="この項目をスキップ" aria-label="スキップ">✕</button>
        <button class="side" id="next" title="次へ" aria-label="次へ"></button>
      </div>
      <div id="jihou"><video id="jv" playsinline preload="auto"></video></div>
    </div>`;
  const $ = (id) => shadow.getElementById(id);
  const bar = $("bar"), viewport = $("viewport"), jihouBox = $("jihou"), jv = $("jv");

  // ---------- メイン動画の特定 ----------
  function pickVideo() {
    // 現行UIのメイン動画（PiP用の video#pipVideoElement は除外される）
    const main = document.querySelector('video[data-name="video-content"]');
    if (main && main.getBoundingClientRect().width > 0) return main;
    let best = null, bestArea = 0;
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > bestArea) { best = v; bestArea = a; }
    }
    return best;
  }
  const onWatchPage = () => location.pathname.startsWith("/watch/");

  // ---------- レイアウト追従 ----------
  // 通常時: マーキーエリアをプレーヤーの「外・直上」に置く。
  //         そのぶんの空きは、プレーヤー全体(fullscreen-target)に margin-top を付けて確保する。
  // 全画面時: 外に置く場所がないので、時報のときだけ動画上端に重ねる。
  const reserveStyle = document.createElement("style");
  reserveStyle.id = "jihou-lite-reserve";
  (document.head || document.documentElement).appendChild(reserveStyle);
  let reserved = false;
  function setReserve(on) {
    if (on === reserved) return;
    reserved = on;
    reserveStyle.textContent = on
      ? `[data-styling-name="fullscreen-target"]{margin-top:${CONFIG.BAR_HEIGHT}px !important;}`
      : "";
  }

  let lastKey = "";
  function hideAll() {
    bar.style.display = "none";
    dimEl.style.display = "none";
    state.barVisible = false;
    lastKey = "";
  }
  function layout() {
    const fsEl = document.fullscreenElement;
    const fs = !!fsEl && fsEl.tagName !== "VIDEO";
    const parent = fs ? fsEl : document.documentElement;
    if (dimEl.parentNode !== parent) { parent.appendChild(dimEl); lastKey = ""; }
    if (host.parentNode !== parent) { parent.appendChild(host); lastKey = ""; } // dim の後ろ＝全画面では dim の上
    host.style.position = fs ? "fixed" : "absolute";
    host.style.zIndex = fs ? MAXZ : "1";
    dimEl.style.position = fs ? "fixed" : "absolute";

    const v = onWatchPage() ? pickVideo() : null;
    setReserve(!!v && !fs && (CONFIG.NEWS_ENABLED || state.jihou));
    if (!v) { hideAll(); return; }

    const r = v.getBoundingClientRect();
    if (r.width < 320 || r.height < 180) { hideAll(); return; }

    let scale, h, top;
    if (fs) {
      if (!state.jihou) { hideAll(); return; }
      scale = Math.min(Math.max(r.width / 728, 1), 3);
      h = Math.round(CONFIG.BAR_HEIGHT * scale);
      top = r.top;                       // 全画面は動画上端に重ねる
    } else {
      if (!state.jihou && !CONFIG.NEWS_ENABLED) { hideAll(); return; }
      scale = Math.min(1, r.width / CONFIG.JIHOU_W);
      h = CONFIG.BAR_HEIGHT;
      top = r.top - h;                   // プレーヤーの直上
    }
    // 通常時は文書座標(absolute)、全画面時はビューポート座標(fixed)
    const ox = fs ? 0 : window.scrollX, oy = fs ? 0 : window.scrollY;
    const key = [r.left + ox, top + oy, r.width, r.height, h, state.jihou, fs].map((n) => Math.round(+n)).join(",");
    state.barVisible = true;
    if (key === lastKey) return;
    lastKey = key;

    bar.dataset.mode = state.jihou ? "jihou" : "news";
    bar.style.cssText = `display:block;left:${r.left + ox}px;top:${top + oy}px;width:${r.width}px;height:${h}px;`;
    bar.style.setProperty("--h", h + "px");
    jv.style.width = Math.round(CONFIG.JIHOU_W * scale) + "px";
    jv.style.height = Math.round(CONFIG.JIHOU_H * scale) + "px";
    if (state.jihou) {
      dimEl.style.cssText =
        `all:initial;display:block;position:${fs ? "fixed" : "absolute"};left:${r.left + ox}px;top:${r.top + oy}px;` +
        `width:${r.width}px;height:${r.height}px;background:#000;opacity:${CONFIG.DIM};pointer-events:none;z-index:${MAXZ};`;
    } else {
      dimEl.style.display = "none";
    }
  }
  (function frame() { try { layout(); } catch (e) { console.warn("[時報Lite]", e); } requestAnimationFrame(frame); })();

  // ---------- 時報 ----------
  async function playJihou(entry, force = false) {
    if (state.jihou) return;
    const v = onWatchPage() ? pickVideo() : null;
    if (!v) return;
    if (!force && CONFIG.ONLY_WHEN_PLAYING && (v.paused || v.ended)) return;

    state.jihou = true;
    const wasPlaying = !v.paused && !v.ended;
    const guard = () => { if (state.jihou && !v.paused) v.pause(); };
    v.addEventListener("play", guard);
    v.pause();
    lastKey = "";

    jihouBox.classList.toggle("clickable", !!entry.url);
    jihouBox.onclick = entry.url ? () => window.open(entry.url, "_blank", "noopener") : null;

    try {
      jv.src = api.runtime.getURL(entry.file);
      jv.volume = CONFIG.VOLUME;
      jv.muted = false;
      const finished = new Promise((resolve) => {
        jv.onended = resolve;
        jv.onerror = () => { console.warn("[時報Lite] 時報動画の読み込みに失敗", jv.error); resolve(); };
      });
      try {
        await jv.play();
      } catch (e) {
        if (e && e.name === "NotAllowedError") { jv.muted = true; await jv.play(); } else throw e;
      }
      await Promise.race([finished, sleep(120000)]);
    } catch (e) {
      console.warn("[時報Lite] 時報の再生中にエラー", e);
    } finally {
      jv.pause();
      jv.removeAttribute("src");
      jv.load();
      v.removeEventListener("play", guard);
      state.jihou = false;
      lastKey = "";
      nextAt = Date.now() + CONFIG.NEWS_ROTATE_SEC * 1000;
      if (wasPlaying) v.play().catch(() => {});
    }
  }

  // ---------- 時刻チェック ----------
  const fired = new Map();
  const sameMinute = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() && a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes();

  // イベントのメッセージ。時報が終わった直後に、ニュース／お知らせ欄の最初に一度だけ表示する
  function showEventMessage(e, force = false) {
    if (!e.message || !CONFIG.NEWS_ENABLED) return;
    if (!force && !isEnabled("events")) return; // イベント時報がOFFならメッセージも出さない
    pinMessage({ key: "event:" + e.id, title: e.message, link: e.messageUrl || e.url, label: null, once: true });
  }

  function checkSchedule() {
    if (!settingsLoaded) return;
    const now = new Date();
    const nowMs = now.getTime();

    // 1) イベント時報（優先。設定でOFFのときは出さず、定時の時報の邪魔もしない）
    let eventThisMinute = false;
    for (const e of (isEnabled("events") ? EVENTS : [])) {
      if (sameMinute(new Date(e.atMs), now)) eventThisMinute = true;
      const dt = nowMs - e.atMs;
      if (dt >= 0 && dt < 10000 && !fired.has("ev:" + e.id)) {
        fired.set("ev:" + e.id, true);
        playJihou(e).then(() => showEventMessage(e)); // 時報が終わったらメッセージ
      }
    }
    // 2) 定時の時報（同じ分にイベントがあれば出さない）
    if (!eventThisMinute && now.getSeconds() < 10) {
      for (const r of SCHEDULE) {
        if (now.getHours() !== r.hour || now.getMinutes() !== r.minute) continue;
        if (!isEnabled(r.id)) continue;
        const key = now.toDateString() + r.id;
        if (fired.get(r.id) === key) continue;
        fired.set(r.id, key);
        playJihou(r);
      }
    }
  }
  setInterval(checkSchedule, 500);
  // 裏のタブでは、タイマーが間引かれて遅れることがある。前面に戻ったときにも確認する
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkSchedule(); });

  // ---------- テスト用（DevToolsのコンソールで実行。ON/OFF設定には影響されません） ----------
  //   document.dispatchEvent(new Event("jihou:0"))    … 0時の時報
  //   document.dispatchEvent(new Event("jihou:2"))   … 2時の時報
  //   document.dispatchEvent(new Event("jihou:event"))    … schedule.js の1番目のイベント
  document.addEventListener("jihou:0", () => {
    const r = SCHEDULE.find((x) => x.hour === 0) || SCHEDULE[0];
    if (r) playJihou(r, true);
  });
  document.addEventListener("jihou:2", () => {
    const r = SCHEDULE.find((x) => x.hour === 2);
    if (r) playJihou(r, true); else console.warn("[時報Lite] 2時の定時時報が未設定です");
  });
  document.addEventListener("jihou:event", () => {
    const raw = (globalThis.JIHOU_EVENTS || [])[0];
    if (!raw) { console.warn("[時報Lite] schedule.js にイベントがありません"); return; }
    const e = normEvent(raw);
    playJihou(e, true).then(() => showEventMessage(e, true)); // テストはON/OFF設定に関係なく実行
  });

  // ---------- ニュース／お知らせ ----------
  const news = {
    feeds: {},        // key -> [{title, link, label}]
    items: [],        // 表示対象（フィードを交互に並べ、スキップ済みを除外）
    idx: 0,
    cur: null,        // いま表示中の項目
    skipped: {},      // key(link またはイベントkey) -> 記録時刻(ms)
    busyUntil: 0,
    pinned: [],       // イベントのメッセージ（一度きり。先頭に差し込む）
    rank: new Map(),  // 無作為順のための、項目ごとの乱数（key -> 0〜1）
  };
  const keyOf = (i) => i.key || i.link;
  let nextAt = Date.now() + CONFIG.NEWS_ROTATE_SEC * 1000;

  // 子要素のうち、名前（localName）が names のどれかに一致する最初の非空テキスト
  function childText(el, names) {
    for (const c of el.children) {
      if (names.includes(c.localName)) {
        const t = (c.textContent || "").trim();
        if (t) return t;
      }
    }
    return "";
  }

  function parseFeed(text, label) {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("feed parse error");
    const out = [];
    doc.querySelectorAll("item, entry").forEach((el) => {
      const title = childText(el, ["title"]).replace(/\s+/g, " ");
      // Atom は link が複数ある場合があるので、rel が無いか alternate のものを優先
      const links = Array.from(el.children).filter((c) => c.localName === "link");
      const linkEl = links.find((l) => !l.getAttribute("rel") || l.getAttribute("rel") === "alternate") || links[0];
      const link = (linkEl?.getAttribute("href") || linkEl?.textContent || "").trim();
      // 日時: RSS の pubDate / dc:date、Atom の published / updated
      let at = Date.parse(childText(el, ["pubDate", "published", "updated", "date"]));
      if (Number.isNaN(at)) at = null;
      if (title && /^https?:\/\//.test(link)) out.push({ title, link, label, at });
    });
    return CONFIG.MAX_PER_FEED > 0 ? out.slice(0, CONFIG.MAX_PER_FEED) : out;
  }

  function renderItem(item, dir) {
    const el = document.createElement("a");
    el.className = "item";
    el.href = item.link;
    el.target = "_blank";
    el.rel = "noopener noreferrer";
    el.title = item.title;
    // フィード項目は 【ニュース】／【お知らせ】 を付ける。イベントのメッセージは文面そのまま
    el.textContent = (item.label ? `【${item.label}】` : "") + item.title;

    const old = Array.from(viewport.children);
    viewport.appendChild(el);
    news.cur = item;
    if (dir && old.length) {
      // 表示は静止。切り替え時だけ横にスクロール（dir=+1: 右→左 / -1: 左→右）
      const opt = { duration: CONFIG.NEWS_SLIDE_MS, easing: "ease-in-out", fill: "forwards" };
      news.busyUntil = Date.now() + CONFIG.NEWS_SLIDE_MS;
      el.animate([{ transform: `translateX(${100 * dir}%)` }, { transform: "translateX(0)" }], opt);
      old.forEach((o) => {
        const a = o.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-100 * dir}%)` }], opt);
        a.onfinish = () => o.remove();
      });
    } else {
      old.forEach((o) => o.remove());
    }
  }

  function rebuildItems() {
    // すべてのフィードの項目を集め、同じURLは1件にまとめ、スキップ済みを除く
    const seen = new Set();
    const all = [];
    for (const f of FEEDS) {
      for (const i of news.feeds[f.key] || []) {
        const k = keyOf(i);
        if (k in news.skipped || seen.has(k)) continue;
        seen.add(k);
        all.push(i);
      }
    }
    let merged;
    if (CONFIG.NEWS_ORDER === "newest") {
      // 日時の新しい順。日時のない項目は最後に回し、同じ日時のものは元の並びを保つ
      merged = all
        .map((item, n) => ({ item, n }))
        .sort((x, y) => {
          const tx = x.item.at ?? -Infinity, ty = y.item.at ?? -Infinity;
          return tx === ty ? x.n - y.n : ty - tx;
        })
        .map((x) => x.item);
    } else {
      // 無作為。フィードを再取得しても並びが入れ替わらないよう、項目ごとの乱数を最初に決めて覚えておく
      merged = all
        .map((item) => {
          const k = keyOf(item);
          if (!news.rank.has(k)) news.rank.set(k, Math.random());
          return { item, r: news.rank.get(k) };
        })
        .sort((x, y) => x.r - y.r)
        .map((x) => x.item);
    }
    news.items = news.pinned.concat(merged);

    const at = news.cur ? news.items.findIndex((i) => keyOf(i) === keyOf(news.cur)) : -1;
    if (at >= 0) { news.idx = at; return; }
    news.idx = 0;
    if (news.items.length) renderItem(news.items[0], 0);
    else { viewport.textContent = ""; news.cur = null; }
  }

  // イベントのメッセージを先頭に差し込み、すぐ表示枠に出す（一度きり）
  function pinMessage(item) {
    news.pinned = news.pinned.filter((i) => keyOf(i) !== keyOf(item));
    news.pinned.unshift(item);
    rebuildItems();
    const at = news.items.findIndex((i) => keyOf(i) === keyOf(item));
    if (at >= 0) {
      news.idx = at;
      renderItem(news.items[at], 0);
      nextAt = Date.now() + CONFIG.NEWS_ROTATE_SEC * 1000;
    }
  }

  // 表示中の「一度きり」メッセージを、離れる前に取り除く。取り除いた位置を返す（なければ -1）
  function dropOnceIfShown() {
    const cur = news.cur;
    if (!cur || !cur.once) return -1;
    news.pinned = news.pinned.filter((i) => keyOf(i) !== keyOf(cur));
    const at = news.items.findIndex((i) => keyOf(i) === keyOf(cur));
    if (at >= 0) news.items.splice(at, 1);
    return at;
  }

  function go(step) {
    if (!news.items.length) return;
    if (Date.now() < news.busyUntil) return;
    const dropped = dropOnceIfShown();
    if (dropped >= 0) news.idx = step >= 0 ? dropped - 1 : dropped; // 次/前が正しい位置に来るよう調整
    const len = news.items.length;
    if (!len) { viewport.textContent = ""; news.cur = null; return; }
    news.idx = (news.idx + step + len * 2) % len;
    renderItem(news.items[news.idx], len > 1 || dropped >= 0 ? (step >= 0 ? 1 : -1) : 0);
    nextAt = Date.now() + CONFIG.NEWS_ROTATE_SEC * 1000;
  }

  function skipCurrent() {
    if (!news.cur || Date.now() < news.busyUntil) return;
    const dropped = dropOnceIfShown();
    if (dropped >= 0) {
      if (!news.items.length) { viewport.textContent = ""; news.cur = null; return; }
      news.idx = dropped % news.items.length;
      renderItem(news.items[news.idx], 1);
      nextAt = Date.now() + CONFIG.NEWS_ROTATE_SEC * 1000;
      return;
    }
    news.skipped[keyOf(news.cur)] = Date.now();
    try { api.storage.local.set({ jihouSkipped: news.skipped }); } catch (_) {}
    const len = news.items.length;
    news.items.splice(news.idx, 1);
    if (!news.items.length) { viewport.textContent = ""; news.cur = null; return; }
    news.idx = news.idx % news.items.length;      // 次の項目が同じ位置に繰り上がる
    renderItem(news.items[news.idx], len > 1 ? 1 : 0);
    nextAt = Date.now() + CONFIG.NEWS_ROTATE_SEC * 1000;
  }

  $("prev").addEventListener("click", () => go(-1));
  $("next").addEventListener("click", () => go(+1));
  $("skip").addEventListener("click", skipCurrent);

  async function refreshFeeds() {
    await Promise.all(FEEDS.map(async (f) => {
      try {
        const res = await api.runtime.sendMessage({ type: "fetchFeed", key: f.key });
        if (!res || !res.ok) throw new Error(res ? res.error : "no response");
        news.feeds[f.key] = parseFeed(res.text, f.label);
        console.debug(`[時報Lite] ${f.label} 取得:`, news.feeds[f.key].length, "件");
      } catch (e) {
        console.warn(`[時報Lite] ${f.label} 取得失敗`, e);
      }
    }));
    rebuildItems();
  }

  async function initNews() {
    try {
      const got = await api.storage.local.get("jihouSkipped");
      const lim = Date.now() - CONFIG.SKIP_KEEP_DAYS * 86400000;
      for (const [k, t] of Object.entries(got.jihouSkipped || {})) if (t > lim) news.skipped[k] = t;
    } catch (_) {}
    await refreshFeeds();
    setInterval(refreshFeeds, CONFIG.NEWS_REFRESH_MIN * 60 * 1000);
    // 自動切り替え（表示中・時報中でないときだけカウントを進める）
    setInterval(() => {
      const ok = CONFIG.NEWS_ENABLED && state.barVisible && !state.jihou && !document.hidden && news.items.length > 1;
      if (!ok) { nextAt = Date.now() + CONFIG.NEWS_ROTATE_SEC * 1000; return; }
      if (Date.now() >= nextAt) go(+1);
    }, 250);
  }
  if (CONFIG.NEWS_ENABLED) initNews();

  console.debug("[時報Lite] 読み込み完了");
})();
