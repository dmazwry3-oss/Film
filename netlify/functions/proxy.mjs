/* ============================================================
   Netlify serverless function — API proxy
   ------------------------------------------------------------
   Forwards /api/<path>?<query>  ->  UPSTREAM/<path>?<query>

   Why a function instead of a plain Netlify redirect?
   The upstream API rejects generic/automated requests with
   HTTP 403, so we replay a browser-like User-Agent + Referer.
   A plain redirect can't customize those headers; a function can.

   This uses the Netlify Functions v2 (Web standard) signature:
   it receives a Request and returns a Response. `fetch` and
   `Response` are global on Netlify's Node 18+ runtime.
   ============================================================ */

const UPSTREAM = "https://api-xemoz-official.my.id/api/drachin";

export default async (req) => {
  const incoming = new URL(req.url);

  // Strip whichever mount prefix is present to get the upstream path.
  // Handles both the rewritten function path and a direct /api call.
  const rest = incoming.pathname
    .replace(/^\/\.netlify\/functions\/proxy\/?/, "")
    .replace(/^\/api\/?/, "")
    .replace(/^\/+/, "");

  const target = `${UPSTREAM}/${rest}${incoming.search}`;

  // CORS headers so the response is usable from any origin (incl.
  // preview deploys) and preflight requests succeed.
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const upstream = await fetch(target, {
      method: req.method === "POST" ? "POST" : "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Referer: "https://api-xemoz-official.my.id/",
      },
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type":
          upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "proxy_failed", target, message: String(err && err.message) }),
      { status: 502, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
};
