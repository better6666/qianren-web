/** 前任在线代理：网站使用自定义域名，聊天记录不在服务端保存，模型密钥不会进入浏览器。 */
const CUSTOM_HOST = "better456.dpdns.org";
const SITE_ORIGIN = "https://better6666.github.io/qianren-web";
const ALLOWED_ORIGINS = new Set([
  "https://better456.dpdns.org",
  "https://better6666.github.io",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
]);

function corsHeaders(origin) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://better456.dpdns.org";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function parseMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  const safe = value.map((message) => ({
    role: message?.role === "assistant" ? "assistant" : "user",
    content: typeof message?.content === "string" ? message.content.trim().slice(0, 4000) : "",
  })).filter((message) => message.content);
  return safe.length ? safe : null;
}

async function proxySite(request, url) {
  const pathname = url.pathname === "/" ? "/" : url.pathname;
  const upstream = new URL(`${SITE_ORIGIN}${pathname}${url.search}`);
  const upstreamRequest = new Request(upstream, request);
  const response = await fetch(upstreamRequest);
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);
    const isCustomHost = url.hostname === CUSTOM_HOST;
    const apiPath = isCustomHost && url.pathname.startsWith("/api/") ? url.pathname.slice(4) : url.pathname;

    if (isCustomHost && (request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/")) {
      return proxySite(request, url);
    }

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "origin_not_allowed" }, 403, origin);

    if (request.method === "GET" && apiPath === "/health") {
      return json({ service: "qianren-api", status: "ok", aiConfigured: Boolean(env.OPENAI_API_KEY) }, 200, origin);
    }

    if (request.method !== "POST" || apiPath !== "/v1/chat") return json({ error: "not_found" }, 404, origin);
    if (!env.OPENAI_API_KEY) return json({ error: "ai_not_configured", message: "在线模型尚未配置；请继续使用离线语料模式。" }, 503, origin);
    if (!request.headers.get("Content-Type")?.includes("application/json")) return json({ error: "invalid_content_type" }, 415, origin);

    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400, origin); }
    const messages = parseMessages(body?.messages);
    if (!messages) return json({ error: "invalid_messages" }, 400, origin);
    const system = typeof body?.system === "string" ? body.system.trim().slice(0, 10000) : "";
    const endpoint = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "") + "/chat/completions";
    const upstreamMessages = system ? [{ role: "system", content: system }, ...messages] : messages;

    try {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: env.OPENAI_MODEL || "gpt-4o-mini", messages: upstreamMessages, temperature: 0.8, stream: false }),
      });
      const payload = await upstream.json();
      if (!upstream.ok) return json({ error: "upstream_error", message: payload?.error?.message || "模型服务暂不可用。" }, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, origin);
      const message = payload?.choices?.[0]?.message?.content;
      if (typeof message !== "string" || !message.trim()) return json({ error: "invalid_upstream_response" }, 502, origin);
      return json({ message: message.trim(), mode: "online" }, 200, origin);
    } catch {
      return json({ error: "upstream_unreachable", message: "无法连接模型服务；已保护本地档案不被写入。" }, 502, origin);
    }
  },
};
