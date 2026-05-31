/* ============================================================
   DramaVerse — application entry point
   Hash router + page controllers + HLS-capable player.
   ============================================================ */

import { CONFIG } from "./config.js";
import {
  api, normalizeList, normalizeHome, normalizeStream, getLastDebug, slugify,
} from "./api.js";
import {
  esc, cardHtml, gridHtml, sectionHtml, skeletonGrid, stateHtml,
  heroHtml, watchHref, placeholderPoster, toast,
} from "./ui.js";

const view = document.getElementById("view");
let activeHls = null;

/* ---------- helpers ---------- */

function setActiveNav(route) {
  document.querySelectorAll(".nav__link").forEach((a) => {
    a.classList.toggle("is-active", a.dataset.route === route);
  });
}

function parseHash() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [path, queryStr] = hash.split("?");
  const params = Object.fromEntries(new URLSearchParams(queryStr || ""));
  return { path: path || "/", params };
}

function scrollTop() {
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function destroyPlayer() {
  if (activeHls) {
    try { activeHls.destroy(); } catch (_) {}
    activeHls = null;
  }
}

/** Build the standard "API unreachable" error screen with fallbacks. */
function apiErrorState(err, retry) {
  const mode = CONFIG.mode;
  const isNetwork = err && (err.code === "network" || err.code === "http");
  const actions = `
    <button class="btn btn--primary" id="errRetry">Coba lagi</button>
    ${mode !== "cors" ? `<button class="btn btn--ghost" id="errCors">Pakai proxy CORS</button>` : ""}
    ${mode !== "direct" ? `<button class="btn btn--ghost" id="errDirect">Coba langsung</button>` : ""}
  `;
  view.innerHTML = stateHtml({
    icon: "📡",
    title: "Tidak bisa memuat data",
    msg: `${esc(err?.message || "Terjadi kesalahan.")}<br />
      Mode API saat ini: <code>${mode}</code>.
      ${isNetwork ? "Jika kamu membuka file langsung, jalankan lewat server atau coba opsi di bawah." : ""}`,
    actions,
  });
  document.getElementById("errRetry")?.addEventListener("click", retry);
  document.getElementById("errCors")?.addEventListener("click", () => {
    CONFIG.setMode("cors");
    toast("Beralih ke proxy CORS…");
    retry();
  });
  document.getElementById("errDirect")?.addEventListener("click", () => {
    CONFIG.setMode("direct");
    toast("Beralih ke koneksi langsung…");
    retry();
  });
  refreshDebug();
}

/* ---------- pages ---------- */

async function pageHome() {
  setActiveNav("home");
  view.innerHTML = `
    <div class="hero skel" style="min-height:380px"></div>
    ${skeletonGrid(6, { rail: true })}`;

  try {
    const [homeData, popData, newsData] = await Promise.allSettled([
      api.home(), api.popular(), api.news(),
    ]);

    const sections = homeData.status === "fulfilled" ? normalizeHome(homeData.value) : [];
    const popular = popData.status === "fulfilled" ? normalizeList(popData.value) : [];
    const news = newsData.status === "fulfilled" ? normalizeList(newsData.value) : [];

    // If everything failed, surface the error.
    if (!sections.length && !popular.length && !news.length) {
      const firstErr = [homeData, popData, newsData].find((r) => r.status === "rejected");
      throw firstErr ? firstErr.reason : new Error("Respons kosong dari API.");
    }

    const featured =
      (sections[0] && sections[0].items[0]) || popular[0] || news[0] || null;

    let html = heroHtml(featured);

    if (popular.length) {
      html += sectionHtml("🔥 Populer", popular.slice(0, 18), { rail: true, link: "#/popular" });
    }
    if (news.length) {
      html += sectionHtml("🆕 Terbaru", news.slice(0, 18), { rail: true, link: "#/news" });
    }
    for (const sec of sections) {
      if (sec.items.length) html += sectionHtml(sec.title, sec.items.slice(0, 18), { rail: true });
    }

    view.innerHTML = html;
    scrollTop();
    refreshDebug();
  } catch (err) {
    apiErrorState(err, pageHome);
  }
}

async function pageList(kind) {
  setActiveNav(kind);
  const titleMap = { popular: "🔥 Drama Populer", news: "🆕 Drama Terbaru" };
  view.innerHTML = `
    <section class="section" style="margin-top:8px">
      <div class="section__head"><h2 class="section__title">${titleMap[kind]}</h2></div>
      ${skeletonGrid(18)}
    </section>`;

  try {
    const data = kind === "popular" ? await api.popular() : await api.news();
    const items = normalizeList(data);
    if (!items.length) {
      view.innerHTML = stateHtml({
        icon: "🗂️", title: "Belum ada data",
        msg: "API tidak mengembalikan daftar drama untuk halaman ini.",
        actions: `<a class="btn btn--primary" href="#/">Ke beranda</a>`,
      });
    } else {
      view.innerHTML = `
        <section class="section" style="margin-top:8px">
          <div class="section__head"><h2 class="section__title">${titleMap[kind]}</h2></div>
          ${gridHtml(items)}
        </section>`;
    }
    scrollTop();
    refreshDebug();
  } catch (err) {
    apiErrorState(err, () => pageList(kind));
  }
}

async function pageSearch(params) {
  setActiveNav(null);
  const q = params.q || "";
  const source = params.src === "dramabox" ? "dramabox" : "pinedrama";
  document.getElementById("searchInput").value = q;
  document.getElementById("searchSource").value = source;

  if (!q) {
    view.innerHTML = stateHtml({
      icon: "🔎", title: "Cari drama favoritmu",
      msg: "Ketik judul di kotak pencarian di atas untuk mulai.",
    });
    return;
  }

  view.innerHTML = `
    <section class="section" style="margin-top:8px">
      <div class="section__head"><h2 class="section__title">Hasil untuk "${esc(q)}"</h2></div>
      ${skeletonGrid(12)}
    </section>`;

  try {
    const data = await api.search(q, source);
    const items = normalizeList(data, source);
    if (!items.length) {
      view.innerHTML = stateHtml({
        icon: "🤷", title: "Tidak ditemukan",
        msg: `Tidak ada hasil untuk <code>${esc(q)}</code> di sumber <code>${source}</code>.`,
        actions: `<a class="btn btn--ghost" href="#/search?q=${encodeURIComponent(q)}&src=${source === "pinedrama" ? "dramabox" : "pinedrama"}">Coba sumber lain</a>`,
      });
    } else {
      view.innerHTML = `
        <section class="section" style="margin-top:8px">
          <div class="section__head">
            <h2 class="section__title">Hasil "${esc(q)}"</h2>
            <span class="section__link">${items.length} judul · ${esc(source)}</span>
          </div>
          ${gridHtml(items)}
        </section>`;
    }
    scrollTop();
    refreshDebug();
  } catch (err) {
    apiErrorState(err, () => pageSearch(params));
  }
}

async function pageWatch(params) {
  setActiveNav(null);
  destroyPlayer();
  const source = params.src === "dramabox" ? "dramabox" : "pinedrama";
  const ep = params.ep || "1";
  const slug = params.slug || "";
  const title = params.title || "";

  view.innerHTML = `
    <div class="watch">
      <div>
        <div class="player"><div class="player__frame skel"></div></div>
        <div class="skel skel-line" style="height:26px;width:50%;margin:18px 0"></div>
        <div class="skel skel-line" style="height:14px;width:90%"></div>
      </div>
      <aside class="sidebar">${skeletonGrid(0)}<div class="skel skel-line" style="height:200px;border-radius:12px"></div></aside>
    </div>`;

  try {
    let stream;
    if (source === "dramabox") {
      stream = normalizeStream(await api.dramaboxStream(title, ep), "dramabox");
      if (!stream.title) stream.title = unslug(title);
    } else {
      stream = normalizeStream(await api.detail(slug, ep), "pinedrama");
      if (!stream.title) stream.title = unslug(slug);
    }
    renderWatch(stream, { source, ep, slug, title });
    scrollTop();
    refreshDebug();
  } catch (err) {
    apiErrorState(err, () => pageWatch(params));
  }
}

function renderWatch(stream, ctx) {
  const { source, ep, slug, title } = ctx;
  const meta = [];
  if (stream.currentEp || ep) meta.push("Episode " + esc(stream.currentEp || ep));
  if (stream.year) meta.push(esc(stream.year));
  if (stream.rating) meta.push("★ " + esc(stream.rating));
  meta.push(esc(source === "dramabox" ? "DramaBox" : "PineDrama"));

  // Episode list (fall back to a sensible range if none provided).
  let episodes = stream.episodes;
  if (!episodes.length && stream.episodes.length === 0) {
    const total = parseInt(stream.raw?.total_episode || stream.raw?.episodes || 0, 10);
    if (total > 0 && total < 2000) {
      episodes = Array.from({ length: total }, (_, i) => ({
        ep: String(i + 1), number: String(i + 1), label: `Eps ${i + 1}`,
      }));
    }
  }

  const epHref = (e) =>
    source === "dramabox"
      ? `#/watch?src=dramabox&title=${encodeURIComponent(title)}&ep=${encodeURIComponent(e.ep)}`
      : `#/watch?src=pinedrama&slug=${encodeURIComponent(e.slug || slug)}&ep=${encodeURIComponent(e.ep)}`;

  const epListHtml = episodes.length
    ? `<div class="eplist">
         ${episodes
           .map(
             (e) => `<a class="ep ${String(e.ep) === String(ep) ? "is-active" : ""}"
               href="${epHref(e)}">${esc(e.number)}</a>`
           )
           .join("")}
       </div>`
    : `<p class="footer__muted">Daftar episode tidak tersedia dari API.</p>`;

  const downloadsHtml = stream.downloads.length
    ? `<div class="downloads">
         ${stream.downloads
           .map(
             (d) => `<a class="dl" href="${esc(d.url)}" target="_blank" rel="noopener">
               <span>⬇ Unduh</span><span class="q">${esc(d.label)}</span></a>`
           )
           .join("")}
       </div>`
    : "";

  const serverPicker =
    stream.servers.length > 1
      ? `<div class="chips">
           ${stream.servers
             .map(
               (s, i) =>
                 `<button class="chip" data-srv="${esc(s.url)}" ${i === 0 ? 'style="border-color:var(--brand);color:#fff"' : ""}>${esc(s.label)}</button>`
             )
             .join("")}
         </div>`
      : "";

  const genres = stream.genre
    ? (Array.isArray(stream.genre) ? stream.genre : String(stream.genre).split(/[,/]/))
        .map((g) => `<span class="chip">${esc(g.trim())}</span>`)
        .join("")
    : "";

  view.innerHTML = `
    <div class="watch">
      <div>
        <div class="player">
          <div class="player__frame" id="playerFrame"></div>
        </div>
        <h1 class="watch__title">${esc(stream.title || unslug(slug || title))}</h1>
        <div class="watch__meta">${meta.map((m) => `<span>${m}</span>`).join(" · ")}</div>
        ${serverPicker}
        ${genres ? `<div class="chips">${genres}</div>` : ""}
        ${stream.synopsis ? `<p class="watch__desc">${esc(stream.synopsis)}</p>` : ""}
        <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
          <a class="btn btn--ghost btn--sm" href="#/">← Beranda</a>
          ${stream.stream ? `<a class="btn btn--ghost btn--sm" href="${esc(stream.stream)}" target="_blank" rel="noopener">Buka stream di tab baru</a>` : ""}
        </div>
      </div>
      <aside class="sidebar">
        <h3 class="sidebar__title">Daftar Episode <span class="footer__muted">${episodes.length || ""}</span></h3>
        ${epListHtml}
        ${downloadsHtml ? `<h3 class="sidebar__title" style="margin-top:18px">Unduhan</h3>${downloadsHtml}` : ""}
      </aside>
    </div>`;

  mountPlayer(stream.stream, stream.poster, stream.title);

  // Server switching.
  view.querySelectorAll(".chip[data-srv]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view.querySelectorAll(".chip[data-srv]").forEach((b) => b.removeAttribute("style"));
      btn.style.borderColor = "var(--brand)";
      btn.style.color = "#fff";
      mountPlayer(btn.dataset.srv, stream.poster, stream.title);
    });
  });
}

/** Mount the appropriate player for a stream URL (HLS, mp4, or iframe embed). */
function mountPlayer(url, poster, title) {
  destroyPlayer();
  const frame = document.getElementById("playerFrame");
  if (!frame) return;

  if (!url) {
    frame.innerHTML = `
      <div class="player__empty">
        <div>
          <div style="font-size:2.4rem">🎞️</div>
          <p>Tautan streaming tidak ditemukan pada respons API untuk episode ini.</p>
        </div>
      </div>`;
    return;
  }

  const isEmbed = /\/embed|youtube|youtu\.be|player\.|\/e\//i.test(url) && !/\.(m3u8|mp4|mpd)(\?|$)/i.test(url);
  const isHls = /\.m3u8(\?|$)/i.test(url);

  if (isEmbed) {
    frame.innerHTML = `<iframe src="${esc(url)}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen referrerpolicy="no-referrer"></iframe>`;
    return;
  }

  const video = document.createElement("video");
  video.controls = true;
  video.playsInline = true;
  video.autoplay = true;
  if (poster) video.poster = poster;
  frame.innerHTML = "";
  frame.appendChild(video);

  if (isHls) {
    if (window.Hls && window.Hls.isSupported()) {
      activeHls = new window.Hls({ maxBufferLength: 30 });
      activeHls.loadSource(url);
      activeHls.attachMedia(video);
      activeHls.on(window.Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          toast("Gagal memutar HLS, mencoba pemutar bawaan…");
          frame.innerHTML = `<iframe src="${esc(url)}" allowfullscreen></iframe>`;
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url; // Safari native HLS
    } else {
      frame.innerHTML = `<iframe src="${esc(url)}" allowfullscreen></iframe>`;
    }
  } else {
    // Assume a progressive file (mp4/webm) or a directly playable URL.
    video.src = url;
    video.addEventListener("error", () => {
      frame.innerHTML = `<iframe src="${esc(url)}" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
    });
  }
}

function unslug(s) {
  return String(s || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/* ---------- router ---------- */

function router() {
  const { path, params } = parseHash();
  destroyPlayer();
  closeMobileNav();

  if (path === "/" || path === "") return pageHome();
  if (path === "/popular") return pageList("popular");
  if (path === "/news") return pageList("news");
  if (path === "/search") return pageSearch(params);
  if (path === "/watch") return pageWatch(params);

  view.innerHTML = stateHtml({
    icon: "🚧", title: "Halaman tidak ditemukan",
    msg: "Rute yang kamu tuju tidak ada.",
    actions: `<a class="btn btn--primary" href="#/">Ke beranda</a>`,
  });
}

/* ---------- debug panel ---------- */

function refreshDebug() {
  const panel = document.getElementById("debugPanel");
  if (panel.hidden) return;
  const { url, data } = getLastDebug();
  const body = document.getElementById("debugBody");
  let pretty;
  try { pretty = JSON.stringify(data, null, 2); } catch (_) { pretty = String(data); }
  if (pretty && pretty.length > 6000) pretty = pretty.slice(0, 6000) + "\n… (dipotong)";
  body.textContent = `GET ${url}\n\n${pretty || "Belum ada data."}`;
}

/* ---------- chrome (nav, search, debug) ---------- */

function closeMobileNav() {
  document.getElementById("mainNav")?.classList.remove("open");
  document.getElementById("hamburger")?.setAttribute("aria-expanded", "false");
}

function initChrome() {
  // Search submit.
  document.getElementById("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = document.getElementById("searchInput").value.trim();
    const src = document.getElementById("searchSource").value;
    if (q) location.hash = `#/search?q=${encodeURIComponent(q)}&src=${src}`;
  });

  // Hamburger.
  document.getElementById("hamburger").addEventListener("click", () => {
    const nav = document.getElementById("mainNav");
    const open = nav.classList.toggle("open");
    document.getElementById("hamburger").setAttribute("aria-expanded", String(open));
  });

  // Debug panel toggle.
  const panel = document.getElementById("debugPanel");
  document.getElementById("toggleDebug").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    refreshDebug();
  });
  document.getElementById("debugClose").addEventListener("click", () => {
    panel.hidden = true;
  });

  window.addEventListener("hashchange", router);
}

initChrome();
router();
