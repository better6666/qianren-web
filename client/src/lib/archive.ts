/** 余温档案室：纯浏览器本地数据、语料解析与风格复刻工具。 */

export type SpeakerRole = "me" | "ta" | "ignore";

export type CorpusMessage = {
  id: string;
  speaker: string;
  text: string;
  date: string;
  time: string;
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

export type ArchiveState = {
  messages: CorpusMessage[];
  roles: Record<string, SpeakerRole>;
  sessions: ChatSession[];
  activeSessionId: string | null;
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

export const emptyArchive = (): ArchiveState => ({
  messages: [],
  roles: {},
  sessions: [],
  activeSessionId: null,
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
    };
  } catch {
    return emptyArchive();
  }
}

export function saveArchive(state: ArchiveState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizedDate(value: string) {
  const match = value.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!match) return "未标注日期";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

export function parseChatText(raw: string): CorpusMessage[] {
  let currentDate = "未标注日期";
  const parsed: CorpusMessage[] = [];

  raw.replace(/\r/g, "").split("\n").forEach((sourceLine) => {
    const line = sourceLine.trim();
    if (!line) return;

    const dateHeading = line.match(/[—–-]*\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2})\s*[—–-]*/);
    if (dateHeading && !line.match(/\[\d{1,2}:\d{2}/)) {
      currentDate = normalizedDate(dateHeading[1]);
      return;
    }

    const timed = line.match(/^\[(\d{1,2}:\d{2})(?::\d{2})?\]\s*([^:：]+)[:：]\s*(.+)$/);
    const dated = line.match(/^(\d{4}[./-]\d{1,2}[./-]\d{1,2})\s+(\d{1,2}:\d{2})\s+([^:：]+)[:：]\s*(.+)$/);
    const simple = line.match(/^([^:：]{1,24})[:：]\s*(.+)$/);

    if (timed) {
      parsed.push({ id: uid("corpus"), time: timed[1], speaker: timed[2].trim(), text: timed[3].trim(), date: currentDate });
    } else if (dated) {
      parsed.push({ id: uid("corpus"), time: dated[2], speaker: dated[3].trim(), text: dated[4].trim(), date: normalizedDate(dated[1]) });
    } else if (simple) {
      parsed.push({ id: uid("corpus"), time: "", speaker: simple[1].trim(), text: simple[2].trim(), date: currentDate });
    }
  });
  return parsed;
}

export function mergeMessages(current: CorpusMessage[], incoming: CorpusMessage[]) {
  const existing = new Set(current.map((item) => `${item.date}|${item.time}|${item.speaker}|${item.text}`));
  const unique = incoming.filter((item) => {
    const signature = `${item.date}|${item.time}|${item.speaker}|${item.text}`;
    if (existing.has(signature)) return false;
    existing.add(signature);
    return true;
  });
  return { all: [...current, ...unique], added: unique.length, duplicate: incoming.length - unique.length };
}

export function speakersFor(messages: CorpusMessage[]) {
  return Array.from(new Set(messages.map((item) => item.speaker)));
}

export function roleOf(speaker: string, roles: Record<string, SpeakerRole>): SpeakerRole {
  if (roles[speaker]) return roles[speaker];
  return /^(我|me|自己|本人)$/i.test(speaker) ? "me" : "ta";
}

export function messagesForRole(messages: CorpusMessage[], roles: Record<string, SpeakerRole>, role: SpeakerRole) {
  return messages.filter((item) => roleOf(item.speaker, roles) === role);
}

function contentCharacters(text: string) {
  return Array.from(text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, ""));
}

export function createStyleSnapshot(messages: CorpusMessage[], roles: Record<string, SpeakerRole>): StyleSnapshot {
  const taMessages = messagesForRole(messages, roles, "ta").filter((item) => !/^\[.+\]$/.test(item.text));
  const meMessages = messagesForRole(messages, roles, "me");
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
  return `# 前任 · ${name} · 对话角色复刻（浏览器本地生成）

## 记录范围
- 当前语料：${snapshot.total} 条；其中 TA ${snapshot.taCount} 条、我 ${snapshot.meCount} 条。
- 活跃日期：${snapshot.activeDays || "未标注"} 天；TA 最常出现于 ${String(snapshot.peakHour).padStart(2, "0")}:00 前后。

## 表达节奏
- TA 平均每条约 ${snapshot.averageLength.toFixed(1)} 字；${Math.round(snapshot.shortRate * 100)}% 的消息不超过 10 字。
- 建议回复保持口语、短句、不过度补充未在记录出现的重要事实。
- 高频片段：${phraseText}。

## 使用边界
- 这是依照聊天记录进行的风格整理与本地复刻，不是真人，也不应替代现实沟通。
- 当对话涉及强烈困扰或安全风险时，请停止沉浸式模仿，优先联系可信任的现实支持。
`;
}

export function localMimic(input: string, messages: CorpusMessage[], roles: Record<string, SpeakerRole>) {
  const candidates = messagesForRole(messages, roles, "ta").filter((item) => item.text.length > 0 && !/^\[.+\]$/.test(item.text));
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
