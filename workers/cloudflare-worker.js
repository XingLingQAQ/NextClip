/**
 * Cloudflare Worker entry:
 * - Serves static SPA assets from `dist/public` via ASSETS binding
 * - Proxies `/api/*` and `/socket.io/*` to an origin app
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isApi = url.pathname.startsWith("/api/");
    const isSocket = url.pathname.startsWith("/socket.io/");

    if (isApi || isSocket) {
      if (!env.ORIGIN_BASE_URL) {
        return new Response("Missing ORIGIN_BASE_URL", { status: 500 });
      }

      const originUrl = new URL(env.ORIGIN_BASE_URL);
      originUrl.pathname = url.pathname;
      originUrl.search = url.search;

      const proxiedRequest = new Request(originUrl.toString(), request);
      return fetch(proxiedRequest);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) {
      return assetResponse;
    }

    // SPA fallback
    const spaUrl = new URL("/index.html", url.origin);
    return env.ASSETS.fetch(new Request(spaUrl.toString(), request));
  },
};
