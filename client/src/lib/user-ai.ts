export type ApiProvider = "openai" | "anthropic" | "gemini" | "grok" | "minimax" | "zhipu" | "qwen" | "doubao" | "deepseek" | "baichuan" | "01ai" | "moonshot" | "custom";
export type ConnectionMode = "direct" | "relay";
export type ApiModel = { id: string; ownedBy?: string };

export type UserApiConfig = {
  enabled: boolean;
  provider: ApiProvider;
  connectionMode: ConnectionMode;
  baseUrl: string;
  model: string;
  apiKey: string;
  rememberKey: boolean;
  availableModels: ApiModel[];
  selectedModels: string[];
};

export type ApiProbe = { ok: boolean; latencyMs: number; message: string; checkedAt: number };
const STORAGE_KEY = "qianren-user-api-v2";

const defaults: Record<ApiProvider, Pick<UserApiConfig, "baseUrl" | "model">> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-haiku-latest" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash" },
  grok: { baseUrl: "https://api.x.ai/v1", model: "grok-3-mini" },
  minimax: { baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-Text-01" },
  zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.5" },
  qwen: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  doubao: { baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-1-6-250615" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  baichuan: { baseUrl: "https://api.baichuan-ai.com/v1", model: "Baichuan4" },
  "01ai": { baseUrl: "https://api.lingyiwanwu.com/v1", model: "yi-lightning" },
  moonshot: { baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2" },
  custom: { baseUrl: "", model: "" },
};

export function defaultUserApiConfig(): UserApiConfig {
  return { enabled: false, provider: "openai", connectionMode: "direct", ...defaults.openai, apiKey: "", rememberKey: false, availableModels: [], selectedModels: [] };
}

export function loadUserApiConfig(): UserApiConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem("qianren-user-api-v1") || "{}") as Partial<UserApiConfig>;
    const provider = saved.provider && defaults[saved.provider] ? saved.provider : "openai";
    return { ...defaultUserApiConfig(), ...defaults[provider], ...saved, provider, availableModels: saved.availableModels || [], selectedModels: saved.selectedModels || [], apiKey: saved.rememberKey ? saved.apiKey || "" : "" };
  } catch { return defaultUserApiConfig(); }
}

export function saveUserApiConfig(config: UserApiConfig) {
  const serializable = { ...config, apiKey: config.rememberKey ? config.apiKey : "" };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

export function presetFor(provider: ApiProvider) { return defaults[provider]; }
function root(url: string) { return url.trim().replace(/\/+$/, ""); }
function headers(config: UserApiConfig): Record<string, string> {
  if (config.provider === "anthropic") return { "content-type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" };
  return { "content-type": "application/json", Authorization: `Bearer ${config.apiKey}` };
}
async function readFailure(response: Response) { const text = await response.text().catch(() => ""); try { return JSON.parse(text)?.error?.message || JSON.parse(text)?.message || text; } catch { return text; } }

export async function fetchUserApiModels(config: UserApiConfig): Promise<{ models: ApiModel[]; latencyMs: number }> {
  if (!config.baseUrl.trim() || !config.apiKey.trim()) throw new Error("请先填写 Base URL 与 API Key。");
  const startedAt = performance.now();
  const url = config.provider === "gemini" ? `${root(config.baseUrl)}/models?key=${encodeURIComponent(config.apiKey)}` : `${root(config.baseUrl)}/models`;
  const response = await fetch(url, { method: "GET", headers: config.provider === "gemini" ? undefined : headers(config) });
  const latencyMs = Math.round(performance.now() - startedAt);
  if (!response.ok) throw new Error((await readFailure(response)) || `HTTP ${response.status}`);
  const payload = await response.json();
  const raw = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  const models = raw.map((item: { id?: string; name?: string; owned_by?: string; publisher?: string }) => ({ id: item.id || item.name?.split("/").pop() || "", ownedBy: item.owned_by || item.publisher })).filter((item: ApiModel) => item.id);
  if (!models.length) throw new Error("接口响应成功，但没有找到标准 data/models 模型列表。");
  return { models, latencyMs };
}

export async function probeUserApi(config: UserApiConfig): Promise<ApiProbe> {
  try { const result = await fetchUserApiModels(config); return { ok: true, latencyMs: result.latencyMs, message: `连通 · HTTP 200 · 发现 ${result.models.length} 个模型`, checkedAt: Date.now() }; }
  catch (error) { const message = error instanceof Error ? error.message : "未知连接错误"; const cors = /failed to fetch|networkerror|cors/i.test(message) ? "浏览器被目标服务的 CORS 策略拦截；可改用支持浏览器直连的中转站。" : message; return { ok: false, latencyMs: 0, message: cors, checkedAt: Date.now() }; }
}

export async function requestUserApiChat(config: UserApiConfig, system: string, messages: Array<{ role: "user" | "assistant"; content: string }>) {
  if (!config.apiKey.trim()) throw new Error("请在“用户自带 AI”中填写 API Key。");
  const requestMessages = [{ role: "system", content: system }, ...messages];
  let response: Response;
  if (config.provider === "anthropic") {
    response = await fetch(`${root(config.baseUrl)}/messages`, { method: "POST", headers: headers(config), body: JSON.stringify({ model: config.model, max_tokens: 420, system, messages }) });
    if (!response.ok) throw new Error((await readFailure(response)) || "Anthropic 接口请求失败。"); const payload = await response.json(); const text = payload?.content?.find((item: { type?: string }) => item.type === "text")?.text; if (typeof text !== "string") throw new Error("Anthropic 返回了无效回复。"); return text;
  }
  if (config.provider === "gemini") {
    response = await fetch(`${root(config.baseUrl)}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })) }) });
    if (!response.ok) throw new Error((await readFailure(response)) || "Gemini 接口请求失败。"); const payload = await response.json(); const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text; if (typeof text !== "string") throw new Error("Gemini 返回了无效回复。"); return text;
  }
  response = await fetch(`${root(config.baseUrl)}/chat/completions`, { method: "POST", headers: headers(config), body: JSON.stringify({ model: config.model, messages: requestMessages, temperature: 0.7 }) });
  if (!response.ok) throw new Error((await readFailure(response)) || "OpenAI 兼容接口请求失败。"); const payload = await response.json(); const text = payload?.choices?.[0]?.message?.content; if (typeof text !== "string") throw new Error("模型返回了无效回复。"); return text;
}
