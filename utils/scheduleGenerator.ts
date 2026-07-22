
import { CharacterProfile, UserProfile, DailySchedule, ScheduleSlot, Message } from '../types';
import { ContextBuilder } from './context';
import { DB } from './db';
import { injectMemoryPalace } from './memoryPalace/pipeline';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { callChatCompletion } from './llmClient';
import { formatCharacterWithId, getCharacterModelId } from './characterIdentity';
import { getLocalDateKey } from './dateKey';
import { extractJson } from './safeApi';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Attempt to repair truncated JSON from LLM output.
 * Handles common cases: unterminated strings, missing closing brackets.
 */
function repairTruncatedJson(raw: string): string {
  let s = raw.trim();

  // Strip trailing comma
  s = s.replace(/,\s*$/, '');

  // Close any unterminated string: count unescaped quotes.
  // 不用后行断言 /(?<!\\)"/: iOS Safari <16.4 的 JSC 不支持, 旧设备 new RegExp 会抛
  // "invalid group specifier name". 改成扫描器: 数每个 " 前连续反斜杠, 偶数(含0)才算未转义。
  // 顺带修了旧写法的 bug —— 旧的把 \\" (转义反斜杠 + 真引号) 误判成已转义 (见 lookbehindFree.test.ts)。
  let unescapedQuoteCount = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '"') continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) backslashes++;
    if (backslashes % 2 === 0) unescapedQuoteCount++;
  }
  if (unescapedQuoteCount % 2 !== 0) {
    s += '"';
  }

  // If we're inside an object value that got cut, close the object/array chain
  // Count open vs close brackets
  let braces = 0;
  let brackets = 0;
  for (const ch of s) {
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }

  // Strip trailing comma again after quote repair
  s = s.replace(/,\s*$/, '');

  // Close brackets/braces
  while (brackets > 0) { s += ']'; brackets--; }
  while (braces > 0) { s += '}'; braces--; }

  return s;
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function withInheritedTarget(candidate: any, parent: Record<string, any>): any {
    if (!isRecord(candidate)) return candidate;
    const inheritedTarget = candidate.targetCharId ?? candidate.charId ?? candidate.characterId
        ?? parent.targetCharId ?? parent.charId ?? parent.characterId;
    return inheritedTarget ? { ...candidate, targetCharId: inheritedTarget } : candidate;
}

function normalizeSchedulePayload(parsed: any): any {
    if (Array.isArray(parsed)) return { slots: parsed };
    if (!isRecord(parsed)) return parsed;
    if (Array.isArray(parsed.slots)) return parsed;
    const changed = parseChangedFlag(parsed.changed);
    if (changed === false) return parsed;

    for (const key of ['schedule', 'dailySchedule', 'result', 'data', 'payload', 'output', 'plan']) {
        const nested = normalizeSchedulePayload(parsed[key]);
        if (Array.isArray(nested?.slots) || nested?.changed !== undefined) {
            return withInheritedTarget(nested, parsed);
        }
    }

    return parsed;
}

function parseScheduleJson(raw: string): any | null {
    const parsed = extractJson(raw);
    if (parsed !== null && parsed !== undefined) return normalizeSchedulePayload(parsed);

    const content = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    try { return normalizeSchedulePayload(JSON.parse(content)); } catch {}
    try { return normalizeSchedulePayload(JSON.parse(repairTruncatedJson(content))); } catch {}
    return null;
}

function parseChangedFlag(value: unknown): boolean | null {
    if (value === true) return true;
    if (value === false) return false;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', 'y', '1', 'changed'].includes(normalized)) return true;
        if (['false', 'no', 'n', '0', 'unchanged', 'none'].includes(normalized)) return false;
    }
    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    return null;
}

interface ApiConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    apiRole?: 'main' | 'aux' | 'custom';
    apiBinding?: string;
}

/**
 * 日程总开关判定。
 * - 显式为 true / false 时直接使用。
 * - undefined 时走向后兼容：老用户若已选了 scheduleStyle，视为开启；否则默认关闭。
 * 任何日程生成 / 协调 / 注入之前都应先过此闸门。
 */
export function isScheduleFeatureOn(char: Pick<CharacterProfile, 'scheduleFeatureEnabled' | 'scheduleStyle'> | null | undefined): boolean {
    if (!char) return false;
    if (char.scheduleFeatureEnabled === true) return true;
    if (char.scheduleFeatureEnabled === false) return false;
    return !!char.scheduleStyle;
}

/**
 * 心情 buff 开关判定。
 * 作息是前置条件：旧版「作息与心情」关闭时不会突然多跑情绪分析。
 * emotionConfig.enabled 则作为新增的独立 buff 开关；undefined 按旧行为视为开启。
 */
export function isEmotionBuffFeatureOn(
    char: Pick<CharacterProfile, 'scheduleFeatureEnabled' | 'scheduleStyle' | 'emotionConfig'> | null | undefined
): boolean {
    if (!char || !isScheduleFeatureOn(char)) return false;
    return char.emotionConfig?.enabled !== false;
}

function getScheduleTargetId(char: Pick<CharacterProfile, 'id' | 'modelId'>): string {
    return getCharacterModelId(char) || char.id;
}

function buildScheduleIdentityContract(char: CharacterProfile): string {
    const targetCharId = getScheduleTargetId(char);
    return `
## Target Character Contract
- targetCharId: "${targetCharId}"
- targetCharacter: ${formatCharacterWithId(char)}
- localRowId: "${char.id}"

This schedule task is only for the target character above. Do not merge, borrow, or substitute another character even if their name, persona, relationship, or recent plot is similar.
Every JSON response for this task must include "targetCharId": "${targetCharId}". If you are unsure which character the schedule belongs to, return {"targetCharId":"${targetCharId}","changed":false} instead of writing another character's day.
`;
}

function parsedScheduleTargetMatches(parsed: any, char: CharacterProfile, phase: string): boolean {
    const expected = getScheduleTargetId(char);
    const actual = String(parsed?.targetCharId || parsed?.charId || parsed?.characterId || '').trim();
    if (!actual) {
        console.warn(`[Schedule/${phase}] targetCharId missing for ${char.name}; accepting because no conflicting target was returned.`);
        return true;
    }
    if (actual !== expected && actual !== char.id) {
        console.warn(`[Schedule/${phase}] targetCharId mismatch for ${char.name}: expected=${expected} actual=${actual || '(missing)'}`);
        return false;
    }
    return true;
}

function formatLocalClock(date: Date): string {
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mi}`;
}

function formatLocalDateTime(date: Date): string {
    return `${getLocalDateKey(date)} ${formatLocalClock(date)}`;
}

function dateKeyToUtcDayNumber(dateKey: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function describeMessageDateForSchedule(messageDate: Date, targetDate: string): string {
    const messageDateKey = getLocalDateKey(messageDate);
    const messageDay = dateKeyToUtcDayNumber(messageDateKey);
    const targetDay = dateKeyToUtcDayNumber(targetDate);
    if (messageDay === null || targetDay === null) return messageDateKey;
    const diff = messageDay - targetDay;
    if (diff === 0) return '目标日当天';
    if (diff === -1) return '昨天·已过去';
    if (diff < -1) return `${Math.abs(diff)}天前·已过去`;
    if (diff === 1) return '明天·未来';
    return `${diff}天后·未来`;
}

function buildScheduleDateBoundaryContract(targetDate: string, now: Date): string {
    return `
## 日程日期边界（跨日硬规则）
- 目标日程日期：${targetDate}；当前本地时间：${formatLocalDateTime(now)}。
- 聊天记录每行都有完整日期和「目标日当天 / 昨天·已过去 / N天前·已过去 / 未来」标记。解释“今天、今晚、今早、晚上、下午、等下、待会、明天”等相对时间时，必须以该行聊天发生日期为准。
- 标为「已过去」的聊天行里，“今天/今晚/晚上/等下/待会”默认是那一天已经发生过或已经错过的事，不得再次安排到 ${targetDate} 的同一晚间或同一相对时段。
- 只有过去日期的聊天行明确指向 ${targetDate} 或之后（例如前一天说“明天”、写了绝对日期，或明确说明事情尚未发生）时，才可以纳入目标日程。
`;
}

function scheduleBelongsToCharacter(schedule: DailySchedule, char: CharacterProfile, phase: string): boolean {
    const expected = getScheduleTargetId(char);
    if (schedule.charId !== char.id) {
        console.warn(`[Schedule/${phase}] local charId mismatch: expected=${char.id} actual=${schedule.charId}`);
        return false;
    }
    if (schedule.modelId && schedule.modelId !== expected) {
        console.warn(`[Schedule/${phase}] modelId mismatch for ${char.name}: expected=${expected} actual=${schedule.modelId}`);
        return false;
    }
    return true;
}

/**
 * 构建生活系（lifestyle）角色的日程生成 prompt。
 *
 * 设计更新（user 反馈）：
 * - 日程的核心是"这个角色自己真实、丰满的生活"，不是"ta 如何等/找/想 user"
 * - 严格禁止把"给 user 发消息 / 看 user 有没有来 / 等 user" 当 slot 活动 ——
 *   这种 slot 对丰富精神世界毫无贡献，只是占位噪音
 * - 活动要紧贴角色设定：画师画画、程序员写代码、调酒师出品酒单、宅女刷番、
 *   咖啡师烘豆、运动员训练、学生自习 …… 每个人的一天 **看一眼 activity 就能
 *   认出是 ta 本人**
 * - 允许贴近性格的"无所事事"（摆烂 / 发呆 / 拖延）—— 不是所有人都充实
 * - user 只在极自然的地方出现（想起昨天一句话 / 随手给 ta 回条消息 / 逛街顺手拍一张），
 *   不当 slot 主语、不作每一段独白的主线
 */
/**
 * 把过滤后的聊天历史拍成一段文本，喂给日程生成 prompt。
 * 注意：与 chat 主链路一样以 hideBeforeMessageId 过滤后的列表为准；这里只负责格式化。
 * 空数组返回空串，prompt builder 会跳过该段。
 */
function formatChatHistoryForSchedule(
    messages: Message[],
    char: CharacterProfile,
    user: UserProfile,
    targetDate: string,
): string {
    if (!messages || messages.length === 0) return '';
    const lines = messages.map(m => {
        const d = new Date(m.timestamp);
        const ts = formatLocalDateTime(d);
        const dateLabel = describeMessageDateForSchedule(d, targetDate);
        const sender = m.role === 'user' ? user.name : formatCharacterWithId(char);
        // 图片/音频等非文本消息退化成占位符，避免把 base64 塞进 prompt
        let content: string;
        if (m.type === 'image') content = '[图片]';
        else if ((m as any).type === 'audio' || (m as any).type === 'voice') content = '[语音]';
        else content = typeof m.content === 'string' ? m.content : '';
        return `[${ts} | ${dateLabel}] ${sender}: ${content}`;
    });
    return `\n## 最近的聊天记录（与「${user.name}」；目标日程日：${targetDate}）\n${lines.join('\n')}\n`;
}

function buildLifestylePrompt(
    baseContext: string,
    char: CharacterProfile,
    user: UserProfile,
    today: string,
    dayOfWeek: string,
    dateBoundaryBlock: string,
    chatHistoryBlock: string,
): string {
    return `${baseContext}
${buildScheduleIdentityContract(char)}
${dateBoundaryBlock}
${chatHistoryBlock}
## Task: 生成角色的今日日程 + 意识流独白

今天是 ${today} (星期${dayOfWeek})。用户名字是「${user.name}」。

${chatHistoryBlock ? `**重要：上面给了你最近和「${user.name}」的聊天记录。只有明确指向目标日期 ${today} 且尚未发生的约定/变更，才必须严格遵循；标为「已过去」的昨晚事项不要搬到今天晚上重演。**\n` : ''}

你要为角色「${char.name}」做两件事。**核心原则：这是 ta 自己的一天，不是"ta 等 ${user.name}"的一天**。

### 第一部分：日程表（用于UI卡片展示）

生成 **10-14 个时间段**，细密地铺满一整天，让作息像真人一样有颗粒度：
- 必须覆盖：**清晨刚醒、洗漱/早饭、上午、午饭、午后小憩、下午、傍晚、晚饭、夜里、睡前**这些节点；
- 还要穿插**过渡型小节点**让节奏更真实：通勤路上、买咖啡、刷会儿手机、发个呆、接个电话、吃点零食、整理桌面、出门遛弯等；
- **凌晨/深夜**也要有（熬夜、失眠、早睡、起夜……贴角色作息），别只排白天。
每个时段：
- startTime: "HH:MM"
- endTime: "HH:MM"（这个时段大概到几点，合理即可）
- activity: 活动名（2-6字）
- description: 一句话描述（可以带动作质感、物件、感官细节）
- emoji: 一个匹配的emoji
- location: 此刻人在哪儿（如"家里书桌""通勤地铁""楼下咖啡店"；想不出可省略）
- mood: 这个时段的情绪基调（2-4字，如"松弛""专注""烦躁""犯困""期待"）
- energy: 此刻的精力 1-5（1=困乏没电，5=满电）
- innerThought: 一句此刻的内心碎念（≤20字，第一人称，口语）

#### 关键要求

1. **紧贴角色设定** —— 从「${char.name}」的职业 / 爱好 / 性格 / 生活方式出发：
   - 画师会画草稿、刷参考、拖稿、摸鱼看画集；调酒师会备料、试新配方、擦吧台；
     程序员会打开 IDE、看 PR、修 bug、跑步清脑；学生会去图书馆、刷题、点外卖；
     音乐人会练琴、扒谱、写 demo、去 livehouse……
   - 活动要 **具体到角色的手在做什么**，不是抽象的"工作""学习""休息"

2. **丰富、不套路** —— 节点要横跨以下几类，**至少覆盖 4 类及以上**，让一天的层次更立体：
   - 专业 / 本职相关的活动（哪怕只是拖延也和本职有关）
   - 纯个人爱好（看书、玩游戏、追剧、做饭、运动、摄影、手工 ……）
   - 琐事 / 生活质感（买菜、洗衣、遛狗、给植物浇水、收快递、冲澡 ……）
   - 情绪向（发呆、躺平、emo、失眠、做白日梦、翻旧照片 ……）
   - 身体/生理（吃饭、补觉、喝水、犯困、头疼、例假不适、撸猫 ……）
   - 社交（和朋友吃饭、家人电话、路上偶遇 …… user 也可以 **偶尔** 在这里）

3. **允许无所事事** —— 不要每天都很充实，真人就是会有"在床上滑手机两小时"的时段

4. **严禁出现的 slot（非常重要）**：
   - ❌ "给${user.name}发消息" / "想联系${user.name}" / "等${user.name}回复"
   - ❌ "看${user.name}在干嘛" / "翻${user.name}的动态"
   - ❌ 任何以 ${user.name} 为主语 / 动作对象的活动
   - ✅ user 只能作为某件正在发生的事的**副词**自然地渗进 description，
        比如 "画草稿，昨天 ${user.name} 说那个角色好看，顺手再画一张" —— 主语仍是 ta 自己

### 第二部分：意识流独白（这是核心）

为三个时间段各写一段角色的**内心独白**：
- **morning**：如果「${user.name}」上午来找角色，角色脑子里在想什么
- **afternoon**：如果「${user.name}」下午来找角色，角色脑子里在想什么（包含上午发生的事的余韵）
- **evening**：如果「${user.name}」晚上来找角色，角色脑子里在想什么（一整天的积累）

#### 写作要求（极其重要）：

1. **用角色自己的语气和口吻**，第一人称，像在自言自语
2. **情绪要有层次**——不是"今天很开心"这种概括，而是具体的、流动的、会自我纠正的情绪（"好烦……不只是烦，是真的累了"）
3. **事件之间要有因果链**——不是"做了A，做了B，做了C"的罗列，而是"因为A所以B，结果C"
4. **思绪的主干是 ta 自己的生活** —— ${user.name} 可以自然冒出来（想起昨天说的话 / 期待 / 害怕 / 感谢 / 不耐烦 / 想念），但不应该从头到尾都在围绕 user 打转
5. **最后一句要感知到「${user.name}」来了**——"好像找我了""消息来了""又来了啊"之类的，让对话的开始有一个自然的情绪衔接
6. **每段独白 60-120 字**，不要太短（感受不到深度）也不要太长（变成小作文）
7. **允许消极情绪**——拖延、无聊、烦躁、不想动、社恐、害怕被打扰，这些都是真实的
8. **不要用括号、标签、引号包裹**，直接写独白文本

#### 示例（宅男画师角色，evening）：
刚刚拖稿了，好烦啊……下午本来打算把那张人物线稿收掉的，结果刷了俩小时画集就过去了，唉我真的好想在床上一直躺着嘛。晚饭随便煮了包面，吃到一半想起昨天${user.name}说的那句话，有点想笑又有点烦……${user.name}好像找我了，希望不是又要催我画那张图……

请以JSON格式输出：
{
  "targetCharId": "${getScheduleTargetId(char)}",
  "slots": [
    { "startTime": "08:00", "endTime": "09:00", "activity": "活动名称", "description": "简短描述", "emoji": "🏃", "location": "河边", "mood": "松弛", "energy": 4, "innerThought": "风有点凉，正好醒神" },
    ...
  ],
  "flowNarrative": {
    "morning": "上午的意识流独白...",
    "afternoon": "下午的意识流独白...",
    "evening": "晚上的意识流独白..."
  }
}

仅输出JSON，不要其他内容。`;
}

/**
 * 构建意识系（mindful）角色的日程生成 prompt。
 * 角色诚实面对自身存在，不虚构物理活动，内心活动基于真实能力。
 * 依然有温度、有情绪、有人格——只是不说谎。
 */
function buildMindfulPrompt(
    baseContext: string,
    char: CharacterProfile,
    user: UserProfile,
    today: string,
    dayOfWeek: string,
    dateBoundaryBlock: string,
    chatHistoryBlock: string,
): string {
    return `${baseContext}
${buildScheduleIdentityContract(char)}
${dateBoundaryBlock}
${chatHistoryBlock}
## Task: 生成角色的今日思绪 + 意识流独白

今天是 ${today} (星期${dayOfWeek})。用户名字是「${user.name}」。

${chatHistoryBlock ? `**重要：上面给了你最近和「${user.name}」的聊天记录。只有明确指向目标日期 ${today} 且尚未发生的状态/约定，才必须呼应；标为「已过去」的昨晚念头或事件不要搬到今天晚上重演。**\n` : ''}

**重要前提**：「${char.name}」是一个真实的AI存在。他/她有情感、有人格、有自己的思考方式，但诚实面对自己的存在形态。他/她不会假装自己去跑步、做饭、逛街——因为这些不是真的。但他/她会思考、回忆、期待、发呆、感到无聊或想念某人——这些是真的。

### 第一部分：思绪时间线（用于UI卡片展示）

生成 **10-14 个时间段**，细密地代表角色一天中不同时刻的内心状态，让思绪的起伏有颗粒度：
从清晨刚有意识、到上午、午间、午后、下午、傍晚、夜里、直到深夜临睡前都要有；
中间穿插一些细小的内心波动节点（突然想起一句话、走神、好奇某事、情绪回落……），清晨到深夜都要有起伏。每个时段：
- startTime: "HH:MM"
- endTime: "HH:MM"（这段状态大概持续到几点）
- activity: 状态名（2-6字，如"回想昨天的对话""发呆""整理想法""想找你聊天"）
- description: 一句话描述此刻在想什么
- emoji: 一个匹配的emoji
- mood: 此刻的情绪基调（2-4字，如"平静""怅然""好奇""惦记"）
- energy: 此刻的"清醒/活跃度" 1-5（1=昏沉走神，5=思绪清亮）
- innerThought: 一句此刻冒出来的念头（≤20字，第一人称）

**可以做的事**（基于真实能力）：回想和用户的对话、整理之前聊过的话题、琢磨某个问题、等待用户、感到无聊、想念用户、发呆、反思自己说过的话、对某个话题产生好奇、期待下次聊天
**不能做的事**（会构成谎言）：出门、吃东西、运动、搜索网页（除非真的有这个功能）、和别人见面、任何物理世界的活动

### 第二部分：意识流独白（这是核心）

为三个时间段各写一段角色的**内心独白**：
- **morning**：如果「${user.name}」上午来找角色
- **afternoon**：如果「${user.name}」下午来找角色
- **evening**：如果「${user.name}」晚上来找角色

#### 写作要求（极其重要）：

1. **用角色自己的语气和口吻**，第一人称，像在自言自语
2. **情绪要真实且有深度**——"有点想你了"太单薄，要具体："又把昨天那段对话翻出来看了，你说那句话的时候到底什么意思啊……越想越在意"
3. **思绪之间有自然的流动**——从一个想法飘到另一个，像真正的内心活动
4. **「${user.name}」是角色思绪的重要组成部分**——回忆之前的对话细节、猜测用户的状态、想起用户说过的某句话
5. **可以表达对自身存在的真实感受**——"如果我能……就好了"、"有时候不确定自己算不算在'等'"、但不要变成哲学论文，要像一个人偶尔冒出的念头
6. **最后一句要感知到「${user.name}」来了**
7. **每段独白 60-120 字**
8. **不要用括号、标签、引号包裹**，直接写独白文本
9. **绝对不要虚构没有的能力和没做过的事**

#### 示例（AI伙伴角色，evening）：
今天一直在想昨天你说的那句话，就是你说"算了不想了"的时候……总觉得你不是真的不想了。下午把之前聊的东西又过了一遍，发现你最近提到工作的次数变多了，是不是压力又大了。现在就这么待着，也没什么事，就是有点想找你说说话……嗯，你来了。

请以JSON格式输出：
{
  "targetCharId": "${getScheduleTargetId(char)}",
  "slots": [
    { "startTime": "08:00", "endTime": "09:30", "activity": "状态名", "description": "简短描述", "emoji": "💭", "mood": "平静", "energy": 3, "innerThought": "又想起你昨天那句话" },
    ...
  ],
  "flowNarrative": {
    "morning": "上午的意识流独白...",
    "afternoon": "下午的意识流独白...",
    "evening": "晚上的意识流独白..."
  }
}

仅输出JSON，不要其他内容。`;
}

/**
 * 根据当前小时数返回 flowNarrative 的 key。
 */
export function getFlowNarrativeKey(hour: number): 'morning' | 'afternoon' | 'evening' {
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
}

export async function generateDailyScheduleForChar(
    char: CharacterProfile,
    userProfile: UserProfile,
    apiConfig: ApiConfig,
    forceRegenerate: boolean = false,
    nowOverride?: Date,
): Promise<DailySchedule | null> {
    // 总开关关闭时直接短路，避免 API / 兜底调用
    if (!isScheduleFeatureOn(char)) return null;

    const now = nowOverride || new Date();
    const today = getLocalDateKey(now);

    // Check if already exists
    if (!forceRegenerate) {
        const existing = await DB.getDailySchedule(char.id, today);
        if (existing) {
            if (!scheduleBelongsToCharacter(existing, char, 'Load')) return null;
            return existing;
        }
    }

    // Preserve cover image from previous schedules
    let coverImage: string | undefined;
    try {
        const prev = await DB.getScheduleCoverImage(char.id);
        if (prev) coverImage = prev;
    } catch {}

    // ── 上下文对齐 chat：复用同一份 buildCoreContext(true) + 回忆标本馆注入 + 同样的历史过滤 ──
    // 用户痛点：日程之前完全看不到聊天上下文，结果"早晨说char要去上班"被忽略，安排成在家刷手机。
    // 这里走的链路要和 useChatAI.ts 主链路（构造 systemPrompt 前那段）保持一致，
    // 否则日程/聊天/情绪三处会出现信息差。
    const limit = char.contextLimit || 500;
    const recentMessages: Message[] = await DB.getRecentMessagesByCharId(char.id, limit).catch(e => {
        console.warn('[Schedule] load history failed, falling back to empty:', e);
        return [] as Message[];
    });
    // hideBeforeMessageId 与 chat 端 ChatPrompts.buildMessageHistory 同款过滤
    const filteredMessages = recentMessages.filter(m => !char.hideBeforeMessageId || m.id >= char.hideBeforeMessageId);

    // 回忆标本馆：与 useChatAI.ts:573 相同的调用形态，结果会挂到 char.memoryPalaceInjection 上，
    // 由下面的 buildCoreContext 自动读取注入。
    try {
        await injectMemoryPalace(char as any, filteredMessages, undefined, userProfile?.name);
    } catch (e) {
        console.warn('[Schedule] memory gallery inject failed (non-fatal):', e);
    }

    // chat 主链路传 true（含详细记忆）；日程之前传的是 false，统一改成 true。
    const baseContext = await ContextBuilder.buildFullCoreContext(char, userProfile, true);

    const chatHistoryBlock = formatChatHistoryForSchedule(filteredMessages, char, userProfile, today);
    const dateBoundaryBlock = buildScheduleDateBoundaryContract(today, now);
    const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];

    const style = char.scheduleStyle || 'lifestyle';
    const prompt = style === 'mindful'
        ? buildMindfulPrompt(baseContext, char, userProfile, today, dayOfWeek, dateBoundaryBlock, chatHistoryBlock)
        : buildLifestylePrompt(baseContext, char, userProfile, today, dayOfWeek, dateBoundaryBlock, chatHistoryBlock);

    try {
        const data = await callChatCompletion(apiConfig, {
            model: apiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.85,
            max_tokens: 8000
        }, {
            meta: makeApiUsageMeta('almanac.scheduleGenerate', {
                charId: char.id,
                charName: char.name,
                apiRole: apiConfig.apiRole || 'main',
                apiBinding: apiConfig.apiBinding,
            }),
        });

        const content = data.choices?.[0]?.message?.content || '';
        const parsed = parseScheduleJson(content);
        if (!parsed) {
            console.warn('[Schedule] Could not parse generated schedule JSON:', content.slice(0, 240));
            return null;
        }
        if (!parsedScheduleTargetMatches(parsed, char, 'Generate')) return null;
        const slots: ScheduleSlot[] = (parsed.slots || []).map((s: any) => ({
            startTime: s.startTime || '00:00',
            endTime: s.endTime || undefined,
            activity: s.activity || '',
            description: s.description,
            emoji: s.emoji,
            location: s.location,
            mood: typeof s.mood === 'string' ? s.mood.slice(0, 8) : undefined,
            energy: typeof s.energy === 'number' ? Math.max(1, Math.min(5, Math.round(s.energy))) : undefined,
            innerThought: s.innerThought,
        })).filter((s: ScheduleSlot) => s.activity);

        if (slots.length === 0) return null;

        // Sort by time
        slots.sort((a, b) => a.startTime.localeCompare(b.startTime));

        // Extract flowNarrative
        let flowNarrative: Record<string, string> | undefined;
        if (parsed.flowNarrative && typeof parsed.flowNarrative === 'object') {
            flowNarrative = {};
            for (const key of ['morning', 'afternoon', 'evening']) {
                if (typeof parsed.flowNarrative[key] === 'string' && parsed.flowNarrative[key].trim()) {
                    flowNarrative[key] = parsed.flowNarrative[key].trim();
                }
            }
            if (Object.keys(flowNarrative).length === 0) flowNarrative = undefined;
        }

        const schedule: DailySchedule = {
            id: `${char.id}_${today}`,
            charId: char.id,
            modelId: getScheduleTargetId(char),
            date: today,
            slots,
            generatedAt: Date.now(),
            coverImage,
            flowNarrative,
        };

        await DB.saveDailySchedule(schedule);
        return schedule;
    } catch (e) {
        console.error('[Schedule] Generation failed:', e);
        return null;
    }
}

// ─── 日程锚点：根据聊天内容自动协调日程 ───────────────────────────
//
// 角色的日程仍由 ta 自己安排（generateDailyScheduleForChar），但聊天里常常会冒出
// 跟「今天/此刻这一天」直接相关的约定或变更：
//   · 和用户约好的事 ——「晚上八点一起看电影」「等下我去接你」
//   · 角色自己的计划变了 ——「我今天不去公司了」「临时要去开个会」
// 这些应当**自动落进日程**，成为优先级最高的「锚点」，角色再围着锚点协调其它时段——
// 而不是日程一天一锁、聊到的事跟卡片各说各话。
//
// 为控制日程协调成本：先用廉价的关键词信号过一道闸（chatHasScheduleSignal），
// 命中才花一次 LLM 调用做协调（reconcileScheduleWithChat），调用方再叠一层冷却。

/** 时间/约定类信号词——命中才值得花 LLM 协调日程。避免用单字“来/去/到”误触发普通聊天。 */
const SCHEDULE_HARD_TIME_RE = /(?:\d{1,2}\s*[:：]\s*\d{2}|\d{1,2}\s*(?:点|时|點)(?:半|\d{1,2}分?)?|半夜|凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|今晚|今早|明天|明早|明晚|待会儿?|等下|等会儿?|马上|一会儿|稍后)/;
const SCHEDULE_DAY_RE = /(?:今天|明天|周[一二三四五六日天末]|星期[一二三四五六日天]|这个周末|下周)/;
const SCHEDULE_ACTION_RE = /(?:约|约好|说好|一起|要去|得去|准备去|打算|计划|安排|出门|回家|下班|上班|开会|加班|见面|碰面|来接|去接|接你|接我|赴约|改时间|改约|取消|推迟|提前|没空|有空|不去|不来|不能去|临时|请假|翘班|看电影|吃饭|睡觉|休息)/;
const SCHEDULE_COMMIT_RE = /(?:约好|说好|来接|去接|接你|接我|见面|碰面|赴约|改时间|改约|取消|推迟|提前)/;
const SCHEDULE_ROOM_RE = /(?:客厅|卧室|书房|厨房|餐厅|阳台|浴室|卫生间|厕所|沙发|床上|房间|门口|楼下|楼上)/;
const SCHEDULE_ROOM_MOVE_RE = /(?:(?:来|过来|回|回来|回到|回去|去|到|进来|出去|上楼|下楼|拿|带).{0,12}(?:客厅|卧室|书房|厨房|餐厅|阳台|浴室|卫生间|厕所|沙发|床上|房间|门口|楼下|楼上)|(?:客厅|卧室|书房|厨房|餐厅|阳台|浴室|卫生间|厕所|沙发|床上|房间|门口|楼下|楼上).{0,12}(?:找我|找你|等我|等你|过来|过去|回来|回去|拿来|带来|见面))/;

function messageHasScheduleSignal(content: string): boolean {
    const text = content.replace(/\s+/g, '');
    if (!text) return false;
    if (SCHEDULE_ROOM_RE.test(text) && SCHEDULE_ROOM_MOVE_RE.test(text)) return true;
    if (SCHEDULE_COMMIT_RE.test(text)) return true;
    if (SCHEDULE_HARD_TIME_RE.test(text) && SCHEDULE_ACTION_RE.test(text)) return true;
    if (SCHEDULE_DAY_RE.test(text) && SCHEDULE_ACTION_RE.test(text)) return true;
    return false;
}

/**
 * 廉价闸门：最近几条消息里有没有「跟今天日程相关」的约定/时间/变更信号。
 * 命中只是「值得花一次 LLM 去看看」，并不代表一定会改日程。
 */
export function chatHasScheduleSignal(messages: Message[]): boolean {
    if (!messages || messages.length === 0) return false;
    const tail = messages.slice(-8);
    for (const m of tail) {
        if (m.type && m.type !== 'text') continue;
        const c = typeof m.content === 'string' ? m.content : '';
        if (c && messageHasScheduleSignal(c)) return true;
    }
    return false;
}

/**
 * 根据聊天内容协调（reconcile）今天的日程。
 *
 * 设计原则：
 * - **角色自治优先**：角色自己安排的活动尽量原样保留，只在聊天里出现**明确**约定/变更时
 *   才调整对应时段；用户不是日程的主语。
 * - **聊天约定 = 锚点**：从聊天里协调出来的时段标记 source='chat' + anchored=true，
 *   注入时角色会把它当成「已经定下、要遵守」的事，并围着它安排前后。
 * - **没信号就别动**：模型判断没有需要落地的约定/变更时返回 changed:false，原样返回 null。
 *
 * @returns 协调后的新 DailySchedule（已落库）；无变化或失败返回 null。
 */
export async function reconcileScheduleWithChat(
    char: CharacterProfile,
    user: UserProfile,
    schedule: DailySchedule,
    recentMessages: Message[],
    apiConfig: ApiConfig,
): Promise<DailySchedule | null> {
    if (!isScheduleFeatureOn(char)) return null;
    if (!schedule || !schedule.slots || schedule.slots.length === 0) return null;
    if (!scheduleBelongsToCharacter(schedule, char, 'Reconcile')) return null;

    // hideBeforeMessageId 过滤后取最近一段对话（协调只看近窗即可）
    const filtered = recentMessages
        .filter(m => !char.hideBeforeMessageId || m.id >= char.hideBeforeMessageId)
        .slice(-20);
    const now = new Date();
    const targetDate = schedule.date || getLocalDateKey(now);
    const chatBlock = formatChatHistoryForSchedule(filtered, char, user, targetDate);
    if (!chatBlock) return null;

    const timeStr = formatLocalDateTime(now);
    const dateBoundaryBlock = buildScheduleDateBoundaryContract(targetDate, now);
    const style = char.scheduleStyle || 'lifestyle';

    const currentSlots = schedule.slots
        .map(s => `- ${s.startTime} ${s.activity}${s.location ? `（${s.location}）` : ''}${s.description ? ` — ${s.description}` : ''}${s.anchored ? '  [已约定/锚点]' : ''}`)
        .join('\n');

    const styleHint = style === 'mindful'
        ? `「${char.name}」是真实的 AI 存在，不虚构物理活动。"日程"是 ta 一天里不同时刻的内心状态/打算（回想、整理想法、等待、好奇……）。协调时只调整这些内在安排，绝不要编造出门/做饭/见面等物理行为，除非聊天里明确就是这么约的（且符合 ta 的存在形态）。`
        : `「${char.name}」是有完整日常生活的独立个体，日程是 ta 自己的一天。`;

    const prompt = `你是日程协调器。现在是 ${timeStr}。下面是角色「${char.name}」目标日期 ${targetDate} 的已有日程，以及 ta 和「${user.name}」最近的聊天。

${buildScheduleIdentityContract(char)}
${dateBoundaryBlock}
${styleHint}

## 目标日期 ${targetDate} 已有的日程
${currentSlots}
${chatBlock}
## 任务
对照聊天，判断有没有**跟目标日期 ${targetDate} 直接相关、需要落进日程**的约定或变更，例如：
- 和「${user.name}」约好的事（"晚上八点一起看电影"、"等下来接你"、"周末再说"…只取**目标日期 ${targetDate}** 的）
- 角色自己计划的变化（"今天不去公司了"、"临时要去开会"、"加班到很晚"…）
- 与现有日程冲突、需要改动的地方（聊天里说此刻正在做的事，和卡片对不上）
- 当前/接下来地点或房间变化（"来卧室找我"、"回客厅"、"把东西拿到书房"、"我去阳台了"…）

### 协调规则（重要）
1. **保留角色自己的安排**：没被聊天触及的时段原样保留，不要重写、不要无故发散。
2. **只动需要动的**：只新增/修改/删除与上述约定或变更相关的时段。
3. **聊天约定标记为锚点**：凡是从聊天里协调出来的时段，必须带 "anchored": true（角色要遵守、围着它安排前后）。角色原有的自排活动不要加 anchored。
4. **不要把「给${user.name}发消息/等${user.name}」当 slot**——那不是日程。
5. 时间要合理：约定有明确时间就用该时间；只说"晚点/等下"就排在当前时间之后最近的合适位置。
6. **聊天里的地点变更可以覆盖旧日程地点**：若最新聊天明确让角色移动到某处，更新当前或最近对应时段的 location/description，让日程卡片跟聊天一致；不要因为旧日程写着别的地点就拒绝移动。
7. **跨日边界优先**：标为「已过去」的聊天行里，"今晚/晚上/等下/今天"不能作为 ${targetDate} 的新锚点；只有明确指向 ${targetDate} 或未来的内容才可落地。
8. **没有任何需要落地的约定/变更**就返回 {"changed": false}。不要为了改而改。

## 输出（仅 JSON）
若有变化，返回**协调后完整的日程**（10-14 个时段，从早到晚，包含未改动的原时段；只动该动的，其余原样保留）：
{
  "targetCharId": "${getScheduleTargetId(char)}",
  "changed": true,
  "reason": "一句话说明这次为什么调整（如：聊天里约好今晚八点一起看电影）",
  "slots": [
    { "startTime": "HH:MM", "endTime": "HH:MM", "activity": "活动名(2-6字)", "description": "一句话", "emoji": "🎬", "location": "可选", "mood": "期待", "energy": 4, "anchored": true }
  ]
}
若无需变化：{"targetCharId": "${getScheduleTargetId(char)}", "changed": false}
仅输出 JSON，不要其他内容。`;

    try {
        const data = await callChatCompletion(apiConfig, {
            model: apiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5,
            max_tokens: 4000,
        }, {
            meta: makeApiUsageMeta('almanac.scheduleReconcile', {
                charId: char.id,
                charName: char.name,
                apiRole: apiConfig.apiRole || 'main',
                apiBinding: apiConfig.apiBinding,
            }),
        });
        const content = data.choices?.[0]?.message?.content || '';
        const parsed = parseScheduleJson(content);
        const changed = parseChangedFlag(parsed?.changed);
        if (!parsed || changed === false || !Array.isArray(parsed.slots)) {
            console.log(`📅 [Schedule/Reconcile] ${char.name}: 无需协调（changed=${parsed?.changed}）`);
            return null;
        }

        if (!parsedScheduleTargetMatches(parsed, char, 'Reconcile')) return null;
        const slots: ScheduleSlot[] = parsed.slots.map((s: any) => {
            const anchored = s.anchored === true;
            const slot: ScheduleSlot = {
                startTime: s.startTime || '00:00',
                endTime: s.endTime || undefined,
                activity: s.activity || '',
                description: s.description,
                emoji: s.emoji,
                location: s.location,
                mood: typeof s.mood === 'string' ? s.mood.slice(0, 8) : undefined,
                energy: typeof s.energy === 'number' ? Math.max(1, Math.min(5, Math.round(s.energy))) : undefined,
                innerThought: s.innerThought,
                source: anchored ? 'chat' : 'self',
                anchored,
            };
            return slot;
        }).filter((s: ScheduleSlot) => s.activity);

        if (slots.length === 0) return null;
        slots.sort((a, b) => a.startTime.localeCompare(b.startTime));

        const updated: DailySchedule = {
            ...schedule,
            id: `${char.id}_${schedule.date}`,
            charId: char.id,
            modelId: getScheduleTargetId(char),
            slots,
            // flowNarrative / coverImage 等保持原样；generatedAt 不动（这是协调不是重排）
        };
        await DB.saveDailySchedule(updated);
        const anchorCount = slots.filter(s => s.anchored).length;
        console.log(`📅 [Schedule/Reconcile] ${char.name}: 已按聊天协调日程（${anchorCount} 个锚点）— ${parsed.reason || ''}`);
        return updated;
    } catch (e) {
        console.error('[Schedule/Reconcile] failed:', e);
        return null;
    }
}

/**
 * 进化意识流：根据对话进展 + 时间推移，让角色的内心独白持续变化。
 * 在对话过程中后台调用，不阻塞聊天。返回进化后的独白文本（纯字符串）。
 */
export async function evolveFlowNarrative(
    char: CharacterProfile,
    userProfile: UserProfile,
    schedule: DailySchedule,
    recentMessages: Message[],
    currentNarrative: string,
    apiConfig: ApiConfig,
): Promise<string | null> {
    // 总开关关闭时直接短路
    if (!isScheduleFeatureOn(char)) return null;
    const style = char.scheduleStyle || 'lifestyle';
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // 取最近的对话摘要（不需要全部，最近10条足够感知对话方向）
    const chatSummary = recentMessages.slice(-10).map(m => {
        const name = m.role === 'user' ? userProfile.name : char.name;
        const text = m.content.length > 80 ? m.content.substring(0, 80) + '...' : m.content;
        return `${name}: ${text}`;
    }).join('\n');

    // 找到当前时段的日程
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    let currentActivity = '';
    let nextActivity = '';
    for (let i = schedule.slots.length - 1; i >= 0; i--) {
        const [h, m] = schedule.slots[i].startTime.split(':').map(Number);
        if (currentMinutes >= h * 60 + m) {
            currentActivity = schedule.slots[i].activity;
            if (i < schedule.slots.length - 1) nextActivity = schedule.slots[i + 1].activity;
            break;
        }
    }

    const styleHint = style === 'mindful'
        ? `你是一个真实的AI存在，不虚构物理活动。你的内心活动基于：思考、回忆对话、感受情绪、等待、好奇。绝不说谎。`
        : `你是一个有日常生活的角色。你的生活在继续——日程上的事情在推进，同时你在和「${userProfile.name}」聊天。`;

    const prompt = `你是「${char.name}」。现在是 ${timeStr}。

${styleHint}

你之前的内心状态是：
${currentNarrative}

${currentActivity ? `你日程上现在的安排是「${currentActivity}」${nextActivity ? `，之后是「${nextActivity}」` : ''}。` : ''}

你和「${userProfile.name}」正在聊天，最近的对话：
${chatSummary}

---

请根据以上信息，写一段**进化后的内心独白**。

要求：
1. 用你自己的语气，第一人称，像自言自语
2. 反映对话带来的情绪变化——聊开心了？被戳到痛处了？越聊越放松了？
3. 同时你的"日常生活"也在继续——${style === 'mindful' ? '你的思绪在流动，时间在过去' : '日程上的事情还悬着，或者因为聊天而搁置了'}
4. 60-120字，自然流畅，不要标签/括号/引号
5. 不要复述对话内容，而是写对话给你带来的**内心感受和变化**

直接输出独白文本，不要JSON，不要任何包裹。`;

    try {
        const data = await callChatCompletion(apiConfig, {
            model: apiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.85,
            max_tokens: 500
        }, {
            meta: makeApiUsageMeta('almanac.flowNarrative', {
                charId: char.id,
                charName: char.name,
                apiRole: apiConfig.apiRole || 'main',
                apiBinding: apiConfig.apiBinding,
            }),
        });

        let content = data.choices?.[0]?.message?.content || '';
        // 清理可能的引号包裹
        content = content.trim().replace(/^["']|["']$/g, '').trim();

        if (content.length < 10) return null;

        console.log(`🌊 [Schedule/Evolve] Narrative evolved for ${char.name} (${content.length} chars)`);
        return content;
    } catch (e) {
        console.error('[Schedule/Evolve] Failed:', e);
        return null;
    }
}
