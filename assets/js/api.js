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

let lastDebug = { url: "", data: null };
export function getLastDebug() {
  return lastDebug;
}

/** Pick the first defined, non-empty value among several keys. */
function pick(obj, keys, fallback = undefined) {
  if (!obj || typeof obj !== "object") return fallback;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fallback;
}

/** Find the most relevant array inside an arbitrary response. */
function asArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];

  const named = [
    "data", "result", "results", "items", "list", "rows",
    "dramas", "drama", "episodes", "episode", "videos", "content",
    "data_list", "lists", "movies", "series", "response",
  ];
  for (const k of named) {
    if (Array.isArray(data[k])) return data[k];
    // one level deeper, e.g. { data: { list: [...] } }
    if (data[k] && typeof data[k] === "object") {
      for (const k2 of named) {
        if (Array.isArray(data[k][k2])) return data[k][k2];
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
  for (const k of ["data", "result", "detail", "info", "drama", "response"]) {
    if (data[k] && typeof data[k] === "object" && !Array.isArray(data[k])) {
      return data[k];
    }
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
    const e = new Error(
      "Tidak bisa terhubung ke API. Kemungkinan diblokir CORS atau jaringan."
    );
    e.code = "network";
    e.cause = err;
    throw e;
  }

  if (!res.ok) {
    const e = new Error(`API mengembalikan status ${res.status}.`);
    e.code = "http";
    e.status = res.status;
    throw e;
  }

  let data;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch (_) {
    // Some endpoints may wrap JSON in HTML or return plain text.
    data = text;
  }

  lastDebug = { url, data };
  return data;
}

/* ---------- normalizers ---------- */

/** Normalize a single list item into a card-friendly shape. */
export function normalizeItem(raw, source = "pinedrama") {
  if (!raw || typeof raw !== "object") return null;
  const title = pick(raw, [
    "title", "name", "judul", "drama_title", "bookName", "book_name", "movie_name",
  ], "Tanpa Judul");

  const poster = pick(raw, [
    "poster", "image", "img", "thumbnail", "thumb", "cover", "gambar",
    "coverImg", "cover_image", "image_url", "picture", "banner",
  ], "");

  const slug = deriveSlug(raw);

  const episodes = pick(raw, [
    "total_episode", "total_episodes", "episodes", "episode_count",
    "eps", "chapterCount", "total", "episode",
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
    synopsis: pick(raw, ["synopsis", "description", "desc", "sinopsis", "overview", "intro"], ""),
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

/** Extract playable stream + downloads + episode list from a detail payload. */
export function normalizeStream(data, source = "pinedrama") {
  const obj = asObject(data);

  // Stream URL: look across many likely fields, including nested ones.
  let stream =
    pick(obj, [
      "stream", "stream_url", "streamUrl", "url", "video", "video_url",
      "videoUrl", "file", "source", "m3u8", "hls", "play_url", "playUrl",
      "embed", "embed_url", "iframe", "link",
    ]) || deepFindStream(data);

  // Sometimes the stream lives in a `sources`/`servers` array.
  const servers = [];
  const serverArr = asArray(pick(obj, ["sources", "servers", "server", "qualities", "links"]) || []);
  for (const s of serverArr) {
    const u = pick(s, ["url", "file", "src", "link", "stream", "m3u8", "play_url"]);
    if (u) servers.push({ label: pick(s, ["label", "quality", "name", "server", "resolution"], "Server"), url: u });
  }
  if (!stream && servers.length) stream = servers[0].url;

  // Download links.
  const downloads = [];
  const dlArr = asArray(pick(obj, ["download", "downloads", "download_url", "dl"]) || []);
  for (const d of dlArr) {
    if (typeof d === "string") {
      downloads.push({ label: "Unduh", url: d });
    } else {
      const u = pick(d, ["url", "link", "file", "download", "src"]);
      if (u) downloads.push({ label: pick(d, ["quality", "label", "resolution", "name"], "Unduh"), url: u });
    }
  }
  const singleDl = pick(obj, ["download_url", "downloadUrl"]);
  if (singleDl && !downloads.length) downloads.push({ label: "Unduh", url: singleDl });

  return {
    source,
    title: pick(obj, ["title", "name", "judul", "drama_title", "bookName"], ""),
    poster: pick(obj, ["poster", "image", "thumbnail", "cover", "img"], ""),
    synopsis: pick(obj, ["synopsis", "description", "desc", "sinopsis", "overview"], ""),
    genre: pick(obj, ["genre", "genres", "tags"], ""),
    year: pick(obj, ["year", "tahun", "release"], ""),
    rating: pick(obj, ["rating", "score"], ""),
    stream: stream || "",
    servers,
    downloads,
    episodes: normalizeEpisodes(data),
    currentEp: pick(obj, ["ep", "episode", "current_episode", "episode_number"], ""),
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

/** Build an episode list, normalizing into { number, label, slug, ep, url }. */
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
        return { number: n, label: `Eps ${n}`, ep: n, slug: "", url: "" };
      }
      const num = pick(e, [
        "ep", "episode", "number", "no", "index", "chapter", "episode_number",
      ], String(i + 1));
      return {
        number: String(num),
        label: pick(e, ["title", "name", "label"], `Eps ${num}`),
        ep: String(num),
        slug: deriveSlug(e),
        url: pick(e, ["url", "link", "stream", "file"], ""),
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
