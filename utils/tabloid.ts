import { CharacterProfile, UserProfile, Message, Tabloid } from '../types';
import { DB } from './db';
import { safeResponseJson, extractContent } from './safeApi';

/**
 * 回顾摘要（日回顾 / 周回顾 / 月回顾）。
 *
 * 把过去一天 / 一周 / 一月里你们之间真实发生的事（聊天、角色的离线碎碎念、日记、
 * 朋友圈/动态、拍下的照片、临近的纪念日）整理成一份关系回顾摘要。素材全部来自真实记录，
 * 不凭空编造。开关在会话设置 convoSettings.tabloidEnabled。
 *
 * 生成结果缓存在 char.generatedTabloids[key]（同一天/周/月复用，可手动重做）。
 */

export type TabloidPeriod = 'day' | 'week' | 'month';

export interface TabloidApi { baseUrl: string; apiKey: string; model: string }

const DAY_MS = 24 * 60 * 60 * 1000;

export const TABLOID_META: Record<TabloidPeriod, { label: string; en: string; sub: string; spanMs: number; windowLabel: string }> = {
    day:   { label: '日回顾', en: 'DAILY RECAP', sub: '整理过去一天的聊天与日常', spanMs: DAY_MS,       windowLabel: '过去这一天' },
    week:  { label: '周回顾', en: 'WEEKLY RECAP', sub: '整理过去一周的聊天与日常', spanMs: 7 * DAY_MS,  windowLabel: '过去这一周' },
    month: { label: '月回顾', en: 'MONTHLY RECAP', sub: '整理过去一月的聊天与日常', spanMs: 30 * DAY_MS, windowLabel: '过去这一个月' },
};

/** 周期缓存键：同一天/同一周/同一月复用同一份回顾 */
export const tabloidKey = (period: TabloidPeriod, ref: number = Date.now()): string => {
    const d = new Date(ref);
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    if (period === 'day') return `day-${y}-${mm}-${String(d.getDate()).padStart(2, '0')}`;
    if (period === 'month') return `month-${y}-${mm}`;
    // week：当年第几周（粗粒度，足够做缓存键）
    const start = new Date(y, 0, 1).getTime();
    const week = Math.floor((ref - start) / (7 * DAY_MS)) + 1;
    return `week-${y}-W${String(week).padStart(2, '0')}`;
};

interface TabloidApiOpts { temperature?: number }
const callLLM = async (api: TabloidApi, prompt: string, opts: TabloidApiOpts = {}): Promise<string> => {
    const res = await fetch(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey}` },
        body: JSON.stringify({ model: api.model, messages: [{ role: 'user', content: prompt }], temperature: opts.temperature ?? 0.92 }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (extractContent(await safeResponseJson(res)) || '').trim();
};

/** 单条消息压成一行可读摘要（媒体类不内联原始数据） */
const summarizeMsg = (m: Message): string => {
    const meta = (m.metadata as any) || {};
    switch (m.type) {
        case 'image': return '[一张照片]';
        case 'emoji': return '[一个表情]';
        case 'voice': return meta.transcript ? `[语音] ${String(meta.transcript).slice(0, 60)}` : '[一条语音]';
        case 'transfer': return meta.kind === 'redpacket' ? `[发了个红包${meta.amount ?? ''}]` : `[转账${meta.amount ?? ''}]`;
        case 'location': return `[分享了位置${m.content ? '：' + m.content : ''}]`;
        case 'call_log': return '[一通电话]';
        default: {
            const c = typeof m.content === 'string' ? m.content : '';
            if (/^(data:|https?:\/\/)/i.test(c.trim())) return '[一段内容]';
            return c.length > 160 ? c.slice(0, 160) + '…' : c;
        }
    }
};

/** 收集某段时间窗口里你们之间真实发生的素材，拼成一份给 LLM 的回顾素材 */
const gatherDigest = async (char: CharacterProfile, user: UserProfile, from: number, to: number): Promise<{ digest: string; hasMaterial: boolean }> => {
    const inRange = (ts: number) => typeof ts === 'number' && ts >= from && ts < to;

    const [msgs, lifeEvents, diaries, social, gallery, annivs] = await Promise.all([
        DB.getMessagesByCharId(char.id).catch(() => [] as Message[]),
        DB.getLifeEvents(char.id).catch(() => [] as any[]),
        DB.getDiariesByCharId(char.id).catch(() => [] as any[]),
        DB.getSocialPosts().catch(() => [] as any[]),
        DB.getGalleryImages(char.id).catch(() => [] as any[]),
        DB.getAllAnniversaries().catch(() => [] as any[]),
    ]);

    const chat = msgs
        .filter(m => m.role !== 'system' && inRange(m.timestamp))
        .map(m => `${m.role === 'user' ? user.name : char.name}：${summarizeMsg(m)}`)
        .slice(-150);

    const events = (lifeEvents || [])
        .filter((e: any) => inRange(e.timestamp))
        .map((e: any) => `· ${e.activity || e.summary || ''}${e.mood ? `（心情：${e.mood}）` : ''}${e.location ? ` @${e.location}` : ''}`)
        .slice(0, 30);

    const diaryLines = (diaries || [])
        .filter((d: any) => inRange(d.timestamp) || (d.date && inRange(new Date(d.date).getTime())))
        .map((d: any) => `· ${d.date || ''}：${String(d.charPage || d.userPage || '').slice(0, 120)}`)
        .slice(0, 12);

    const posts = (social || [])
        .filter((p: any) => inRange(p.timestamp) && (p.authorCharId === char.id || !p.authorCharId || p.authorName === char.name || p.authorName === user.name))
        .map((p: any) => `· ${p.authorName}：${String(p.content || p.title || '').slice(0, 100)}${p.images?.length ? `（配图${p.images.length}张）` : ''}`)
        .slice(0, 15);

    const photos = (gallery || [])
        .filter((g: any) => inRange(g.timestamp))
        .map((g: any) => `· 一张照片${g.review ? `，TA 当时的点评：${String(g.review).slice(0, 80)}` : ''}`)
        .slice(0, 12);

    // 临近的纪念日（窗口内或紧随其后 30 天）——给回顾一点提醒。
    const nowYear = new Date(to).getFullYear();
    const upcoming = (annivs || [])
        .map((a: any) => {
            const md = String(a.date || '').slice(5); // MM-DD
            const t = new Date(`${nowYear}-${md}`).getTime();
            return { title: a.title, t };
        })
        .filter(a => !isNaN(a.t) && a.t >= from && a.t < to + 30 * DAY_MS)
        .map(a => `· ${new Date(a.t).toLocaleDateString()} ${a.title}`)
        .slice(0, 6);

    const blocks: string[] = [];
    if (chat.length) blocks.push(`【你们的聊天片段】\n${chat.join('\n')}`);
    if (events.length) blocks.push(`【${char.name} 的日常碎碎念（离线生活）】\n${events.join('\n')}`);
    if (diaryLines.length) blocks.push(`【日记】\n${diaryLines.join('\n')}`);
    if (posts.length) blocks.push(`【动态 / 朋友圈】\n${posts.join('\n')}`);
    if (photos.length) blocks.push(`【相册里新增的照片】\n${photos.join('\n')}`);
    if (upcoming.length) blocks.push(`【临近的纪念日】\n${upcoming.join('\n')}`);

    return { digest: blocks.join('\n\n'), hasMaterial: chat.length + events.length + diaryLines.length + posts.length + photos.length > 0 };
};

const safeParseTabloid = (raw: string): Partial<Tabloid> | null => {
    const clean = (raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
    let obj = tryParse(clean);
    if (!obj) {
        const s = clean.indexOf('{'); const e = clean.lastIndexOf('}');
        if (s >= 0 && e > s) obj = tryParse(clean.slice(s, e + 1));
    }
    if (!obj || typeof obj !== 'object') return null;
    const sections = Array.isArray(obj.sections)
        ? obj.sections.filter((x: any) => x && (x.title || x.body)).map((x: any) => ({
            tag: String(x.tag || '版块').slice(0, 12),
            title: String(x.title || '').slice(0, 80),
            body: String(x.body || '').slice(0, 600),
            quote: typeof x.quote === 'string' ? x.quote.slice(0, 160) : undefined,
        })).slice(0, 6)
        : [];
    return {
        headline: String(obj.headline || '').slice(0, 80),
        subhead: typeof obj.subhead === 'string' ? obj.subhead.slice(0, 120) : undefined,
        editorNote: typeof obj.editorNote === 'string' ? obj.editorNote.slice(0, 400) : undefined,
        sections,
        sidebar: Array.isArray(obj.sidebar) ? obj.sidebar.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.slice(0, 120)).slice(0, 6) : undefined,
        signoff: typeof obj.signoff === 'string' ? obj.signoff.slice(0, 120) : undefined,
    };
};

/** 生成一份回顾摘要（不写库，由调用方决定缓存到 char.generatedTabloids） */
export const generateTabloid = async (
    char: CharacterProfile, user: UserProfile, api: TabloidApi, period: TabloidPeriod,
): Promise<Tabloid> => {
    const to = Date.now();
    const from = to - TABLOID_META[period].spanMs;
    const { digest, hasMaterial } = await gatherDigest(char, user, from, to);
    const meta = TABLOID_META[period];

    const persona = [
        `整理者：${char.name}`,
        char.systemPrompt ? `角色设定（决定回顾的语气）：${String(char.systemPrompt).slice(0, 800)}` : '',
    ].filter(Boolean).join('\n');

    const prompt = `### 任务
你是「${char.name}」，要把${meta.windowLabel}和「${user.name}」之间真实发生的点滴整理成一份**关系回顾摘要**。
这份回顾由你亲自整理，语气自然、亲近、克制，有温度，也要能看出你自己的感受。

${persona}

### 这期可用的真实素材（${new Date(from).toLocaleDateString()} ~ ${new Date(to).toLocaleDateString()}）
${digest || '（这段时间几乎没有新鲜事——你们没怎么联系，记录也很少。）'}

### 写作要求
1. 所有内容必须基于上面的真实素材，不能编造没发生过的事。
2. 用第一人称「我」（${char.name}）整理，字里行间能看出你对${user.name}的态度和情绪。
3. 如果素材很少，就坦诚说明这段时间记录不多，可以轻轻带一点想念或遗憾，不要硬编。
4. 1~4 个栏目，每个栏目一个简短标题 + 一段正文，可选配一句印象深的原话或总结。
5. sidebar 写成几条补充记录或待留意的小事；signoff 写一句自然的收尾。

### 输出（只输出一个 JSON 对象，不要任何额外文字）
{"headline":"回顾标题","subhead":"简短说明","editorNote":"开场摘要(50-120字)","sections":[{"tag":"分类","title":"栏目标题","body":"栏目正文(60-180字)","quote":"可选原话或总结"}],"sidebar":["补充记录1","补充记录2"],"signoff":"结尾签名"}`;

    const raw = await callLLM(api, prompt);
    const parsed = safeParseTabloid(raw);
    if (!parsed || !parsed.headline) throw new Error('回顾解析失败，请重试');

    return {
        period,
        headline: parsed.headline,
        subhead: parsed.subhead,
        editorNote: parsed.editorNote,
        sections: parsed.sections && parsed.sections.length ? parsed.sections : [{ tag: '摘要', title: '这一期', body: parsed.editorNote || '这段日子记录不多。', quote: undefined }],
        sidebar: parsed.sidebar,
        signoff: parsed.signoff,
        rangeFrom: from,
        rangeTo: to,
        generatedAt: Date.now(),
    };
};
