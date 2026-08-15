/** 余温档案室：左侧索引脊、右侧流动纸页，以本地优先的聊天记录整理为核心。 */
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, BookOpenText, BrainCircuit, ChevronLeft, ChevronRight, ClipboardCopy, CloudOff,
  Database, Download, FileText, FolderOpen, LockKeyhole, MessageCircleMore, Paperclip,
  Plus, SendHorizontal, Settings2, ShieldCheck, Sparkles, Trash2, Upload, UserRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  ArchiveState, ChatSession, CorpusMessage, SpeakerRole, createPersona, createStyleSnapshot,
  createIntegratedPortrait, downloadFile, emptyArchive, loadArchive, localMimic, mergeMessages, messagesForRole,
  parseChatText, personaName, roleOf, sampleCorpus, saveArchive, speakersFor, uid,
} from "@/lib/archive";
import { decryptArchive, encryptArchive, isEncryptedArchive } from "@/lib/crypto";
import { DEFAULT_WORKER_URL, WorkerHealth, checkWorkerHealth, requestOnlineChat } from "@/lib/online";

type Screen = "chat" | "corpus" | "persona" | "insights" | "portrait" | "settings";

const logoUrl = "./images/qianren-logo.png";
const heroUrl = "./images/qianren-archive-hero.jpg";
const importArtUrl = "./images/qianren-import-archive.jpg";
const insightArtUrl = "./images/qianren-insight-weather.jpg";

const screenMeta: Record<Screen, { chapter: string; title: string; description: string; icon: typeof MessageCircleMore }> = {
  chat: { chapter: "01 · 会话档案", title: "对话不是召回，是整理。", description: "以本地语料中的表达节奏，生成克制的离线复刻。", icon: MessageCircleMore },
  corpus: { chapter: "02 · 语料册", title: "从一段记录开始整理。", description: "粘贴或导入 TXT，在浏览器本地完成解析与角色分配。", icon: FolderOpen },
  persona: { chapter: "03 · 语言画像", title: "把习惯，变成可读的线索。", description: "由语料中的长度、时段和高频片段自动生成。", icon: BrainCircuit },
  insights: { chapter: "04 · 关系边注", title: "只描述模式，不替你下结论。", description: "查看双方消息量、活跃时段与语言痕迹。", icon: BookOpenText },
  portrait: { chapter: "05 · 共同画像", title: "把线索编成一份可回看的档案。", description: "真实语料、确认补充与自愿资料共同组成画像。", icon: Sparkles },
  settings: { chapter: "06 · 本地设置", title: "数据留在此处。", description: "网页版本使用浏览器本地存储，不上传聊天内容。", icon: Settings2 },
};

function makeSession(): ChatSession {
  return { id: uid("session"), name: "新对话", createdAt: Date.now(), messages: [] };
}

function roleLabel(role: SpeakerRole) {
  return role === "me" ? "我" : role === "ta" ? "TA" : "忽略";
}

function countForSpeaker(messages: CorpusMessage[], speaker: string) {
  return messages.filter((item) => item.speaker === speaker).length;
}

export default function Home() {
  const [archive, setArchive] = useState<ArchiveState>(() => loadArchive());
  const [screen, setScreen] = useState<Screen>("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState("");
  const [importText, setImportText] = useState("");
  const [search, setSearch] = useState("");
  const [workerUrl, setWorkerUrl] = useState(() => localStorage.getItem("qianren-worker-url") || DEFAULT_WORKER_URL);
  const [onlineMode, setOnlineMode] = useState(() => localStorage.getItem("qianren-online-mode") === "true");
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth | null>(null);
  const [testingWorker, setTestingWorker] = useState(false);
  const [sending, setSending] = useState(false);
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [learningSnippet, setLearningSnippet] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);

  useEffect(() => saveArchive(archive), [archive]);
  useEffect(() => localStorage.setItem("qianren-worker-url", workerUrl), [workerUrl]);
  useEffect(() => localStorage.setItem("qianren-online-mode", String(onlineMode)), [onlineMode]);

  const snapshot = useMemo(() => createStyleSnapshot(archive.messages, archive.roles), [archive.messages, archive.roles]);
  const currentPersona = useMemo(() => createPersona(archive.messages, archive.roles), [archive.messages, archive.roles]);
  const persona = personaName(archive.messages, archive.roles);
  const speakers = useMemo(() => speakersFor(archive.messages), [archive.messages]);
  const preview = useMemo(() => parseChatText(importText), [importText]);
  const activeSession = archive.sessions.find((item) => item.id === archive.activeSessionId) ?? archive.sessions[0] ?? null;
  const integratedPortrait = useMemo(() => createIntegratedPortrait(archive), [archive]);
  const currentMeta = screenMeta[screen];

  const setArchiveSafely = (updater: (previous: ArchiveState) => ArchiveState) => setArchive((previous) => updater(previous));

  const importRecords = (raw: string) => {
    const incoming = parseChatText(raw);
    if (!incoming.length) {
      toast.error("没有识别到记录", { description: "请使用 [09:30] 名称: 内容，或 名称: 内容 的格式。" });
      return;
    }
    setArchiveSafely((previous) => {
      const merged = mergeMessages(previous.messages, incoming);
      toast.success(`已归档 ${merged.added} 条记录`, { description: merged.duplicate ? `另有 ${merged.duplicate} 条重复记录未写入。` : "所有处理均在当前浏览器完成。" });
      return { ...previous, messages: merged.all };
    });
    setImportText("");
  };

  const handleTextFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importRecords(String(reader.result ?? ""));
    reader.readAsText(file);
    event.target.value = "";
  };

  const setRole = (speaker: string, role: SpeakerRole) => {
    setArchiveSafely((previous) => ({ ...previous, roles: { ...previous.roles, [speaker]: role } }));
  };

  const updateProfile = (key: keyof ArchiveState["profile"], value: string) => {
    setArchiveSafely((previous) => ({ ...previous, profile: { ...previous.profile, [key]: value } }));
  };

  const confirmLearning = () => {
    const text = learningSnippet.trim();
    if (text.length < 2) {
      toast.error("请补充一条真实表达", { description: "只有你确认来自真实聊天的内容才会进入学习档。" });
      return;
    }
    setArchiveSafely((previous) => {
      const speaker = previous.profile.targetName.trim() || personaName(previous.messages, previous.roles);
      const sample: CorpusMessage = { id: uid("confirmed"), speaker, text, date: "手动确认", time: "" };
      return {
        ...previous,
        messages: [...previous.messages, sample],
        roles: { ...previous.roles, [speaker]: "ta" },
        profile: { ...previous.profile, confirmedSamples: [...previous.profile.confirmedSamples, text].slice(-60) },
      };
    });
    setLearningSnippet("");
    toast.success("已加入确认学习档", { description: "这条真实表达会参与后续本地复刻与综合报告。" });
  };

  const createConversation = () => {
    const session = makeSession();
    setArchiveSafely((previous) => ({ ...previous, sessions: [session, ...previous.sessions], activeSessionId: session.id }));
    setScreen("chat");
  };

  const testWorker = async () => {
    setTestingWorker(true);
    try {
      const health = await checkWorkerHealth(workerUrl);
      setWorkerHealth(health);
      toast.success(health.aiConfigured ? "在线代理已连接" : "Worker 已连接，模型密钥尚未配置", { description: health.aiConfigured ? "可以启用在线模式。" : "离线模式仍可正常使用。" });
    } catch (error) {
      setWorkerHealth(null);
      toast.error(error instanceof Error ? error.message : "无法连接 Worker");
    } finally {
      setTestingWorker(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    if (!snapshot.taCount) {
      toast.error("还没有 TA 的语料", { description: "请先在语料册里导入记录并指定角色。" });
      setScreen("corpus");
      return;
    }
    let session = activeSession;
    if (!session) {
      session = makeSession();
      setArchiveSafely((previous) => ({ ...previous, sessions: [session!, ...previous.sessions], activeSessionId: session!.id }));
    }
    const outgoing = { id: uid("chat"), sender: "me" as const, text, createdAt: Date.now() };
    const targetId = session.id;
    const history = [...session.messages, outgoing].slice(-12).map((message) => ({ role: message.sender === "ta" ? "assistant" as const : "user" as const, content: message.text }));
    setSending(true);
    let response: string;
    try {
      response = onlineMode ? await requestOnlineChat(workerUrl, currentPersona, history) : localMimic(text, archive.messages, archive.roles);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "在线回复失败", { description: "已保留本地档案；可切换回离线模式。" });
      setSending(false);
      return;
    }
    const incoming = { id: uid("chat"), sender: "ta" as const, text: response, createdAt: Date.now() + 1 };
    setArchiveSafely((previous) => ({
      ...previous,
      activeSessionId: targetId,
      sessions: previous.sessions.map((item) => item.id === targetId
        ? { ...item, name: item.messages.length ? item.name : text.slice(0, 12), messages: [...item.messages, outgoing, incoming] }
        : item),
    }));
    setDraft("");
    setSending(false);
  };

  const copyPersona = async () => {
    try {
      await navigator.clipboard.writeText(currentPersona);
      toast.success("画像已复制到剪贴板");
    } catch {
      downloadFile("前任-语言画像.md", currentPersona, "text/markdown;charset=utf-8");
      toast.success("浏览器限制复制，已改为下载文件");
    }
  };

  const exportArchive = () => {
    downloadFile("前任-浏览器档案.json", JSON.stringify(archive, null, 2), "application/json;charset=utf-8");
    toast.success("本地档案已导出");
  };

  const exportEncryptedArchive = async () => {
    try {
      const encrypted = await encryptArchive(archive, backupPassphrase);
      downloadFile("前任-加密档案.json", encrypted, "application/json;charset=utf-8");
      setBackupPassphrase("");
      toast.success("加密档案已导出", { description: "请单独保管口令；网页无法找回口令。" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法创建加密档案");
    }
  };

  const restoreArchive = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const restored = isEncryptedArchive(parsed) ? await decryptArchive(parsed, backupPassphrase) : parsed as ArchiveState;
      if (!restored || !Array.isArray(restored.messages) || !Array.isArray(restored.sessions)) throw new Error("invalid");
        setArchive({ ...emptyArchive(), messages: restored.messages, roles: restored.roles ?? {}, sessions: restored.sessions, activeSessionId: restored.activeSessionId ?? null, profile: restored.profile ?? emptyArchive().profile });
      setBackupPassphrase("");
      toast.success(isEncryptedArchive(parsed) ? "加密档案已恢复" : "本地档案已恢复");
    } catch (error) {
      toast.error(error instanceof Error && error.message !== "invalid" ? error.message : "无法读取备份文件", { description: "请选择本网页版导出的 JSON 档案，并在加密文件时输入对应口令。" });
    }
  };

  const navItems = (Object.keys(screenMeta) as Screen[]).map((key) => ({ key, ...screenMeta[key] }));
  const filteredSessions = archive.sessions.filter((item) => item.name.includes(search));

  return (
    <div className={`archive-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="archive-sidebar" aria-label="档案导航">
        <div className="brand-lockup">
          <img src={logoUrl} alt="前任档案标志" className="brand-mark" />
          <div className="brand-copy"><span>前任</span><small>ARCHIVE / LOCAL · CASE 01</small></div>
          <button className="icon-button sidebar-toggle" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "展开侧栏" : "收起侧栏"}>{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
        </div>

        <div className="sidebar-section nav-section">
          <p className="section-kicker">索引</p>
          {navItems.map(({ key, chapter, icon: Icon }) => (
            <button key={key} className={`nav-item ${screen === key ? "is-active" : ""}`} onClick={() => setScreen(key)}>
              <Icon size={17} strokeWidth={1.8} /><span>{chapter}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-section sessions-section">
          <div className="section-heading"><p className="section-kicker">会话夹</p><button className="micro-action" onClick={createConversation} aria-label="新建会话"><Plus size={15} /></button></div>
          {!collapsed && <input className="session-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="查找会话" aria-label="查找会话" />}
          <div className="session-list">
            {filteredSessions.slice(0, 6).map((item) => (
              <button key={item.id} onClick={() => { setArchiveSafely((previous) => ({ ...previous, activeSessionId: item.id })); setScreen("chat"); }} className={`session-item ${activeSession?.id === item.id && screen === "chat" ? "is-current" : ""}`}>
                <span className="session-dot" /><span>{item.name || "未命名会话"}</span>
              </button>
            ))}
            {!archive.sessions.length && <p className="quiet-copy">尚无会话</p>}
          </div>
        </div>

        <div className="local-status"><CloudOff size={15} /><span><b>仅此浏览器</b><small>LOCAL ONLY · {archive.messages.length} 条记录</small></span></div>
      </aside>

      <main className="archive-main">
        <header className="page-header">
          <div><p className="chapter-label">{currentMeta.chapter}</p><h1>{currentMeta.title}</h1><p className="page-description">{currentMeta.description}</p></div>
          <div className="header-actions"><span className="privacy-chip"><LockKeyhole size={14} /> 本地处理</span>{screen !== "corpus" && <button className="primary-button compact" onClick={() => setScreen("corpus")}><Upload size={16} /> 归档记录</button>}<span className="folio-stamp">PRIVATE COPY<br/>LOCAL / 01</span></div>
        </header>

        {screen === "chat" && (
          <section className="chat-layout">
            <div className="paper-panel chat-paper">
              <div className="panel-heading"><div><span className="panel-index">C-01</span><h2>{activeSession?.name || "还没有开始会话"}</h2></div><span className="source-note">离线复刻</span></div>
              {activeSession?.messages.length ? (
                <div className="message-thread">
                  {activeSession.messages.map((message) => <div key={message.id} className={`message-row ${message.sender === "me" ? "from-me" : "from-ta"}`}><span className="message-author">{message.sender === "me" ? "我" : persona}</span><p>{message.text}</p></div>)}
                </div>
              ) : (
                <div className="chat-empty"><div className="hero-paper"><img src={heroUrl} alt="档案纸张与索引卡" /><div className="archive-artifacts" aria-hidden="true"><span className="source-slip slip-a">SOURCE<br/>FRAGMENT</span><span className="source-slip slip-b">归档中</span><i /></div><div className="hero-overlay"><span>LOCAL REPLICA · NOT A PERSON</span><p>记录里的语言习惯，会留下一些线索。</p></div></div><p>先归档记录，再开始一段本地离线对话。</p></div>
              )}
              <div className="composer"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={snapshot.taCount ? `对 ${persona} 说点什么…` : "请先导入并分配语料"} rows={2} /><button className="send-button" onClick={() => void send()} aria-label="发送" disabled={sending}>{sending ? <span className="send-loading" /> : <SendHorizontal size={18} />}</button></div>
              <p className="composer-note">Enter 发送 · {onlineMode ? "由 Cloudflare Worker 代理在线模型；密钥不进入浏览器。" : "本地检索原始语料表达，不调用模型服务。"}</p>
            </div>
            <aside className="margin-rail">
              <div className="rail-card identity-card"><span className="rail-label">当前复刻</span><div className="persona-token"><span>{persona.slice(0, 1)}</span><div><b>{persona}</b><small>由 {snapshot.taCount} 条 TA 语料整理</small></div></div><div className="identity-rule" /><p>不是本人，也不替代现实沟通。</p></div>
              <div className="rail-card"><span className="rail-label">语言线索</span><dl><div><dt>平均长度</dt><dd>{snapshot.averageLength ? `${snapshot.averageLength.toFixed(1)} 字` : "—"}</dd></div><div><dt>短句比例</dt><dd>{snapshot.taCount ? `${Math.round(snapshot.shortRate * 100)}%` : "—"}</dd></div><div><dt>常出现</dt><dd>{snapshot.taCount ? `${String(snapshot.peakHour).padStart(2, "0")}:00` : "—"}</dd></div></dl></div>
              <button className="outline-button rail-action" onClick={() => setScreen("persona")}><Sparkles size={16} /> 查看语言画像</button>
            </aside>
          </section>
        )}

        {screen === "corpus" && (
          <section className="corpus-layout">
            <div className="paper-panel import-panel"><div className="panel-heading"><div><span className="panel-index">I-02</span><h2>导入聊天记录</h2></div><span className="source-note">TXT / 粘贴</span></div><div className="import-workspace"><textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={`支持以下格式：\n[08:43] 我: 想你了\n[08:47] 小雨: 嘴真甜\n\n也可以使用「名称: 内容」逐行粘贴。`} rows={12} /><div className="import-actions"><button className="primary-button" onClick={() => importRecords(importText)} disabled={!importText.trim()}><Archive size={17} /> 归档 {preview.length ? `${preview.length} 条预览` : "记录"}</button><button className="outline-button" onClick={() => importInput.current?.click()}><Paperclip size={17} /> 导入 TXT</button><button className="text-button" onClick={() => setImportText(sampleCorpus)}>载入虚构示例</button><input ref={importInput} onChange={handleTextFile} type="file" accept=".txt,text/plain" hidden /></div></div><div className="import-footnote"><ShieldCheck size={15} /> 解析发生在当前浏览器。网页静态版不读取截图，也不会上传语料。</div></div>
            <aside className="import-aside"><img src={importArtUrl} alt="整理中的语料纸页" /><div><span className="rail-label">已归档</span><b>{archive.messages.length} 条</b><p>{speakers.length || 0} 位说话人 · {snapshot.activeDays || 0} 个日期</p></div></aside>
            <div className="paper-panel role-panel"><div className="panel-heading"><div><span className="panel-index">R-03</span><h2>这个人是谁？</h2></div><span className="source-note">角色随时可改</span></div>{speakers.length ? <div className="speaker-table">{speakers.map((speaker, index) => { const currentRole = roleOf(speaker, archive.roles); return <div className="speaker-row" key={speaker}><span className="speaker-number">{String(index + 1).padStart(2, "0")}</span><div className="speaker-name"><b>{speaker}</b><small>{countForSpeaker(archive.messages, speaker)} 条记录</small></div><div className="role-options">{(["me", "ta", "ignore"] as SpeakerRole[]).map((role) => <button key={role} className={currentRole === role ? "selected" : ""} onClick={() => setRole(speaker, role)}>{roleLabel(role)}</button>)}</div></div>; })}</div> : <div className="empty-inline"><UserRound size={20} /><p>导入语料后，在这里指定“我”和“TA”。</p></div>}</div>
          </section>
        )}

        {screen === "persona" && (
          <section className="persona-layout"><div className="stat-strip"><div><span>全部记录</span><b>{snapshot.total}</b></div><div><span>TA 的语料</span><b>{snapshot.taCount}</b></div><div><span>短句比例</span><b>{snapshot.taCount ? `${Math.round(snapshot.shortRate * 100)}%` : "—"}</b></div><div><span>最常出现</span><b>{snapshot.taCount ? `${String(snapshot.peakHour).padStart(2, "0")}:00` : "—"}</b></div></div><div className="paper-panel persona-document"><div className="panel-heading"><div><span className="panel-index">P-04</span><h2>{persona} 的语言画像</h2></div><div className="document-actions"><button className="micro-action labelled" onClick={copyPersona}><ClipboardCopy size={15} /> 复制</button><button className="micro-action labelled" onClick={() => downloadFile("前任-语言画像.md", currentPersona, "text/markdown;charset=utf-8")}><Download size={15} /> 导出</button></div></div><pre>{currentPersona}</pre></div><aside className="phrase-aside"><img src={insightArtUrl} alt="关系节奏的抽象线条" /><div className="rail-card"><span className="rail-label">高频片段</span>{snapshot.phrases.length ? <div className="phrase-list">{snapshot.phrases.map((phrase) => <span key={phrase.text}>{phrase.text}<small>{phrase.count}</small></span>)}</div> : <p>语料累积后，这里会出现重复表达。</p>}</div></aside></section>
        )}

        {screen === "insights" && (
          <section className="insights-layout"><div className="paper-panel insight-paper"><div className="panel-heading"><div><span className="panel-index">N-05</span><h2>关系边注</h2></div><span className="source-note">描述性统计</span></div><div className="insight-summary"><div><span>TA / 我</span><b>{snapshot.taCount} <i>/</i> {snapshot.meCount}</b><p>已纳入角色分配的消息数</p></div><div><span>活跃日期</span><b>{snapshot.activeDays || "—"}</b><p>带可识别日期的记录</p></div><div><span>语言样本</span><b>{snapshot.phrases.length || "—"}</b><p>已提取的高频片段</p></div></div><div className="tempo-section"><div className="tempo-head"><span>TA 的活跃时段</span><small>按带时间的已归档消息汇总</small></div><div className="hour-bars">{Array.from({ length: 24 }, (_, hour) => { const height = snapshot.taCount && hour === snapshot.peakHour ? 100 : 14; return <div key={hour} className={hour === snapshot.peakHour && snapshot.taCount ? "is-peak" : ""}><span style={{ height: `${height}%` }} /><small>{hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}</small></div>; })}</div></div><div className="boundary-note"><ShieldCheck size={17} /><p><b>解读边界</b>：网页版本只显示记录中的可观察模式，不判断人格、关系价值或心理状态。</p></div></div><aside className="insight-aside"><img src={insightArtUrl} alt="沟通节奏的抽象图像" /><p>“数据能提示习惯，不能替你定义一段关系。”</p></aside></section>
        )}

        {screen === "portrait" && (
          <section className="portrait-layout"><div className="paper-panel portrait-form"><div className="panel-heading"><div><span className="panel-index">P-06</span><h2>共同画像资料卡</h2></div><span className="source-note">自愿补充 · 本地保存</span></div><div className="profile-grid"><label>TA 称呼<input value={archive.profile.targetName} onChange={(event) => updateProfile("targetName", event.target.value)} placeholder={persona === "TA" ? "例如：小雨" : persona} /></label><label>生日<input value={archive.profile.birthday} onChange={(event) => updateProfile("birthday", event.target.value)} placeholder="例如：1998-07-18（可留空）" /></label><label>星座<input value={archive.profile.zodiac} onChange={(event) => updateProfile("zodiac", event.target.value)} placeholder="例如：巨蟹座（仅作文化线索）" /></label><label>关系背景<input value={archive.profile.relationshipContext} onChange={(event) => updateProfile("relationshipContext", event.target.value)} placeholder="例如：分开后仍偶尔联系" /></label><label className="profile-wide">我的边注<textarea value={archive.profile.reflection} onChange={(event) => updateProfile("reflection", event.target.value)} placeholder="写下你希望在报告中保留的真实背景、界限或待观察的问题。" rows={3} /></label></div><div className="learning-ledger"><div><span className="rail-label">确认学习</span><h3>只加入真实且由你确认的表达</h3><p>AI 在本页生成的回复不会自动变成 TA 的新语料，避免“越学越像自己”的循环。</p></div><textarea value={learningSnippet} onChange={(event) => setLearningSnippet(event.target.value)} placeholder="粘贴一条新增的真实聊天表达，例如：‘到了和我说一声。’" rows={3} /><button className="primary-button" onClick={confirmLearning}><Archive size={16} /> 确认加入</button><small>已确认 {archive.profile.confirmedSamples.length} 条补充样本</small></div></div><div className="paper-panel integrated-portrait"><div className="panel-heading"><div><span className="panel-index">F-07</span><h2>最后的综合画像</h2></div><button className="micro-action labelled" onClick={() => downloadFile("前任-综合互动画像.md", integratedPortrait, "text/markdown;charset=utf-8")}><Download size={15} /> 导出报告</button></div><pre>{integratedPortrait}</pre></div><aside className="portrait-rail"><div className="rail-card"><span className="rail-label">证据边界</span><b>{snapshot.taCount + snapshot.meCount} 条真实记录</b><p>报告只读取本地档案与明确确认的补充样本；生成回复不回写为证据。</p></div><div className="rail-card caution-card"><span className="rail-label">关系阅读</span><p>依恋、人格和“人性”问题只以互动线索讨论，不给任何人贴诊断式标签。</p></div><button className="outline-button rail-action" onClick={() => setScreen("insights")}><BookOpenText size={16} /> 查看关系边注</button></aside></section>
        )}

        {screen === "settings" && (
          <section className="settings-layout"><div className="paper-panel settings-paper"><div className="panel-heading"><div><span className="panel-index">S-06</span><h2>浏览器本地设置</h2></div></div><div className="setting-row"><span className="setting-icon"><Database size={18} /></span><div><b>本地档案</b><p>当前数据保存于这个浏览器的 LocalStorage；清理浏览器数据会一并删除。</p></div><span className="setting-status">{archive.messages.length} 条记录</span></div><div className="setting-row worker-row"><span className="setting-icon"><LockKeyhole size={18} /></span><div><b>Cloudflare 在线代理</b><p>浏览器只请求 Worker；模型 API Key 仅保存于 Cloudflare 加密密钥。</p><input className="worker-url-input" value={workerUrl} onChange={(event) => setWorkerUrl(event.target.value)} aria-label="Cloudflare Worker 地址" /></div><div className="worker-controls"><button className="outline-button" onClick={() => void testWorker()} disabled={testingWorker}>{testingWorker ? "检查中…" : "测试连接"}</button><button className={`mode-toggle ${onlineMode ? "is-on" : ""}`} onClick={() => setOnlineMode((value) => !value)} aria-pressed={onlineMode}><span />{onlineMode ? "在线" : "离线"}</button>{workerHealth && <small className={workerHealth.aiConfigured ? "healthy" : "pending"}>{workerHealth.aiConfigured ? "模型已就绪" : "待配置模型密钥"}</small>}</div></div><div className="setting-row backup-row"><span className="setting-icon"><FileText size={18} /></span><div><b>可携带备份</b><p>普通导出为可读 JSON；加密导出使用浏览器内的 PBKDF2 与 AES-GCM，口令无法找回。</p><input className="backup-password" value={backupPassphrase} onChange={(event) => setBackupPassphrase(event.target.value)} type="password" autoComplete="new-password" placeholder="备份口令（至少 12 位）" aria-label="备份口令" /></div><div className="backup-actions"><button className="outline-button" onClick={exportArchive}><Download size={16} /> 普通导出</button><button className="outline-button encrypt-button" onClick={() => void exportEncryptedArchive()}><LockKeyhole size={16} /> 加密导出</button><button className="outline-button" onClick={() => restoreInput.current?.click()}><Upload size={16} /> 恢复</button><small className="backup-note">恢复加密档案前，请先在左侧输入对应口令。</small><input ref={restoreInput} onChange={(event) => void restoreArchive(event)} type="file" accept="application/json,.json" hidden /></div></div><div className="danger-zone"><div><b>清空当前浏览器档案</b><p>这会移除语料、角色和会话，无法从浏览器内撤销。</p></div><button className="danger-button" onClick={() => { if (window.confirm("确定清空当前浏览器中的全部前任档案吗？")) { setArchive(emptyArchive()); toast.success("当前浏览器档案已清空"); } }}><Trash2 size={16} /> 清空</button></div></div><aside className="privacy-manifesto"><span className="rail-label">隐私说明</span><h2>记录默认不离开这页。</h2><p>离线模式不请求任何服务。仅在你打开在线模式并发送消息时，才会将该次对话交给 Cloudflare Worker 转发。</p><div className="manifesto-rule" /><small>Worker 不保存消息；模型密钥不会进入浏览器或 GitHub 仓库。</small></aside></section>
        )}
      </main>
    </div>
  );
}
