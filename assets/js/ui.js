/* ============================================================
   UI helpers — small DOM builders and reusable components.
   ============================================================ */

/** Escape text for safe insertion into HTML. */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Placeholder poster (inline SVG) when an item has no image. */
export function placeholderPoster(title = "") {
  const letter = esc((title.trim()[0] || "🎬").toUpperCase());
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='450'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
    <stop offset='0' stop-color='%231c1c2b'/><stop offset='1' stop-color='%2314141f'/>
    </linearGradient></defs>
    <rect width='300' height='450' fill='url(%23g)'/>
    <text x='50%' y='50%' fill='%23ff3b6b' font-size='120' font-family='sans-serif'
      text-anchor='middle' dominant-baseline='central' opacity='0.5'>${letter}</text>
  </svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg.replace(/\n\s*/g, ""));
}

/** Build the href for an item's watch page based on its source. */
export function watchHref(item, ep = 1) {
  if (item.source === "dramabox") {
    const t = item.titleSlug || item.slug || "";
    return `#/watch?src=dramabox&title=${encodeURIComponent(t)}&ep=${ep}`;
  }
  return `#/watch?src=pinedrama&slug=${encodeURIComponent(item.slug)}&ep=${ep}`;
}

/** Render a single drama card. */
export function cardHtml(item) {
  const poster = item.poster || placeholderPoster(item.title);
  const epBadge = item.episodes
    ? `<span class="card__badge card__badge--ep">${esc(item.episodes)} Eps</span>`
    : item.type
    ? `<span class="card__badge">${esc(item.type)}</span>`
    : "";
  const subBits = [];
  if (item.year) subBits.push(esc(item.year));
  if (item.rating) subBits.push("★ " + esc(item.rating));
  if (!subBits.length && item.source === "dramabox") subBits.push("DramaBox");

  return `
  <a class="card" href="${watchHref(item)}" title="${esc(item.title)}">
    <div class="card__poster">
      <img loading="lazy" src="${esc(poster)}" alt="${esc(item.title)}"
           onerror="this.onerror=null;this.src='${placeholderPoster(item.title)}'" />
      ${epBadge}
      <span class="card__play"><span>
        <svg viewBox="0 0 24 24" width="22" height="22"><path fill="#fff" d="M8 5v14l11-7z"/></svg>
      </span></span>
    </div>
    <div class="card__body">
      <h3 class="card__title">${esc(item.title)}</h3>
      <div class="card__sub">${subBits.map((b) => `<span>${b}</span>`).join("")}</div>
    </div>
  </a>`;
}

/** Render a horizontal rail or grid of cards. */
export function gridHtml(items, { rail = false } = {}) {
  const cls = rail ? "rail" : "grid";
  return `<div class="${cls}">${items.map(cardHtml).join("")}</div>`;
}

export function sectionHtml(title, items, { rail = false, link = "" } = {}) {
  const linkHtml = link ? `<a class="section__link" href="${link}">Lihat semua →</a>` : "";
  return `
  <section class="section">
    <div class="section__head">
      <h2 class="section__title">${esc(title)}</h2>
      ${linkHtml}
    </div>
    ${gridHtml(items, { rail })}
  </section>`;
}

/** Skeleton placeholders while data loads. */
export function skeletonGrid(count = 12, { rail = false } = {}) {
  const one = `
    <div class="skel-card">
      <div class="skel skel-poster"></div>
      <div class="skel skel-line"></div>
      <div class="skel skel-line short"></div>
    </div>`;
  const cls = rail ? "rail" : "grid";
  return `<div class="${cls}">${one.repeat(count)}</div>`;
}

/** Generic empty / error state. */
export function stateHtml({ icon = "🎬", title = "", msg = "", actions = "" }) {
  return `
  <div class="state">
    <div class="state__icon">${icon}</div>
    <h2 class="state__title">${esc(title)}</h2>
    <p class="state__msg">${msg}</p>
    ${actions ? `<div class="state__actions">${actions}</div>` : ""}
  </div>`;
}

/** Build a hero banner from a featured item. */
export function heroHtml(item) {
  if (!item) return "";
  const bg = item.poster || placeholderPoster(item.title);
  const meta = [];
  if (item.year) meta.push(esc(item.year));
  if (item.episodes) meta.push(esc(item.episodes) + " Episode");
  if (item.rating) meta.push("★ " + esc(item.rating));
  if (item.genre) meta.push(esc(Array.isArray(item.genre) ? item.genre.join(", ") : item.genre));

  return `
  <div class="hero">
    <div class="hero__bg" style="background-image:url('${esc(bg)}')"></div>
    <div class="hero__scrim"></div>
    <div class="hero__content">
      <span class="hero__badge">Sorotan Hari Ini</span>
      <h1 class="hero__title">${esc(item.title)}</h1>
      <div class="hero__meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div>
      ${item.synopsis ? `<p class="hero__desc">${esc(item.synopsis)}</p>` : ""}
      <a class="btn btn--primary" href="${watchHref(item)}">
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#fff" d="M8 5v14l11-7z"/></svg>
        Tonton Sekarang
      </a>
    </div>
  </div>`;
}

/** Toast notification. */
let toastTimer;
export function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}
