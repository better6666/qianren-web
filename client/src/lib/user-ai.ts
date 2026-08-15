/** 用户自带模型连接：密钥默认仅驻留当前页面；支持 OpenAI 兼容、Anthropic、Gemini 与自定义中转站。 */
export type ApiProvider = "openai" | "anthropic" | "gemini" | "custom";
export type ConnectionMode = "direct" | "relay";

export type UserApiConfig = {
  enabled: boolean;
  provider: ApiProvider;
  connectionMode: ConnectionMode;
  baseUrl: string;
  model: string;
  apiKey: string;
  rememberKey: boolean;
};

export type ApiProbe = { ok: boolean; latencyMs: number; message: string; checkedAt: number };

const STORAGE_KEY = "qianren-user-api-v1";

const defaults: Record<ApiProvider, Pick<UserApiConfig, "baseUrl" | "model">> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-haiku-latest" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.0-flash" },
  custom: { baseUrl: "https://your-relay.example.com/v1", model: "your-model" },
};

export function defaultUserApiConfig(): UserApiConfig {
  return { enabled: false, provider: "openai", connectionMode: "direct", ...defaults.openai, apiKey: "", rememberKey: false };
}

export function loadUserApiConfig(): UserApiConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<UserApiConfig>;
    const provider = saved.provider && defaults[saved.provider] ? saved.provider : "openai";
    return { ...defaultUserApiConfig(), ...defaults[provider], ...saved, provider, apiKey: saved.rememberKey ? saved.apiKey || "" : "" };
  } catch {
    return defaultUserApiConfig();
  }
}

export function saveUserApiConfig(config: UserApiConfig) {
  const serializable = { ...config, apiKey: config.rememberKey ? config.apiKey : "" };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

export function presetFor(provider: ApiProvider) {
  return defaults[provider];
}

function root(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function headers(config: UserApiConfig): Record<string, string> {
  if (config.provider === "anthropic") return { "content-type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" };
  return { "content-type": "application/json", Authorization: `Bearer ${config.apiKey}` };
}

async function readFailure(response: Response) {
  const text = await response.text().catch(() => "");
  try { return JSON.parse(text)?.error?.message || JSON.parse(text)?.message || text; } catch { return text; }
}

export async function probeUserApi(config: UserApiConfig): Promise<ApiProbe> {
  if (!config.baseUrl.trim() || !config.apiKey.trim()) throw new Error("请先填写 Base URL 与 API Key。");
  const startedAt = performance.now();
  let url = "";
  let init: RequestInit = { method: "GET", headers: headers(config) };
  if (config.provider === "gemini") {
    url = `${root(config.baseUrl)}/models?key=${encodeURIComponent(config.apiKey)}`;
    init = { method: "GET" };
  } else {
    url = `${root(config.baseUrl)}/models`;
  }
  try {
    const response = await fetch(url, init);
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!response.ok) throw new Error((await readFailure(response)) || `HTTP ${response.status}`);
    return { ok: true, latencyMs, message: `连通 · HTTP ${response.status}`, checkedAt: Date.now() };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const message = error instanceof Error ? error.message : "未知连接错误";
    const cors = /failed to fetch|networkerror|cors/i.test(message) ? "浏览器被目标服务的 CORS 策略拦截；可改用支持浏览器直连的中转站。" : message;
    return { ok: false, latencyMs, message: cors, checkedAt: Date.now() };
  }
}

export async function requestUserApiChat(config: UserApiConfig, system: string, messages: Array<{ role: "user" | "assistant"; content: string }>) {
  if (!config.apiKey.trim()) throw new Error("请在“用户自带 AI”中填写 API Key。");
  const requestMessages = [{ role: "system", content: system }, ...messages];
  let response: Response;
  if (config.provider === "anthropic") {
    response = await fetch(`${root(config.baseUrl)}/messages`, { method: "POST", headers: headers(config), body: JSON.stringify({ model: config.model, max_tokens: 420, system, messages }) });
    if (!response.ok) throw new Error((await readFailure(response)) || "Anthropic 接口请求失败。");
    const payload = await response.json();
    const text = payload?.content?.find((item: { type?: string }) => item.type === "text")?.text;
    if (typeof text !== "string") throw new Error("Anthropic 返回了无效回复。");
    return text;
  }
  if (config.provider === "gemini") {
    response = await fetch(`${root(config.baseUrl)}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })) }) });
    if (!response.ok) throw new Error((await readFailure(response)) || "Gemini 接口请求失败。");
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new Error("Gemini 返回了无效回复。");
    return text;
  }
  response = await fetch(`${root(config.baseUrl)}/chat/completions`, { method: "POST", headers: headers(config), body: JSON.stringify({ model: config.model, messages: requestMessages, temperature: 0.7 }) });
  if (!response.ok) throw new Error((await readFailure(response)) || "OpenAI 兼容接口请求失败。");
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("模型返回了无效回复。");
  return text;
}
