// RSS/Atomフィードの取得を担当（content script からはCORSで取れないため）
const FEED_URLS = {
  news: "https://news.nicovideo.jp/topiclist?rss=2.0",
  notice: "https://blog.nicovideo.jp/niconews/feed/topics/index.xml",
};
const CACHE_MS = 3 * 60 * 1000;
const cache = {}; // key -> { at, text }

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "fetchFeed") return undefined;
  const url = FEED_URLS[msg.key];
  if (!url) return Promise.resolve({ ok: false, error: "unknown feed" });

  const c = cache[msg.key];
  if (c && Date.now() - c.at < CACHE_MS) {
    return Promise.resolve({ ok: true, text: c.text, cached: true });
  }
  return fetch(url, { cache: "no-store", credentials: "omit" })
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    })
    .then((text) => {
      cache[msg.key] = { at: Date.now(), text };
      return { ok: true, text };
    })
    .catch((e) => ({ ok: false, error: String(e) }));
});
