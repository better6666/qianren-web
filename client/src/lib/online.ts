/** 前任在线连接：浏览器仅访问网站自定义域名下的 API，不持有模型服务密钥。 */
export const LEGACY_WORKER_URL = "https://qianren-api.2333333434.workers.dev";
export const DEFAULT_WORKER_URL = "https://better456.dpdns.org/api";

export type WorkerHealth = { service: string; status: string; aiConfigured: boolean };

function normalizedWorkerUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export async function checkWorkerHealth(workerUrl: string): Promise<WorkerHealth> {
  const response = await fetch(`${normalizedWorkerUrl(workerUrl)}/health`, { method: "GET" });
  if (!response.ok) throw new Error("Worker 暂不可用");
  return response.json() as Promise<WorkerHealth>;
}

export async function requestOnlineChat(workerUrl: string, system: string, messages: Array<{ role: "user" | "assistant"; content: string }>) {
  const response = await fetch(`${normalizedWorkerUrl(workerUrl)}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || "在线模型暂不可用，已保留原对话。\n");
  if (typeof payload?.message !== "string") throw new Error("Worker 返回了无效回复。");
  return payload.message as string;
}
