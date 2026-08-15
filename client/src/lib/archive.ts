/** 余温档案室：纯浏览器本地数据、语料解析与风格复刻工具。 */
import { recognize } from "tesseract.js";

export type SpeakerRole = "me" | "ta" | "ignore";

export type CorpusKind = "message" | "system" | "image" | "sticker" | "voice" | "video" | "call" | "transfer" | "red-packet" | "file" | "location" | "link" | "uncertain";
export type InteractionEvent = { kind: CorpusKind; actor?: string; target?: string; description: string };

export type CorpusMessage = {
  id: string;
  speaker: string;
  text: string;
  date: string;
  time: string;
  /** 原始导入中的稳定行序；时间不完整时绝不据此臆测重排。 */
  sourceIndex?: number;
  kind?: CorpusKind;
  /** 互动事件会保留原始文字，并尽可能标出发起者、接收者或状态。 */
  event?: InteractionEvent;
  /** 用户主动隐藏的项目；自动解析不会删除任何事件。 */
  filterReason?: string;
  ignored?: boolean;
};

export type ChatMessage = {
  id: string;
  sender: "me" | "ta";
  text: string;
  createdAt: number;
};

export type ChatSession = {
  id: string;
  name: string;
  createdAt: number;
  messages: ChatMessage[];
};

export type PortraitProfile = {
  targetName: string;
  targetBirthday: string;
  targetZodiac: string;
  targetGender: string;
  userName: string;
  userBirthday: string;
  userZodiac: string;
  userGender: string;
  relationshipContext: string;
  reflection: string;
  confirmedSamples: string[];
};

export type ArchiveState = {
  messages: CorpusMessage[];
  roles: Record<string, SpeakerRole>;
  sessions: ChatSession[];
  activeSessionId: string | null;
  profile: PortraitProfile;
};

export type StyleSnapshot = {
  total: number;
  taCount: number;
  meCount: number;
  averageLength: number;
  shortRate: number;
  peakHour: number;
  activeDays: number;
  phrases: Array<{ text: string; count: number }>;
};

const STORAGE_KEY = "qianren-browser-archive-v1";

export const emptyProfile = (): PortraitProfile => ({
  targetName: "",
  targetBirthday: "",
  targetZodiac: "",
  targetGender: "",
  userName: "",
  userBirthday: "",
  userZodiac: "",
  userGender: "",
  relationshipContext: "",
  reflection: "",
  confirmedSamples: [],
});

export const emptyArchive = (): ArchiveState => ({
  messages: [],
  roles: {},
  sessions: [],
  activeSessionId: null,
  profile: emptyProfile(),
});

export function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadArchive(): ArchiveState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return emptyArchive();
    const parsed = JSON.parse(saved) as ArchiveState;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      roles: parsed.roles ?? {},
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      activeSessionId: parsed.activeSessionId ?? null,
      profile: {
        ...emptyProfile(),
        ...(parsed.profile ?? {}),
        confirmedSamples: Array.isArray(parsed.profile?.confirmedSamples) ? parsed.profile.confirmedSamples : [],
      },
    };
  } catch {
    return emptyArchive();
  }
}

export function saveArchive(state: ArchiveState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizedDate(value: string) {
  const match = value.match(/(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})/);
  if (!match) return "未标注日期";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function normalizedTime(value: string) {
  const match = value.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

const systemEvents = [
  /撤回了一条消息/, /拍了拍/, /加入了群聊/, /退出了群聊/, /修改了群聊名称/,
  /已添加.*为好友/, /你已添加/, /消息已发出，但被对方拒收/,
];

function eventKindFor(text: string): CorpusKind | null {
  const value = text.replace(/\s+/g, " ").trim();
  if (/转账|收款|¥|￥/.test(value)) return "transfer";
  if (/红包/.test(value)) return "red-packet";
  if (/通话|电话|语音聊天/.test(value)) return "call";
  if (/视频/.test(value)) return "video";
  if (/语音/.test(value)) return "voice";
  if (/动画表情|表情/.test(value)) return "sticker";
  if (/图片|照片|相册/.test(value)) return "image";
  if (/位置/.test(value)) return "location";
  if (/文件|文档/.test(value)) return "file";
  if (/链接|小程序|名片/.test(value)) return "link";
  if (systemEvents.some((pattern) => pattern.test(value))) return "system";
  return null;
}

function eventActors(text: string, fallbackActor: string) {
  const directed = text.match(/^(.{1,32}?)(?:向|给)(.{1,32}?)(?:转账|发起转账|发送了红包|发起了语音通话|发起了视频通话)/);
  if (directed) return { actor: directed[1].trim(), target: directed[2].trim() };
  const received = text.match(/^(?:你|我)收到(.{1,32}?)的(?:转账|红包)/);
  if (received) return { actor: received[1].trim(), target: fallbackActor };
  return fallbackActor && fallbackActor !== "互动事件" ? { actor: fallbackActor } : {};
}

function eventActorFromText(text: string) {
  const match = text.match(/^(.{1,32}?)(?:向|给|发起(?:了)?|发送(?:了)?|分享(?:了)?)(?:.{0,32})(?:转账|红包|语音|视频|通话|电话|图片|表情|文件|位置|链接)/);
  return match?.[1].trim();
}

function classifyCorpusText(text: string, speaker: string): Pick<CorpusMessage, "kind" | "event" | "ignored" | "filterReason"> {
  const compact = text.replace(/\s+/g, " ").trim();
  const kind = eventKindFor(compact);
  if (kind) return { kind, event: { kind, ...eventActors(compact, speaker), description: compact }, ignored: false };
  if (/^[—_·.。…\-\s]{3,}$/.test(compact)) return { kind: "uncertain", ignored: true, filterReason: "没有可辨识内容" };
  return { kind: "message", ignored: false };
}

function createParsedMessage(sourceIndex: number, speaker: string, text: string, date: string, time: string): CorpusMessage | null {
  const cleaned = text.replace(/[\u200b\ufeff]/g, "").replace(/\s*\n\s*/g, " ").trim();
  if (!cleaned) return null;
  const normalizedSpeaker = speaker.trim() || "互动事件";
  const classification = classifyCorpusText(cleaned, normalizedSpeaker);
  return { id: `draft-${sourceIndex}`, sourceIndex, speaker: normalizedSpeaker, text: cleaned, date, time, ...classification };
}

function timestampOf(message: CorpusMessage) {
  if (!message.date || message.date === "未标注日期" || !message.time) return null;
  const date = message.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time = message.time.match(/^(\d{2}):(\d{2})$/);
  if (!date || !time) return null;
  return Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), Number(time[1]), Number(time[2]));
}

/** 只有全部记录均带完整日期与时间时才重排；否则严格保留用户原始导入顺序。 */
export function preserveChronologicalOrder(messages: CorpusMessage[]) {
  const copied = [...messages];
  if (copied.length < 2 || !copied.every((message) => timestampOf(message) !== null)) return copied.sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
  return copied.sort((a, b) => (timestampOf(a)! - timestampOf(b)!) || (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
}

export function parseChatText(raw: string): CorpusMessage[] {
  let currentDate = "未标注日期";
  let pendingSpeaker = "";
  let pendingTime = "";
  let active: CorpusMessage | null = null;
  let sourceIndex = 0;
  const parsed: CorpusMessage[] = [];
  const push = (speaker: string, text: string, date = currentDate, time = "") => {
    const message = createParsedMessage(sourceIndex++, speaker, text, date, normalizedTime(time));
    if (message) { parsed.push(message); active = message; }
  };
  const append = (text: string) => {
    if (active && active.kind !== "system") {
      active.text = `${active.text} ${text}`.replace(/\s+/g, " ").trim();
      Object.assign(active, classifyCorpusText(active.text, active.speaker));
    } else push(pendingSpeaker || "待确认", text, currentDate, pendingTime);
  };

  for (const sourceLine of raw.replace(/\r/g, "").split("\n")) {
    const line = sourceLine.replace(/[\u200b\ufeff]/g, "").trim();
    if (!line) continue;

    const inlineDated = line.match(/^\[?(\d{4}[./年-]\d{1,2}[./月-]\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+([^:：]{1,32})[:：]\s*(.*)$/);
    const timedEvent = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)$/);
    const inlineTimed = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:：]{1,32})[:：]\s*(.*)$/);
    const plainTimed = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+([^:：]{1,32})[:：]\s*(.*)$/);
    const simple = line.match(/^([^:：]{1,32})[:：]\s*(.+)$/);
    const speakerHeader = line.match(/^([^:：]{1,32})\s+(?:\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?)(?:\s|$)/);
    const dateHeading = line.match(/^(?:[—–-]*\s*)?(\d{4}[./年-]\d{1,2}[./月-]\d{1,2})(?:日)?\s*(?:[—–-]*)$/);

    if (inlineDated) {
      currentDate = normalizedDate(inlineDated[1]); pendingSpeaker = ""; pendingTime = "";
      push(inlineDated[3], inlineDated[4], currentDate, inlineDated[2]); continue;
    }
    if (timedEvent && eventKindFor(timedEvent[2]) && !inlineTimed) { push(eventActorFromText(timedEvent[2]) || "互动事件", timedEvent[2], currentDate, timedEvent[1]); pendingSpeaker = ""; pendingTime = ""; continue; }
    if (inlineTimed) { push(inlineTimed[2], inlineTimed[3], currentDate, inlineTimed[1]); pendingSpeaker = ""; pendingTime = ""; continue; }
    if (plainTimed) { push(plainTimed[2], plainTimed[3], currentDate, plainTimed[1]); pendingSpeaker = ""; pendingTime = ""; continue; }
    if (dateHeading) { currentDate = normalizedDate(dateHeading[1]); pendingTime = ""; active = null; continue; }
    if (speakerHeader && !simple) { pendingSpeaker = speakerHeader[1].trim(); pendingTime = normalizedTime(speakerHeader[2]); active = null; continue; }
    if (simple) { push(simple[1], simple[2], currentDate, pendingTime); pendingSpeaker = ""; pendingTime = ""; continue; }
    if (eventKindFor(line)) { push("互动事件", line, currentDate, pendingTime); pendingSpeaker = ""; pendingTime = ""; continue; }
    append(line); pendingSpeaker = ""; pendingTime = "";
  }
  return preserveChronologicalOrder(parsed);
}

export type ImageOcrResult = { rawText: string; formattedText: string; detectedBubbles: number; usedSideHints: boolean };

/** OCR 先按截图纵向顺序读取；仅用左右位置标记“左/右侧消息”，绝不猜测哪一侧是我。 */
export async function recognizeChatImage(file: File, onProgress?: (progress: number) => void): Promise<ImageOcrResult> {
  const result = await recognize(file, "chi_sim+eng", { logger: (message) => { if (message.status === "recognizing text" && typeof message.progress === "number") onProgress?.(message.progress); } });
  const rawText = result.data.text.replace(/\r/g, "").replace(/[\u200b\ufeff]/g, "").trim();
  type OcrLine = { text?: string; bbox?: { x0?: number; x1?: number; y0?: number; y1?: number } };
  const lines = ((result.data as unknown as { lines?: OcrLine[] }).lines ?? [])
    .map((line) => ({ text: line.text?.replace(/\s+/g, " ").trim() || "", x0: line.bbox?.x0 ?? 0, x1: line.bbox?.x1 ?? 0, y0: line.bbox?.y0 ?? 0, y1: line.bbox?.y1 ?? 0 }))
    .filter((line) => line.text)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  if (!lines.length) return { rawText, formattedText: rawText, detectedBubbles: 0, usedSideHints: false };

  const width = Math.max(...lines.map((line) => line.x1), 1);
  const bubbles: Array<{ speaker: string; text: string; time: string; y1: number }> = [];
  let pendingTime = "";
  for (const line of lines) {
    const centered = (line.x0 + line.x1) / 2;
    const timeOnly = normalizedTime(line.text);
    if (timeOnly && line.text.replace(/\s/g, "").length <= 8 && centered > width * 0.28 && centered < width * 0.72) { pendingTime = timeOnly; continue; }
    const speaker = centered >= width * 0.55 ? "右侧消息" : "左侧消息";
    const previous = bubbles[bubbles.length - 1];
    const sameBubble = previous && previous.speaker === speaker && line.y0 - previous.y1 < 54;
    if (sameBubble) { previous.text = `${previous.text} ${line.text}`.trim(); previous.y1 = line.y1; }
    else bubbles.push({ speaker, text: line.text, time: pendingTime, y1: line.y1 });
    pendingTime = "";
  }
  const formattedText = bubbles.map((bubble) => `${bubble.time ? `[${bubble.time}] ` : ""}${bubble.speaker}: ${bubble.text}`).join("\n");
  return { rawText, formattedText: formattedText || rawText, detectedBubbles: bubbles.length, usedSideHints: bubbles.length > 0 };
}

export type RoleSuggestion = { roles: Record<string, SpeakerRole>; meSpeaker?: string; taSpeaker?: string; confidence: "high" | "medium" | "low"; note: string };

export function inferRoles(messages: CorpusMessage[], profile: Partial<PortraitProfile> = {}): RoleSuggestion {
  const speakers = speakersFor(messages).filter((speaker) => speaker !== "互动事件" && speaker !== "系统提示");
  if (!speakers.length) return { roles: { "互动事件": "ignore" }, confidence: "low", note: "没有可供识别的文字发言人；互动事件会随时间线保留。" };
  const normalize = (value: string) => value.trim().toLowerCase();
  const firstIndex = new Map(speakers.map((speaker) => [speaker, messages.findIndex((message) => message.speaker === speaker)]));
  const explicitMe = speakers.find((speaker) => /^(我|me|自己|本人|我自己)$/i.test(speaker) || (profile.userName && normalize(speaker) === normalize(profile.userName)));
  const explicitTa = speakers.find((speaker) => (profile.targetName && normalize(speaker) === normalize(profile.targetName)) || /^(ta|对方|前任|对象|男朋友|女朋友|老公|老婆)$/i.test(speaker));
  const rightSide = speakers.find((speaker) => /^(右侧消息|右边消息|right)$/i.test(speaker));
  const leftSide = speakers.find((speaker) => /^(左侧消息|左边消息|left)$/i.test(speaker));
  const ordered = [...speakers].sort((left, right) => (firstIndex.get(left) ?? 0) - (firstIndex.get(right) ?? 0));
  let meSpeaker = explicitMe || rightSide;
  let taSpeaker = explicitTa || leftSide;
  if (speakers.length === 2) {
    if (!meSpeaker && taSpeaker) meSpeaker = speakers.find((speaker) => speaker !== taSpeaker);
    if (!taSpeaker && meSpeaker) taSpeaker = speakers.find((speaker) => speaker !== meSpeaker);
    if (!meSpeaker && !taSpeaker) { meSpeaker = ordered[0]; taSpeaker = ordered[1]; }
  }
  const roles: Record<string, SpeakerRole> = { "互动事件": "ignore", "系统提示": "ignore" };
  speakers.forEach((speaker) => { roles[speaker] = speaker === meSpeaker ? "me" : speaker === taSpeaker ? "ta" : "ignore"; });
  const confidence: RoleSuggestion["confidence"] = explicitMe || explicitTa ? "high" : rightSide || leftSide ? "medium" : speakers.length === 2 ? "low" : "low";
  const reason = explicitMe || explicitTa ? "发言人名称与明确称呼或已填资料匹配" : rightSide || leftSide ? "根据聊天截图的左右消息位置自动归因" : speakers.length === 2 ? "未出现明确称呼，按最早出现的两位主要发言人自动映射" : "存在多位发言人，仅保留最可能的双人对话，其余标为旁观信息";
  return { roles, meSpeaker, taSpeaker, confidence, note: `已自动识别：${meSpeaker || "未确定"} → 我，${taSpeaker || "未确定"} → TA（${reason}）。` };
}

export function mergeMessages(current: CorpusMessage[], incoming: CorpusMessage[]) {
  const existing = new Set(current.map((item) => `${item.date}|${item.time}|${item.speaker}|${item.text}`));
  const unique = incoming.filter((item) => {
    const signature = `${item.date}|${item.time}|${item.speaker}|${item.text}`;
    if (existing.has(signature)) return false;
    existing.add(signature);
    return true;
  });
  return { all: preserveChronologicalOrder([...current, ...unique]), added: unique.length, duplicate: incoming.length - unique.length };
}

export function speakersFor(messages: CorpusMessage[]) {
  return Array.from(new Set(messages.map((item) => item.speaker)));
}

export function roleOf(speaker: string, roles: Record<string, SpeakerRole>): SpeakerRole {
  if (roles[speaker]) return roles[speaker];
  return /^(我|me|自己|本人)$/i.test(speaker) ? "me" : "ignore";
}

export function messagesForRole(messages: CorpusMessage[], roles: Record<string, SpeakerRole>, role: SpeakerRole) {
  return messages.filter((item) => roleOf(item.speaker, roles) === role);
}

const eventNames: Partial<Record<CorpusKind, string>> = { transfer: "转账", "red-packet": "红包", voice: "语音", video: "视频", call: "通话", sticker: "表情", image: "图片", location: "位置", file: "文件", link: "链接", system: "系统互动" };

export function summarizeInteractionEvents(messages: CorpusMessage[]) {
  const events = preserveChronologicalOrder(messages.filter((message) => Boolean(message.event)));
  const counts = new Map<string, number>();
  events.forEach((message) => { const label = eventNames[message.event!.kind] || "互动事件"; counts.set(label, (counts.get(label) || 0) + 1); });
  const overview = counts.size ? Array.from(counts.entries()).map(([label, count]) => `${label} ${count} 次`).join("、") : "未识别到非文字互动事件";
  const timeline = events.slice(-8).map((message) => `- ${message.date}${message.time ? ` ${message.time}` : ""}：${message.event?.actor ? `${message.event.actor} · ` : ""}${message.event?.description || message.text}`).join("\n") || "- 暂无互动事件";
  return { total: events.length, overview, timeline };
}

function contentCharacters(text: string) {
  return Array.from(text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, ""));
}

export function createStyleSnapshot(messages: CorpusMessage[], roles: Record<string, SpeakerRole>): StyleSnapshot {
  const taMessages = messagesForRole(messages, roles, "ta").filter((item) => !item.event && item.kind !== "uncertain" && !/^\[.+\]$/.test(item.text));
  const meMessages = messagesForRole(messages, roles, "me").filter((item) => !item.event && item.kind !== "uncertain");
  const lengths = taMessages.map((item) => contentCharacters(item.text).length).filter(Boolean);
  const gramCounts = new Map<string, number>();
  taMessages.forEach((item) => {
    const chars = contentCharacters(item.text);
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= chars.length - size; index += 1) {
        const gram = chars.slice(index, index + size).join("");
        if (gram.length >= 2) gramCounts.set(gram, (gramCounts.get(gram) ?? 0) + 1);
      }
    }
  });
  const phrases = Array.from(gramCounts.entries())
    .filter(([text, count]) => count >= Math.max(2, Math.ceil(taMessages.length / 30)) && !/^(哈哈|嗯嗯|可以|好的|就是)$/.test(text))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .reduce<Array<{ text: string; count: number }>>((picked, [text, count]) => {
      if (picked.length >= 8) return picked;
      const redundant = picked.some((item) => (item.text.includes(text) || text.includes(item.text)) && count < item.count * 1.5);
      return redundant ? picked : [...picked, { text, count }];
    }, []);
  const hourCounts = Array.from({ length: 24 }, () => 0);
  taMessages.forEach((item) => {
    const hour = Number(item.time.slice(0, 2));
    if (Number.isFinite(hour) && hour >= 0 && hour < 24) hourCounts[hour] += 1;
  });
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  return {
    total: messages.length,
    taCount: taMessages.length,
    meCount: meMessages.length,
    averageLength: lengths.length ? lengths.reduce((sum, length) => sum + length, 0) / lengths.length : 0,
    shortRate: lengths.length ? lengths.filter((length) => length <= 10).length / lengths.length : 0,
    peakHour: peakHour < 0 ? 0 : peakHour,
    activeDays: new Set(messages.map((item) => item.date).filter((date) => date !== "未标注日期")).size,
    phrases,
  };
}

export function personaName(messages: CorpusMessage[], roles: Record<string, SpeakerRole>) {
  return messagesForRole(messages, roles, "ta")[0]?.speaker ?? "TA";
}

export function createPersona(messages: CorpusMessage[], roles: Record<string, SpeakerRole>) {
  const snapshot = createStyleSnapshot(messages, roles);
  const name = personaName(messages, roles);
  if (!snapshot.taCount) return "# 尚未生成画像\n\n请先导入记录，并在「语料」页指定谁是 TA。";
  const phraseText = snapshot.phrases.length ? snapshot.phrases.map((item) => `${item.text}（${item.count}次）`).join("、") : "尚未识别到稳定高频口头禅";
  const interactions = summarizeInteractionEvents(messages);
  return `# 前任 · ${name} · 对话角色复刻（浏览器本地生成）

## 记录范围
- 当前语料：${snapshot.total} 条；其中 TA ${snapshot.taCount} 条、我 ${snapshot.meCount} 条。
- 活跃日期：${snapshot.activeDays || "未标注"} 天；TA 最常出现于 ${String(snapshot.peakHour).padStart(2, "0")}:00 前后。

## 表达节奏
- TA 平均每条约 ${snapshot.averageLength.toFixed(1)} 字；${Math.round(snapshot.shortRate * 100)}% 的消息不超过 10 字。
- 建议回复保持口语、短句、不过度补充未在记录出现的重要事实。
- 高频片段：${phraseText}。

## 互动事件线索
- 已保留 ${interactions.total} 条非文字互动：${interactions.overview}。
- 这些事件用于还原互动节奏与情境，不把“语音 / 转账 / 表情”等占位内容误读成对方说过的文字。

## 使用边界
- 这是依照聊天记录进行的风格整理与本地复刻，不是真人，也不应替代现实沟通。
- 当对话涉及强烈困扰或安全风险时，请停止沉浸式模仿，优先联系可信任的现实支持。
`;
}

function markerCount(messages: CorpusMessage[], patterns: RegExp[]) {
  return messages.reduce((total, message) => total + Number(patterns.some((pattern) => pattern.test(message.text))), 0);
}

export function createIntegratedPortrait(archive: ArchiveState) {
  const snapshot = createStyleSnapshot(archive.messages, archive.roles);
  const name = archive.profile.targetName.trim() || personaName(archive.messages, archive.roles);
  const ta = messagesForRole(archive.messages, archive.roles, "ta");
  const me = messagesForRole(archive.messages, archive.roles, "me");
  const careMarkers = markerCount(ta, [/吃了吗|到家|早点睡|晚安|辛苦|累不累|注意|别难过|抱抱|想你/]);
  const repairMarkers = markerCount([...ta, ...me], [/对不起|抱歉|没事|别生气|误会|解释|冷静|说开|和好/]);
  const questionMarkers = markerCount([...ta, ...me], [/[？?]$/]);
  const evidence = snapshot.taCount + snapshot.meCount;
  const phraseText = snapshot.phrases.length ? snapshot.phrases.map((item) => `“${item.text}”`).join("、") : "暂未形成稳定高频片段";
  const interactions = summarizeInteractionEvents(archive.messages);
  const context = archive.profile.relationshipContext.trim() || "尚未补充关系背景";
  const targetBirthday = archive.profile.targetBirthday.trim() || "未补充";
  const targetZodiac = archive.profile.targetZodiac.trim() || "未补充";
  const targetGender = archive.profile.targetGender.trim() || "未补充";
  const userName = archive.profile.userName.trim() || "我";
  const userBirthday = archive.profile.userBirthday.trim() || "未补充";
  const userZodiac = archive.profile.userZodiac.trim() || "未补充";
  const userGender = archive.profile.userGender.trim() || "未补充";
  const reflection = archive.profile.reflection.trim() || "未补充";
  const learningCount = archive.profile.confirmedSamples.length;
  const evidenceNote = evidence < 24 ? "样本仍偏少，以下内容应视为待验证的阅读线索。" : "样本覆盖到多段互动，但结论仍只描述已记录的互动方式。";

  return `# ${name} · 综合互动画像

> 这是一份基于已归档对话、用户确认补充样本与自愿背景资料生成的本地报告。它不诊断人格、依恋类型或心理健康，也不替代现实沟通与专业支持。

## 档案范围
- 已归档真实记录：${snapshot.total} 条；其中 ${name} ${snapshot.taCount} 条、我 ${snapshot.meCount} 条。
- 用户确认补充的真实表达：${learningCount} 条。AI 在本页生成的回复不会被回写为真实语料。
- ${evidenceNote}

## 表达画像
- 常见节奏：平均约 ${snapshot.averageLength.toFixed(1)} 字；短句比例 ${Math.round(snapshot.shortRate * 100)}%；常出现于 ${String(snapshot.peakHour).padStart(2, "0")}:00 前后。
- 语言锚点：${phraseText}。
- 复刻使用原则：优先引用已确认的表达方式，不把推测、星座或生成内容当作事实。

## 可观察的互动线索
- 关照/安抚类措辞出现 ${careMarkers} 次；这只能说明记录中可见的照应表达，并不代表稳定的关心能力或关系承诺。
- 修复/澄清类措辞出现 ${repairMarkers} 次；它可作为“冲突后是否尝试说开”的观察入口，而不是谁对谁错的证据。
- 问句或主动追问线索出现 ${questionMarkers} 次；建议结合具体时间段阅读，而非单独用数量解释在意程度。

## 互动事件时间线
- 已保留 ${interactions.total} 条非文字互动：${interactions.overview}。
- 近期事件（按归档时间顺序）：
${interactions.timeline}
- 事件反映的是当时发生的互动与媒介，不自动推断动机、金额含义或关系承诺。

## 依恋与关系阅读（非诊断）
- 若你关心“偏焦虑、偏回避或安全型”之类标签，更可靠的做法是观察具体互动：需要回应时如何表达、压力来临时如何拉开距离、发生误会后是否愿意修复。
- 现有记录能呈现的是措辞和节奏，不能判断任何人的依恋类型、人格或动机。把“我看到的行为”与“我感受到的需要”分开记录，通常比贴标签更有帮助。

## 自愿背景资料
- 对方资料（自愿填写）：性别/称呼 ${targetGender}；生日 ${targetBirthday}；星座 ${targetZodiac}。
- 我的资料（自愿填写）：${userName}；性别/称呼 ${userGender}；生日 ${userBirthday}；星座 ${userZodiac}。
- 关系背景：${context}。
- 我的边注：${reflection}。
- 星座仅作为对方自我叙事或你愿意记录的文化线索，不用于推导性格、兼容性或关系结论。

## 下一次可继续观察
1. 在真实聊天出现压力、分歧或久未回应时，双方分别会做什么？
2. 哪些具体措辞会让你感到被理解，哪些会让你想撤退？
3. 有新的真实表达时，请在“共同画像”中手动确认后加入；不要把 AI 生成的话当作对方新证据。`;
}

export function localMimic(input: string, messages: CorpusMessage[], roles: Record<string, SpeakerRole>) {
  const candidates = messagesForRole(messages, roles, "ta").filter((item) => !item.event && item.kind !== "uncertain" && item.text.length > 0 && !/^\[.+\]$/.test(item.text));
  if (!candidates.length) return "先把聊天记录放进档案里，我才有足够的语气线索。";
  const query = new Set(contentCharacters(input).join("").match(/.{1,2}/g) ?? []);
  const ranked = candidates
    .map((item, index) => {
      const grams = contentCharacters(item.text).join("").match(/.{1,2}/g) ?? [];
      const overlap = grams.reduce((score, gram) => score + (query.has(gram) ? 1 : 0), 0);
      return { item, score: overlap * 10 - Math.abs(item.text.length - Math.min(input.length, 14)) * 0.08, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0]?.item;
  return best?.text ?? "嗯。";
}

export const sampleCorpus = `—— 2025-09-03 ——
[08:43] 我: 想你了
[08:47] 小雨: 嘴真甜
[08:57] 小雨: 哈哈哈 突然的
[17:37] 我: 在干嘛
[18:45] 小雨: 可以呀
[22:48] 小雨: 别闹
—— 2025-09-04 ——
[08:02] 我: 吃了吗
[08:42] 小雨: 还没 减肥
[21:05] 小雨: 刚吃完饭
[13:29] 小雨: 晚安呀
[09:22] 我: 今天怎么样
[20:43] 小雨: 笑死
—— 2025-09-05 ——
[14:04] 我: 今天好累啊
[13:58] 小雨: 看剧呢
[11:37] 我: 今天好累啊
[14:14] 小雨: 看剧呢
[17:35] 小雨: 刚下班 累死了
[19:07] 小雨: 可以呀
—— 2025-09-06 ——
[12:32] 我: 睡了吗
[12:58] 小雨: 还没 在看剧
[12:06] 小雨: 马上睡了 晚安呀
[22:19] 小雨: 嗯嗯
[18:09] 我: 早
[18:31] 我: 给你看个好玩的`;

export function downloadFile(name: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
