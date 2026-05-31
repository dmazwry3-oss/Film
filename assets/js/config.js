/* ============================================================
   Configuration
   ------------------------------------------------------------
   The app talks to the xemoz "drachin" API. Because that API
   lives on another origin, browsers may block the request with
   a CORS error. There are three supported modes — pick whichever
   works for your hosting setup by changing API_MODE below.

     'direct' : call the upstream API straight from the browser.
                Works only if the API sends CORS headers.

     'proxy'  : call a same-origin endpoint ("/api/...") that
                forwards the request. Use this when you run the
                bundled Node server (npm start) or host behind
                your own reverse proxy. Avoids CORS entirely.

     'cors'   : route the request through a public CORS proxy.
                Handy fallback for static hosting (GitHub Pages)
                when the API itself has no CORS headers.

   By default the app AUTO-DETECTS: if it is served by the
   bundled Node server it uses the proxy; otherwise it tries the
   API directly and lets you switch to the CORS fallback from the
   error screen.
   ============================================================ */

const UPSTREAM = "https://api-xemoz-official.my.id/api/drachin";

// A public CORS proxy used only as a last-resort fallback.
// You can replace this with your own deployment of cors-anywhere.
const CORS_PROXY = "https://corsproxy.io/?url=";

// Auto-detect a sensible default mode.
function detectMode() {
  // Allow overriding via ?api=direct|proxy|cors in the URL.
  const fromQuery = new URLSearchParams(location.search).get("api");
  if (fromQuery) return fromQuery;

  // Remembered choice from a previous session.
  const stored = localStorage.getItem("dv:apiMode");
  if (stored) return stored;

  // If served over http(s) from a real host, assume the bundled
  // proxy server may be present and try it first.
  if (location.protocol === "http:" || location.protocol === "https:") {
    return "proxy";
  }
  // Opened from the filesystem (file://) — must go direct.
  return "direct";
}

export const CONFIG = {
  upstream: UPSTREAM,
  corsProxy: CORS_PROXY,
  get mode() {
    return this._mode || (this._mode = detectMode());
  },
  setMode(mode) {
    this._mode = mode;
    try {
      localStorage.setItem("dv:apiMode", mode);
    } catch (_) {}
  },
};

/**
 * Build the final URL for a given API path + query, honouring the
 * current mode.
 * @param {string} path  e.g. "pinedrama/home.php"
 * @param {Object} [params] query parameters
 */
export function buildUrl(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ).toString();

  const mode = CONFIG.mode;

  if (mode === "proxy") {
    // Same-origin: handled by the bundled Node server.
    return `/api/${path}${qs ? "?" + qs : ""}`;
  }

  const directUrl = `${UPSTREAM}/${path}${qs ? "?" + qs : ""}`;

  if (mode === "cors") {
    return CONFIG.corsProxy + encodeURIComponent(directUrl);
  }
  // 'direct'
  return directUrl;
}
