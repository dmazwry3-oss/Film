/* ============================================================
   DramaVerse — tiny static server + API proxy
   ------------------------------------------------------------
   Zero dependencies. Uses only Node's built-in modules and the
   global `fetch` (Node 18+). It does two things:

     1. Serves the static frontend from this folder.
     2. Proxies  /api/<path>  ->  UPSTREAM/<path>
        so the browser never makes a cross-origin request and
        CORS is no longer an issue.

   Run:   node server.js          (or: npm start)
   Then open http://localhost:3000
   ============================================================ */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const UPSTREAM = "https://api-xemoz-official.my.id/api/drachin";
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function handleProxy(req, res, urlObj) {
  // /api/pinedrama/home.php?x=y  ->  UPSTREAM/pinedrama/home.php?x=y
  const rest = urlObj.pathname.replace(/^\/api\/?/, "");
  const target = `${UPSTREAM}/${rest}${urlObj.search || ""}`;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        // Present as a normal browser to avoid naive bot blocks.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Referer: "https://api-xemoz-official.my.id/",
      },
    });

    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "Content-Type":
        upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: "proxy_failed", message: String(err && err.message) }));
  }
}

function serveStatic(req, res, urlObj) {
  let pathname = decodeURIComponent(urlObj.pathname);
  if (pathname === "/") pathname = "/index.html";

  // Prevent path traversal.
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback: unknown routes are served the shell.
      return fs.readFile(path.join(ROOT, "index.html"), (e2, html) => {
        if (e2) {
          res.writeHead(404);
          return res.end("Not found");
        }
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        res.end(html);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  if (urlObj.pathname.startsWith("/api/")) {
    return handleProxy(req, res, urlObj);
  }
  serveStatic(req, res, urlObj);
});

server.listen(PORT, () => {
  console.log(`\n  🎬 DramaVerse running at  http://localhost:${PORT}`);
  console.log(`     Proxying /api/*  ->  ${UPSTREAM}\n`);
});
