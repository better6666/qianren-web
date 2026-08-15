/** 余温档案室：用户自带模型以“连接凭据卡”呈现，密钥与测速结果均停留在浏览器端。 */
import { Gauge, KeyRound, Link2, Radio, ShieldCheck } from "lucide-react";
import type { ApiProbe, ApiProvider, ConnectionMode, UserApiConfig } from "@/lib/user-ai";

type Props = {
  config: UserApiConfig;
  probe: ApiProbe | null;
  testing: boolean;
  onChange: (patch: Partial<UserApiConfig>) => void;
  onProvider: (provider: ApiProvider) => void;
  onTest: () => void;
};

export default function UserApiPanel({ config, probe, testing, onChange, onProvider, onTest }: Props) {
  return <div className="user-api-panel"><div className="api-panel-heading"><div><span className="panel-index">A-09</span><h3>用户自带 AI</h3><p>密钥默认只在当前页面使用；保存到本机需由你主动开启。</p></div><span className="api-local-stamp"><ShieldCheck size={14} /> LOCAL KEY</span></div><div className="api-mode-row"><button className={config.connectionMode === "direct" ? "is-active" : ""} onClick={() => onChange({ connectionMode: "direct" })}><Radio size={15} /> 服务商直连</button><button className={config.connectionMode === "relay" ? "is-active" : ""} onClick={() => onChange({ connectionMode: "relay", provider: "custom" })}><Link2 size={15} /> 自定义中转站</button></div><div className="api-fields"><label>接口协议<select value={config.provider} onChange={(event) => onProvider(event.target.value as ApiProvider)}><option value="openai">OpenAI / 兼容接口</option><option value="anthropic">Anthropic Messages</option><option value="gemini">Google Gemini</option><option value="custom">自定义 OpenAI 兼容中转</option></select></label><label>模型名<input value={config.model} onChange={(event) => onChange({ model: event.target.value })} placeholder="模型标识" /></label><label className="api-wide">Base URL<input value={config.baseUrl} onChange={(event) => onChange({ baseUrl: event.target.value })} placeholder="https://…/v1" /></label><label className="api-wide">API Key<input value={config.apiKey} onChange={(event) => onChange({ apiKey: event.target.value })} type="password" autoComplete="off" placeholder="仅用于本次浏览器会话" /></label></div><div className="api-action-row"><label className="remember-key"><input type="checkbox" checked={config.rememberKey} onChange={(event) => onChange({ rememberKey: event.target.checked })} /> 仅在此浏览器保存此 Key</label><label className="enable-api"><input type="checkbox" checked={config.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} /> 对话使用我的 API</label><button className="outline-button api-test-button" onClick={onTest} disabled={testing}><Gauge size={16} /> {testing ? "测试中…" : "连通 / 测速"}</button></div>{probe && <div className={`api-probe ${probe.ok ? "is-ok" : "is-failed"}`}><KeyRound size={15} /><span>{probe.ok ? `${probe.message} · ${probe.latencyMs} ms` : `未连通 · ${probe.latencyMs} ms · ${probe.message}`}</span></div>}<p className="api-footnote">测试请求访问服务商模型列表，通常不生成内容；部分服务商会因 CORS 禁止浏览器直连。中转站应采用你信任、明确支持浏览器调用的地址。</p></div>;
}
