# BSE relay (optional, free) — when BSE blocks the server's IP

BSE answers `HTTP 403` to many cloud IPs (seen on the Oracle server, 2026-10-31/11-01). NSE still answers, so stocks that are
also on NSE keep being scanned. Stocks listed **only on BSE** (today: HSCL, MOREPENLAB — `stocks.nse_symbol` is null) are
invisible to a blocked server. The scanner now tells you on Telegram when that happens ("EXCHANGE ACCESS"), at most every
12 hours. A relay on an IP BSE does not block is the permanent fix.

Order of defences already in the code (no action needed): browser-like session cookies, one retry with a fresh session,
no repeated BSE calls for NSE-covered stocks after two blocks in a run. If the Telegram alert still arrives, use the relay.

## 1. Create the relay (Cloudflare Workers, free plan, ~5 minutes)

Cloudflare dashboard → Workers & Pages → Create → "Hello World" worker → Edit code → paste:

```js
export default {
  async fetch(request, env) {
    if (request.headers.get("x-proxy-token") !== env.PROXY_TOKEN) return new Response("forbidden", { status: 403 });
    const target = new URL(request.url).searchParams.get("url");
    if (!target) return new Response("missing url", { status: 400 });
    const t = new URL(target);
    if (t.hostname !== "api.bseindia.com") return new Response("host not allowed", { status: 400 });
    const res = await fetch(t.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.bseindia.com",
        "Referer": "https://www.bseindia.com/"
      }
    });
    return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") || "application/json" } });
  }
};
```

Settings → Variables and Secrets → add a **secret** `PROXY_TOKEN` (any long random string). Deploy. Note the worker URL
(`https://<name>.<account>.workers.dev`). Only `api.bseindia.com` can be reached through it, and only with the token.

## 2. Test it from the Oracle server (replace the two values; the token stays out of your history with `read -rs`)

```bash
read -rs T; curl -s -o /dev/null -w "%{http_code}\n" -H "x-proxy-token: $T" "https://<worker-url>/?url=$(printf '%s' 'https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=-1&strPrevDate=20261025&strScrip=500288&strSearch=P&strToDate=20261101&strType=C&subcategory=-1' | jq -sRr @uri)"
```

`200` means BSE answers through the relay. `403` means BSE also blocks Cloudflare's address; try another host (a small VPS in
another provider, or run the BSE-only stocks from the GitHub Actions backup).

## 3. Point the scanner at it (on the server, in the repo folder)

```bash
read -rsp "BSE_PROXY_TOKEN: " v; echo; printf 'BSE_PROXY_TOKEN=%s\n' "$v" >> .env.local; unset v
```

```bash
printf 'BSE_PROXY_URL=%s\n' "https://<worker-url>" >> .env.local
```

```bash
pm2 restart <pm2-name> --update-env
```

Unset (delete the two lines and restart) to go back to direct calls. Nothing else changes: the same BSE endpoint, the same rows.
