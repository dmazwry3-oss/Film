/* ============================================================
   API client + defensive response normalization
   ------------------------------------------------------------
   The exact JSON shape returned by the upstream API is not known
   ahead of time, so every accessor below tries a list of likely
   field names and digs through common container wrappers. This
   keeps the UI working across small differences in the payload.
   ============================================================ */

import { CONFIG, buildUrl } from "./config.js";

/* ---------- low-level helpers ---------- */

// Rolling log of recent API calls (newest first), including failures.
// Used by the on-screen debug panel so the real response shape can be
// inspected from the browser.
const MAX_LOG = 10;
let debugLog = [];
function logEntry(entry) {
  debugLog.unshift({ time: new Date().toLocaleTimeString(), ...entry });
  if (debugLog.length > MAX_LOG) debugLog.length = MAX_LOG;
}
export function getDebugLog() {
  return debugLog;
}
export function getLastDebug() {
  return debugLog[0] || { url: "", data: null };
}
/** Allow other modules (e.g. the player) to annotate the latest entry. */
export function noteDebug(note) {
  if (debugLog[0]) debugLog[0].note = note;
}

/** Case-insensitive single-key lookup (the PineDrama API uses Title/Slug/Image). */
function getCI(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  if (key in obj) return obj[key];
  const lk = key.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lk) return obj[k];
  }
  return undefined;
}

/** Pick the first defined, non-empty value among several keys (case-insensitive). */
function pick(obj, keys, fallback = undefined) {
  if (!obj || typeof obj !== "object") return fallback;
  for (const k of keys) {
    const v = getCI(obj, k);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fallback;
}

/** Decode HTML entities (titles arrive like "Mrs. Marshal&#x27;s ..."). */
export function decodeEntities(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Find the most relevant array inside an arbitrary response (case-insensitive keys). */
function asArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];

  const named = [
    "result", "results", "data", "items", "list", "rows",
    "dramas", "drama", "episodes", "episode", "videos", "content",
    "data_list", "lists", "movies", "series", "response",
  ];
  for (const k of named) {
    const v = getCI(data, k);
    if (Array.isArray(v)) return v;
    // one level deeper, e.g. { data: { list: [...] } }
    if (v && typeof v === "object") {
      for (const k2 of named) {
        const v2 = getCI(v, k2);
        if (Array.isArray(v2)) return v2;
      }
    }
  }
  // Fall back to the first array of objects we can find.
  for (const v of Object.values(data)) {
    if (Array.isArray(v) && v.length && typeof v[0] === "object") return v;
  }
  for (const v of Object.values(data)) {
    if (Array.isArray(v)) return v;
  }
  return [];
}

/** Unwrap a single-object payload (e.g. { data: {...} }). */
function asObject(data) {
  if (!data || typeof data !== "object") return {};
  if (Array.isArray(data)) return data[0] || {};
  for (const k of ["data", "result", "detail", "info", "response"]) {
    const v = getCI(data, k);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  }
  return data;
}

/** Slugify a title for endpoints that key on a dasherized title. */
export function slugify(str) {
  return String(str || "")
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Derive a slug from an item that may only expose a URL. */
function deriveSlug(item) {
  const direct = pick(item, ["slug", "permalink", "id", "drama_id", "_id"]);
  if (direct) return String(direct);
  const url = pick(item, ["url", "link", "href", "detail_url"]);
  if (url) {
    const m = String(url).match(/(?:slug=|\/)([a-z0-9-]+)\/?(?:$|\?)/i);
    if (m) return m[1];
  }
  const title = pick(item, ["title", "name", "judul"]);
  return title ? slugify(title) : "";
}

/* ---------- network ---------- */

async function request(path, params, { source = "pinedrama" } = {}) {
  const fullPath = path.includes("/") ? path : `${source}/${path}`;
  const url = buildUrl(fullPath, params);

  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    logEntry({ url, ok: false, error: "network: " + String(err && err.message) });
    const e = new Error(
      "Tidak bisa terhubung ke API. Kemungkinan diblokir CORS atau jaringan."
    );
    e.code = "network";
    e.cause = err;
    throw e;
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    // Some endpoints may wrap JSON in HTML or return plain text.
    data = text;
  }

  if (!res.ok) {
    logEntry({ url, ok: false, status: res.status, data });
    const e = new Error(`API mengembalikan status ${res.status}.`);
    e.code = "http";
    e.status = res.status;
    e.data = data;
    throw e;
  }

  logEntry({ url, ok: true, status: res.status, data });
  return data;
}

/* ---------- normalizers ---------- */

/** Normalize a single list item into a card-friendly shape. */
export function normalizeItem(raw, source = "pinedrama") {
  if (!raw || typeof raw !== "object") return null;
  const title = decodeEntities(pick(raw, [
    "title", "name", "judul", "drama_title", "bookName", "book_name", "movie_name",
  ], "Tanpa Judul"));

  let poster = pick(raw, [
    "poster", "image", "img", "thumbnail", "thumb", "cover", "gambar",
    "coverImg", "cover_image", "image_url", "picture", "banner",
  ], "");
  // PineDrama returns its logo as a placeholder when no real poster exists.
  if (/\/Logo\.svg($|\?)/i.test(poster)) poster = "";

  const slug = deriveSlug(raw);

  const episodes = pick(raw, [
    "total_episode", "total_episodes", "episodes", "episode_count",
    "eps", "chapterCount", "total", "totalEpisodes", "episode",
  ]);

  return {
    source,
    title,
    poster,
    slug,
    titleSlug: slugify(title), // dramabox keys on dasherized title
    episodes: episodes != null ? String(episodes) : "",
    type: pick(raw, ["type", "category", "kategori", "label"], ""),
    year: pick(raw, ["year", "tahun", "release", "release_year"], ""),
    rating: pick(raw, ["rating", "score", "imdb", "vote"], ""),
    genre: pick(raw, ["genre", "genres", "tags", "category"], ""),
    synopsis: decodeEntities(pick(raw, ["synopsis", "description", "desc", "sinopsis", "overview", "intro", "introduction"], "")),
    raw,
  };
}

export function normalizeList(data, source = "pinedrama") {
  return asArray(data)
    .map((x) => normalizeItem(x, source))
    .filter((x) => x && (x.title || x.poster));
}

/**
 * Home payloads often contain several labelled sections. Detect them
 * so we can render multiple rails; fall back to a single list.
 */
export function normalizeHome(data) {
  const sections = [];

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const root = asObject(data);
    for (const [key, val] of Object.entries(root)) {
      const arr = Array.isArray(val) ? val : null;
      if (arr && arr.length && typeof arr[0] === "object") {
        const items = normalizeList(arr);
        if (items.length) {
          sections.push({ title: humanizeKey(key), items });
        }
      }
    }
  }

  if (!sections.length) {
    const items = normalizeList(data);
    if (items.length) sections.push({ title: "Drama Pilihan", items });
  }
  return sections;
}

function humanizeKey(key) {
  const map = {
    result: "Drama Pilihan",
    data: "Drama Pilihan",
    latest: "Terbaru",
    new: "Terbaru",
    news: "Terbaru",
    popular: "Populer",
    trending: "Sedang Tren",
    recommended: "Rekomendasi",
    featured: "Unggulan",
    ongoing: "Sedang Tayang",
    completed: "Tamat",
    top: "Teratas",
    slider: "Sorotan",
    banner: "Sorotan",
  };
  const k = String(key).toLowerCase();
  if (map[k]) return map[k];
  return String(key)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Collect playable URLs from a stream node that may nest .stream.{mp4,m3u8}. */
function collectStreams(node, push) {
  if (!node) return;
  if (typeof node === "string") { push("Server", node); return; }
  if (typeof node !== "object") return;
  // DramaBox nests the real URLs one level down: { episode, ..., stream: { mp4, m3u8 } }
  const inner = node.stream && typeof node.stream === "object" ? node.stream : node;
  const mp4 = pick(inner, ["mp4"]);
  const m3u8 = pick(inner, ["m3u8", "hls"]);
  if (mp4) push("MP4", mp4);
  if (m3u8) push("HLS", m3u8);
}

/** Rank URLs so a directly-playable MP4 is preferred over HLS/embeds. */
function rankUrl(u) {
  if (/\.mp4(\?|$)/i.test(u)) return 3;
  if (/\.m3u8(\?|$)/i.test(u)) return 2;
  return 1;
}

/** Extract playable stream + downloads + episode list from a detail payload. */
export function normalizeStream(data, source = "pinedrama") {
  const root = asObject(data);
  const dramaObj = pick(root, ["drama", "book", "info", "detail"]);
  const meta = dramaObj && typeof dramaObj === "object" ? dramaObj : root;

  const servers = [];
  const seen = new Set();
  const pushServer = (label, url) => {
    if (url && typeof url === "string" && /^https?:\/\//i.test(url) && !seen.has(url)) {
      seen.add(url);
      servers.push({ label: label || "Server", url });
    }
  };

  // 1) Current-episode stream node (DramaBox: root.stream.stream.{mp4,m3u8}).
  const streamNode = pick(root, ["stream", "video", "playInfo", "play"]);
  collectStreams(streamNode, pushServer);

  // 2) Generic single-field URLs at the root / meta.
  const directUrl = pick(root, [
    "stream_url", "streamUrl", "url", "video_url", "videoUrl", "videoPath",
    "playPath", "playUrl", "play_url", "file", "m3u8", "hls", "mp4",
    "embed", "embed_url", "iframe", "link",
  ]);
  if (typeof directUrl === "string") pushServer("Server", directUrl);

  // 3) sources / qualities arrays.
  const serverArr = asArray(
    pick(root, ["sources", "servers", "server", "qualities", "links", "videoList"]) || []
  );
  for (const s of serverArr) {
    if (typeof s === "string") { pushServer("Server", s); continue; }
    const u = pick(s, ["mp4", "m3u8", "url", "file", "src", "link", "stream", "videoPath", "play_url"]);
    pushServer(pick(s, ["label", "quality", "name", "server", "resolution"], "Server"), u);
  }

  // 4) DramaBox-style cdnList: [{ cdnDomain, videoPathList: [{ quality, videoPath }] }]
  const cdnList = asArray(pick(root, ["cdnList", "cdn_list", "cdn"]) || []);
  for (const cdn of cdnList) {
    if (typeof cdn !== "object") continue;
    const base = pick(cdn, ["cdnDomain", "domain", "url", "host"], "");
    const join = (p) => (/^https?:\/\//i.test(p) ? p : (base ? base.replace(/\/$/, "") + "/" + String(p).replace(/^\//, "") : p));
    const vpl = asArray(pick(cdn, ["videoPathList", "videoPaths", "list", "qualities"]) || []);
    for (const v of vpl) {
      const p = pick(v, ["videoPath", "url", "path", "file", "mp4"]);
      if (p) pushServer(String(pick(v, ["quality", "label", "resolution"], "CDN")), join(p));
    }
  }

  // 5) Last resort: scan the whole payload for a video-looking URL.
  if (!servers.length) {
    const found = deepFindStream(data);
    if (found) pushServer("Server", found);
  }

  // Prefer a directly-playable MP4 as the active stream.
  servers.sort((a, b) => rankUrl(b.url) - rankUrl(a.url));
  const stream = servers.length ? servers[0].url : "";

  // Download links.
  const downloads = [];
  const dlArr = asArray(pick(root, ["download", "downloads", "download_url", "dl", "downloadList"]) || []);
  for (const d of dlArr) {
    if (typeof d === "string") {
      downloads.push({ label: "Unduh", url: d });
    } else {
      const u = pick(d, ["url", "link", "file", "download", "src", "mp4", "videoPath"]);
      if (u) downloads.push({ label: pick(d, ["quality", "label", "resolution", "name"], "Unduh"), url: u });
    }
  }
  // DramaBox: also offer the resolved MP4 as a download.
  if (!downloads.length) {
    const mp4 = servers.find((s) => /\.mp4(\?|$)/i.test(s.url));
    if (mp4) downloads.push({ label: "MP4 720p", url: mp4.url });
  }

  const lockedFlag =
    (streamNode && typeof streamNode === "object" && (pick(streamNode, ["locked"]) === true)) ||
    pick(root, ["locked"]) === true;

  const recommendations = normalizeList(
    pick(root, ["recommendations", "recommend", "related", "recommendList"]) || [],
    source
  );

  return {
    source,
    title: decodeEntities(pick(meta, ["title", "name", "judul", "drama_title", "bookName", "book_name"], "")),
    poster: pick(meta, ["cover", "poster", "image", "thumbnail", "img", "coverImg"], ""),
    synopsis: decodeEntities(pick(meta, ["introduction", "synopsis", "description", "desc", "sinopsis", "overview", "intro"], "")),
    genre: pick(meta, ["genres", "genre", "tags"], ""),
    year: pick(meta, ["year", "tahun", "release", "release_year"], ""),
    rating: pick(meta, ["rating", "score", "viewCount"], ""),
    stream,
    locked: lockedFlag,
    servers,
    downloads,
    recommendations,
    episodes: normalizeEpisodes(data),
    currentEp: pick(streamNode && typeof streamNode === "object" ? streamNode : {}, ["episode", "ep"]) ||
      pick(root, ["ep", "episode", "current_episode", "episode_number"], ""),
    raw: data,
  };
}

/** Recursively search for the first URL that looks like a video stream. */
function deepFindStream(node, depth = 0) {
  if (depth > 4 || !node) return "";
  if (typeof node === "string") {
    if (/\.(m3u8|mp4|mpd)(\?|$)/i.test(node) || /^https?:\/\/.*(video|stream|embed)/i.test(node)) {
      return node;
    }
    return "";
  }
  if (typeof node !== "object") return "";
  for (const v of Object.values(node)) {
    const found = deepFindStream(v, depth + 1);
    if (found) return found;
  }
  return "";
}

/** Build an episode list: { number, label, ep, slug, url, locked }. */
export function normalizeEpisodes(data) {
  const obj = asObject(data);
  let arr = asArray(
    pick(obj, ["episodes", "episode_list", "episodeList", "eps", "chapters", "list"]) || []
  );
  // Some detail payloads put episodes at the top level.
  if (!arr.length) arr = asArray(data);

  const eps = arr
    .map((e, i) => {
      if (e == null) return null;
      if (typeof e === "number" || typeof e === "string") {
        const n = String(e);
        return { number: n, label: `Eps ${n}`, ep: n, slug: "", url: "", locked: false };
      }
      const num = pick(e, [
        "ep", "episode", "number", "no", "index", "chapter", "episode_number",
      ], String(i + 1));
      const locked = pick(e, ["unlock"]) === false || pick(e, ["locked"]) === true;
      return {
        number: String(num),
        label: decodeEntities(pick(e, ["title", "name", "label"], `Eps ${num}`)),
        ep: String(num),
        slug: deriveSlug(e),
        url: pick(e, ["mp4", "url", "link", "stream", "file"], ""),
        locked,
      };
    })
    .filter(Boolean);

  // De-duplicate by episode number while keeping order.
  const seen = new Set();
  return eps.filter((e) => {
    if (seen.has(e.ep)) return false;
    seen.add(e.ep);
    return true;
  });
}

/* ---------- public API surface ---------- */

export const api = {
  home: () => request("home.php", {}, { source: "pinedrama" }),
  popular: () => request("pupular.php", {}, { source: "pinedrama" }), // upstream spelling
  news: () => request("news.php", {}, { source: "pinedrama" }),
  search: (q, source = "pinedrama") => request("search.php", { q }, { source }),
  detail: (slug, ep = 1) => request("detail.php", { slug, ep }, { source: "pinedrama" }),
  dramaboxStream: (title, ep = 1) =>
    request("dramabox/stream_and_download.php", { title, ep }),
};
