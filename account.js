// アカウント設定ページ（https://account.nicovideo.jp/my/account）に、
// 時報のON/OFFを切り替える設定パネルを追加する。
// 「ブラウザのプッシュ通知設定」の直前に差し込み、サイトの見た目（.docs 系のクラス）に合わせる。
(() => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const SETTINGS_KEY = "jihouEnabled"; // content.js と共通。{ "0000": true, "0200": false, "events": true }
  const SECTION_ID = "jihou-lite-settings";
  const SCHEDULE = globalThis.JIHOU_SCHEDULE || [];

  // 切り替え項目: schedule.js の定時の時報（1件ごと）＋ イベント時報
  const pad = (n) => String(n).padStart(2, "0");
  const ROWS = [
    ...SCHEDULE.map((r) => ({
      key: r.id,
      label: r.label || `${r.hour}:${pad(r.minute)} の時報`,
    })),
    { key: "events", label: "イベント時報" },
  ];

  // サイトの #webpush 用トグルと同じ見た目を、このパネル専用に定義する
  const CSS = `
    #${SECTION_ID} .item { display: flex; align-items: center; justify-content: space-between; }
    #${SECTION_ID} .label { display: block; width: auto; flex: 1 1 auto; font-size: 1.3rem; }
    #${SECTION_ID} .status { display: block; width: auto; flex: 0 0 auto; padding-right: 2px; }
    #${SECTION_ID} .note { font-size: 1.1rem; color: #888; line-height: 1.5; }
    #${SECTION_ID} input[type=checkbox].toggle-button { height: 0; width: 0; visibility: hidden; position: absolute; }
    #${SECTION_ID} .toggle-switch {
      cursor: pointer; display: block; position: relative;
      width: 52px; height: 20px; border-radius: 30px; line-height: 20px;
      background-color: #f36a5f; margin: 2px 0;
    }
    #${SECTION_ID} .toggle-switch:after {
      content: ""; position: absolute; top: -2px; left: -2px;
      width: 24px; height: 24px; border-radius: 12px; background-color: #fff;
      box-shadow: 0 0 4px rgba(0,0,0,0.4); transition: 0.3s;
    }
    #${SECTION_ID} input:checked + .toggle-switch { background-color: #48cb31; }
    #${SECTION_ID} input:checked + .toggle-switch:after { left: calc(100% - 24px); }
    #${SECTION_ID} .toggle-status { position: absolute; top: 0; font-weight: bold; color: #fff; font-size: 1.1rem; }
    #${SECTION_ID} .on-label  { left: 8px;  display: none; }
    #${SECTION_ID} .off-label { right: 6px; display: inline-block; }
    #${SECTION_ID} input:checked + .toggle-switch .on-label  { display: inline-block; }
    #${SECTION_ID} input:checked + .toggle-switch .off-label { display: none; }
  `;

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else e.setAttribute(k, v);
    }
    for (const c of children) e.append(c);
    return e;
  }

  function buildSection() {
    const rows = ROWS.map((row) => {
      const id = `${SECTION_ID}-${row.key}`;
      const input = el("input", { type: "checkbox", id, class: "toggle-button", "data-key": row.key });
      const sw = el(
        "label",
        { for: id, class: "toggle-switch" },
        el("span", { class: "toggle-status on-label" }, "ON"),
        el("span", { class: "toggle-status off-label" }, "OFF")
      );
      return el(
        "p",
        { class: "item" },
        el("span", { class: "label" }, row.label),
        el("span", { class: "status" }, input, sw)
      );
    });
    const note = el(
      "p",
      { class: "item note" },
      "拡張機能「時報 Lite」の設定です。このブラウザの視聴ページにのみ反映され、視聴ページの再読み込みは不要です。"
    );
    return el(
      "section",
      { id: SECTION_ID, class: "docs" },
      el("style", {}, CSS),
      el("header", { class: "docs-header" }, el("h1", { class: "docs-header__title" }, "時報の表示設定")),
      el("div", { class: "docs-body" }, ...rows, note)
    );
  }

  async function loadMap() {
    try {
      const got = await api.storage.local.get(SETTINGS_KEY);
      return got[SETTINGS_KEY] || {};
    } catch (_) {
      return {};
    }
  }

  async function mount() {
    if (document.getElementById(SECTION_ID)) return true;
    // 差し込み先: 「ブラウザのプッシュ通知設定」の直前。見つからなければ右カラムの先頭
    const anchor = document.getElementById("webpush");
    const column = anchor ? anchor.parentNode : document.querySelector(".column:last-child");
    if (!column) return false;

    const section = buildSection();
    column.insertBefore(section, anchor || column.firstChild);

    const map = await loadMap();
    section.querySelectorAll("input.toggle-button").forEach((input) => {
      input.checked = map[input.dataset.key] !== false; // 未設定はON
      input.addEventListener("change", async () => {
        const next = await loadMap();                   // 他のタブでの変更を壊さないよう、読み直してから更新
        next[input.dataset.key] = input.checked;
        try {
          await api.storage.local.set({ [SETTINGS_KEY]: next });
        } catch (e) {
          console.warn("[時報Lite] 設定の保存に失敗", e);
          input.checked = !input.checked;
        }
      });
    });
    return true;
  }

  // 他のタブで変更されたときに、表示を追従させる
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SETTINGS_KEY]) return;
    const map = changes[SETTINGS_KEY].newValue || {};
    document.querySelectorAll(`#${SECTION_ID} input.toggle-button`).forEach((input) => {
      input.checked = map[input.dataset.key] !== false;
    });
  });

  // ページの描画が遅れても差し込めるよう、見つかるまで最大10秒だけ待つ
  mount().then((ok) => {
    if (ok) return;
    const obs = new MutationObserver(() => {
      mount().then((done) => { if (done) obs.disconnect(); });
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 10000);
  });
})();
