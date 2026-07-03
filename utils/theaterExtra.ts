/**
 * 折子戏·番外 —— 生成逻辑（走副 API）。
 * ============================================
 * 提供几类「番外」内容的生成：
 *  - 问卷番外：系统一题一题出题（恋爱相性100问 / MBTI / 价值观 / 性癖 / 无厘头…，
 *    用户输入想要的问卷名即可），角色作答 + 用户作答，做完为止；
 *  - 贴吧/论坛帖番外、聊天记录番外、热梗番外：一次性生成一段主题内容。
 *
 * 纯函数，UI 在 apps/theater/ExtraApp.tsx。失败抛错由调用方兜底。
 * 📌 全部 prompt 文案集中在 utils/theaterPrompts.ts（[贰] 番外 区段），改文案去那里。
 */

import type {
    CharacterProfile, UserProfile, FauxScreenData, TheaterFauxKind,
    TheaterQuizResult, TheaterQuizResultDimension, TheaterQuizSession, TheaterQuizSettings,
} from '../types';
import type { ResolvedApi } from './auxApi';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { extractJson } from './safeApi';
import { llmComplete } from './llmComplete';
import {
    EXTRA_QUIZ_QUESTION_SYS, extraQuizQuestionUser, extraQuizAnswerSys, extraQuizAnswerUser,
    extraQuizCommentSys, extraQuizCommentUser,
    EXTRA_QUIZ_HOST_SYS, extraQuizHostUser, extraQuizPeerReviewSys, extraQuizPeerReviewUser,
    EXTRA_QUIZ_RESULT_SYS, extraQuizResultUser,
    extraPiecePrompt, extraFauxPrompt,
    type ExtraWorkshopOptions,
} from './theaterPrompts';

export const DEFAULT_THEATER_QUIZ_SETTINGS: TheaterQuizSettings = {
    flow: 'interview_test',
    hostEnabled: true,
    peerReviewEnabled: true,
    resultEnabled: true,
    contentScale: 'mixed',
};

export const LEGACY_THEATER_QUIZ_SETTINGS: TheaterQuizSettings = {
    flow: 'classic',
    hostEnabled: false,
    peerReviewEnabled: false,
    resultEnabled: false,
    contentScale: 'mixed',
};

export function normalizeTheaterQuizSession(session: TheaterQuizSession): TheaterQuizSession {
    const settings = session.settings
        ? { ...DEFAULT_THEATER_QUIZ_SETTINGS, ...session.settings }
        : LEGACY_THEATER_QUIZ_SETTINGS;
    return {
        ...session,
        settings,
        items: (session.items || []).map(item => ({
            ...item,
            answers: item.answers || {},
            comments: item.comments || [],
            state: item.state || 'answering',
        })),
    };
}

/** 聊天补全（去思维链，按需续写）。短问答 / JSON 不续写；长篇番外传 continueRounds 自动写完。 */
async function chat(api: ResolvedApi, messages: { role: string; content: string }[], opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal; continueRounds?: number }): Promise<string> {
    return llmComplete(api, messages, {
        temperature: opts?.temperature ?? 0.9,
        maxTokens: opts?.maxTokens ?? 900,
        continueRounds: opts?.continueRounds,
        signal: opts?.signal,
        meta: makeApiUsageMeta('theater.extra', {
            apiRole: api.apiRole || 'aux',
            apiBinding: api.apiBinding,
        }),
    });
}

/** 从问卷名里尽量解析题量（如「恋爱相性100问」「性癖测试50题」），解析不到给 50（且不少于 50）。 */
export function inferQuestionCount(topic: string, fallback = 50): number {
    const m = (topic || '').match(/(\d{1,3})\s*(?:问|题|道|个)/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (isFinite(n) && n > 0) return Math.min(Math.max(n, 1), 200);
    }
    return Math.max(fallback, 50);
}

/** 去掉模型给题目带的序号/引号/前缀，只留题干。 */
function cleanQuestion(s: string): string {
    return (s || '')
        .replace(/^\s*(?:第?\s*\d+\s*[\.、:：)）]\s*|[-*•]\s*|Q\d*[\.:：]?\s*)/i, '')
        .replace(/^["'“”]+|["'“”]+$/g, '')
        .trim();
}

/**
 * 出下一题。基于问卷主题 + 已出过的题（避免重复），一次只出一题。
 */
export async function genNextQuestion(args: {
    api: ResolvedApi; topic: string; index: number; total: number; asked: string[];
    /** 你写好的题库题目（来自 theaterExtraBank）。本题在范围内就直接取，不走 AI。 */
    bankQuestions?: string[];
    signal?: AbortSignal;
}): Promise<string> {
    const { api, topic, index, total, asked, bankQuestions, signal } = args;
    // 题库优先：本题落在你写的题库范围内，就直接用你的题，不调用 AI 出题。
    if (bankQuestions && index < bankQuestions.length) {
        const q = cleanQuestion(bankQuestions[index] || '');
        if (q) return q;
    }
    const recent = asked.slice(-12).map((q, i) => `${asked.length - Math.min(12, asked.length) + i + 1}. ${q}`).join('\n');
    // ⚠️ 推理模型会先在 <think> 里吃掉 token，预算太小正文（题目）就被截没了。给足预算 + 截断自动续写。
    const raw = await chat(api, [
        { role: 'system', content: EXTRA_QUIZ_QUESTION_SYS },
        { role: 'user', content: extraQuizQuestionUser({ topic, index, total, recent }) },
    ], { temperature: 0.95, maxTokens: 800, continueRounds: 2, signal });
    return cleanQuestion(raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || raw) || `（第 ${index + 1} 题生成失败，点重试）`;
}

/** 角色按人设作答某一题。 */
export async function genCharAnswer(args: {
    api: ResolvedApi; char: CharacterProfile; userProfile: UserProfile; topic: string; question: string; signal?: AbortSignal;
}): Promise<string> {
    const { api, char, userProfile, topic, question, signal } = args;
    const userName = (userProfile?.name || '').trim() || '对方';
    // ⚠️ 角色作答被截断显示半句（见 docs/divination-and-faux 同款坑）：推理模型先在 <think> 里耗预算，
    // 800 token 常只够吐半句正文。给足预算并在被长度截断时自动续写写完，避免「回答显示不全」。
    return (await chat(api, [
        { role: 'system', content: extraQuizAnswerSys({ charName: char.name, topic, description: char.systemPrompt || '', userName }) },
        { role: 'user', content: extraQuizAnswerUser({ charName: char.name, question }) },
    ], { temperature: 0.9, maxTokens: 1200, continueRounds: 3, signal })) || '……（TA 没说话）';
}

/** 角色在问卷某题的评论区继续接话。 */
export async function genCharComment(args: {
    api: ResolvedApi;
    char: CharacterProfile;
    userProfile: UserProfile;
    topic: string;
    question: string;
    userAnswer?: string;
    charAnswer?: string;
    recentComments?: { speakerName: string; text: string }[];
    userComment?: string;
    signal?: AbortSignal;
}): Promise<string> {
    const { api, char, userProfile, topic, question, userAnswer, charAnswer, recentComments, userComment, signal } = args;
    const userName = (userProfile?.name || '').trim() || '对方';
    const recent = (recentComments || []).slice(-8).map(c => `${c.speakerName}：${c.text}`).join('\n');
    const raw = await chat(api, [
        { role: 'system', content: extraQuizCommentSys({ charName: char.name, topic, description: char.systemPrompt || '', userName }) },
        {
            role: 'user',
            content: extraQuizCommentUser({
                question,
                userName,
                userAnswer: userAnswer || '',
                charName: char.name,
                charAnswer: charAnswer || '',
                recentComments: recent,
                userComment,
            }),
        },
    ], { temperature: 0.9, maxTokens: 700, continueRounds: 1, signal });
    return raw.replace(/^["'“”]+|["'“”]+$/g, '').trim() || '……我先记下这句。';
}

/** 访谈测试模式下，每题前生成一条主持转场。 */
export async function genQuizHostNote(args: {
    api: ResolvedApi;
    topic: string;
    index: number;
    total: number;
    question: string;
    participantNames: string[];
    previousQuestion?: string;
    signal?: AbortSignal;
}): Promise<string> {
    const { api, topic, index, total, question, participantNames, previousQuestion, signal } = args;
    const raw = await chat(api, [
        { role: 'system', content: EXTRA_QUIZ_HOST_SYS },
        { role: 'user', content: extraQuizHostUser({ topic, index, total, question, participantNames: participantNames.join('、'), previousQuestion }) },
    ], { temperature: 0.85, maxTokens: 300, continueRounds: 1, signal });
    return raw.replace(/^["'“”]+|["'“”]+$/g, '').trim().split(/\r?\n/).find(Boolean) || '主持人把题卡翻过来，笑着看向大家。';
}

/** 角色回应另一个参与者的答案：可回应 user，也可角色互评。 */
export async function genCharPeerReview(args: {
    api: ResolvedApi;
    char: CharacterProfile;
    userProfile: UserProfile;
    topic: string;
    question: string;
    speakerAnswer?: string;
    targetName: string;
    targetAnswer?: string;
    recentComments?: { speakerName: string; text: string }[];
    signal?: AbortSignal;
}): Promise<string> {
    const { api, char, userProfile, topic, question, speakerAnswer, targetName, targetAnswer, recentComments, signal } = args;
    const userName = (userProfile?.name || '').trim() || '对方';
    const recent = (recentComments || []).slice(-8).map(c => `${c.speakerName}：${c.text}`).join('\n');
    const raw = await chat(api, [
        { role: 'system', content: extraQuizPeerReviewSys({ charName: char.name, topic, description: char.systemPrompt || '', userName }) },
        {
            role: 'user',
            content: extraQuizPeerReviewUser({
                question,
                speakerName: char.name,
                speakerAnswer: speakerAnswer || '',
                targetName,
                targetAnswer: targetAnswer || '',
                recentComments: recent,
            }),
        },
    ], { temperature: 0.9, maxTokens: 750, continueRounds: 1, signal });
    return raw.replace(/^["'“”]+|["'“”]+$/g, '').trim() || '……这句我先记下了。';
}

const clampScore = (value: unknown, fallback = 70) => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
};

const cleanTextArray = (value: unknown, fallback: string[]): string[] => {
    const arr = Array.isArray(value) ? value.map(v => String(v || '').trim()).filter(Boolean) : [];
    return arr.length ? arr.slice(0, 5) : fallback;
};

const defaultDimensions = (): TheaterQuizResultDimension[] => [
    { key: 'chemistry', label: '默契度', score: 72, summary: '有来有回，仍有一些值得继续确认的小暗号。' },
    { key: 'security', label: '安全感', score: 70, summary: '在意是明显的，只是表达方式还带着各自的习惯。' },
    { key: 'daily', label: '日常适配', score: 74, summary: '日常相处有画面感，适合从小事里慢慢磨合。' },
    { key: 'future', label: '未来感', score: 68, summary: '未来感已经冒头，但还需要更多共同计划落地。' },
];

export function parseQuizResult(raw: string): TheaterQuizResult {
    const parsed = extractJson(raw);
    const obj = isRecord(parsed) ? parsed : {};
    const dimsRaw = Array.isArray(obj.dimensions) ? obj.dimensions : [];
    const dimensions = dimsRaw.slice(0, 6).map((item, i): TheaterQuizResultDimension => {
        const d = isRecord(item) ? item : {};
        const fallback = defaultDimensions()[i] || { key: `d${i + 1}`, label: `维度 ${i + 1}`, score: 70, summary: '这一项还有继续观察的空间。' };
        return {
            key: String(d.key || fallback.key),
            label: String(d.label || fallback.label),
            score: clampScore(d.score, fallback.score),
            summary: String(d.summary || fallback.summary),
        };
    });
    const fallbackText = isRecord(parsed) ? undefined : raw.trim();
    return {
        generatedAt: Date.now(),
        title: String(obj.title || '番外问卷画像报告'),
        summary: String(obj.summary || fallbackText || '这份问卷更像一张关系快照：有默契，也有还想继续追问的地方。'),
        totalScore: clampScore(obj.totalScore, 72),
        dimensions: dimensions.length ? dimensions : defaultDimensions(),
        highlights: cleanTextArray(obj.highlights, ['答案里有明显的在意和偏心。', '彼此的日常想象有重叠。', '轻松题和认真题都能接住。']),
        frictions: cleanTextArray(obj.frictions, ['有些安全感需求需要更直接地说出口。', '表达方式不同，容易在玩笑里藏真话。']),
        suggestions: cleanTextArray(obj.suggestions, ['挑一道最在意的题继续聊。', '把一个共同计划落到现实小事上。', '下次用朋友局或吵架复盘题库换个角度看。']),
        fallbackText,
    };
}

const quizTranscript = (session: TheaterQuizSession, namesById: Record<string, string>, userName: string): string => (
    session.items.slice(0, 40).map((item, i) => {
        const lines = [`${i + 1}. ${item.question}`];
        if (item.hostNote) lines.push(`主持：${item.hostNote}`);
        lines.push(`${userName}：${item.answers?.user?.text || '（跳过）'}`);
        for (const id of session.participantIds) {
            lines.push(`${namesById[id] || item.answers?.[id]?.speakerName || '角色'}：${item.answers?.[id]?.text || '（未答）'}`);
        }
        const comments = (item.comments || []).slice(-6).map(cm => `${cm.speakerName}：${cm.text}`);
        if (comments.length) lines.push(`评论：${comments.join(' / ')}`);
        return lines.join('\n');
    }).join('\n\n')
);

/** 完成问卷后生成娱乐向画像报告。 */
export async function genQuizResult(args: {
    api: ResolvedApi;
    session: TheaterQuizSession;
    participantNamesById: Record<string, string>;
    userProfile: UserProfile;
    signal?: AbortSignal;
}): Promise<TheaterQuizResult> {
    const { api, session, participantNamesById, userProfile, signal } = args;
    const userName = (userProfile?.name || '').trim() || '你';
    const participantNames = [userName, ...session.participantIds.map(id => participantNamesById[id]).filter(Boolean)].join('、');
    const raw = await chat(api, [
        { role: 'system', content: EXTRA_QUIZ_RESULT_SYS },
        { role: 'user', content: extraQuizResultUser({ topic: session.topic, participantNames, transcript: quizTranscript(session, participantNamesById, userName) }) },
    ], { temperature: 0.78, maxTokens: 1800, continueRounds: 2, signal });
    return parseQuizResult(raw);
}

export type ExtraKind =
    | 'tieba'
    | 'chatlog'
    | 'meme'
    | 'interview'
    | 'barrage'
    | 'diary'
    | 'letter'
    | 'tabloid'
    | 'timeline'
    | 'script'
    | 'casefile'
    | 'custom';

export type { ExtraWorkshopOptions, ExtraWorkshopTone, ExtraWorkshopLength, ExtraWorkshopPov } from './theaterPrompts';

/** 一次性生成一段主题番外（贴吧帖 / 聊天记录 / 热梗 / 采访 / 日记 / 信件等）。 */
export async function genExtraPiece(args: {
    api: ResolvedApi; kind: ExtraKind; char: CharacterProfile; userProfile: UserProfile; prompt?: string; options?: ExtraWorkshopOptions; signal?: AbortSignal;
}): Promise<string> {
    const { api, kind, char, userProfile, prompt, options, signal } = args;
    const userName = (userProfile?.name || '').trim() || '我';
    const { sys, user } = extraPiecePrompt({ kind, charName: char.name, description: char.systemPrompt || '', prompt, userName, options });
    // 番外指令常要求「不少于 5000/10000 字」的长篇——大幅放宽 max_tokens，并在被长度截断时自动续写写完。
    return (await chat(api, [{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 1.0, maxTokens: 4096, continueRounds: 5, signal })) || '（这次没生成出来，换个说法再试试）';
}

// ── 仿真图文番外（结构化 JSON，UI 渲染成仿微信/朋友圈/小红书/论坛等截图） ──────────────

export type FauxKind = TheaterFauxKind;

export const FAUX_KIND_LABELS: Record<FauxKind, string> = {
    wechat: '微信聊天',
    moments: '朋友圈',
    xhs: '小红书',
    forum: '匿名论坛',
    weibo: '微博热搜',
    qzone: 'QQ 空间',
    douban: '豆瓣小组',
    campus: '校园墙',
    memo: '备忘录',
    schedule: '日程表',
    receipt: '订单小票',
    browser: '搜索页',
};

/** 仿真番外结果：解析成功给 data，失败给 fallbackText（UI 退回纯文本展示）。 */
export interface FauxResult {
    kind: FauxKind;
    data: FauxScreenData | null;
    fallbackText: string;
}

type AnyRecord = Record<string, any>;

const isRecord = (value: unknown): value is AnyRecord => !!value && typeof value === 'object' && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asText = (value: unknown, fallback = ''): string => {
    const s = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    return s || fallback;
};
const asNumber = (value: unknown, fallback = 0, min = 0, max = 999999): number => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};
const asInt = (value: unknown, fallback = 0, min = 0, max = 999999): number => Math.round(asNumber(value, fallback, min, max));
const textArray = (value: unknown, fallback: string[] = []): string[] => {
    const arr = asArray(value).map(v => asText(v)).filter(Boolean);
    return arr.length ? arr : fallback;
};
const commentArray = (value: unknown, limit = 10): { name: string; text: string }[] =>
    asArray(value).slice(0, limit).map((raw, i) => {
        const r = isRecord(raw) ? raw : {};
        return { name: asText(r.name, `网友${i + 1}`), text: asText(r.text || r.content, '蹲后续') };
    }).filter(c => c.text);

export function normalizeFauxData(kind: FauxKind, raw: unknown): FauxScreenData | null {
    if (!isRecord(raw)) return null;
    if (kind === 'wechat') {
        const messages = asArray(raw.messages).slice(0, 40).map((item) => {
            const m = isRecord(item) ? item : {};
            return {
                from: m.from === 'user' ? 'user' as const : 'char' as const,
                text: asText(m.text || m.content),
                time: asText(m.time),
            };
        }).filter(m => m.text);
        return { contactName: asText(raw.contactName || raw.name, '对方'), messages: messages.length ? messages : [{ from: 'char', text: '……', time: '刚刚' }] };
    }
    if (kind === 'moments') {
        return {
            author: asText(raw.author, '某人'),
            text: asText(raw.text || raw.body, '今天也有一点小事想记下来。'),
            images: asInt(raw.images, 0, 0, 9),
            time: asText(raw.time, '刚刚'),
            likes: textArray(raw.likes).slice(0, 12),
            comments: commentArray(raw.comments, 12),
        };
    }
    if (kind === 'xhs') {
        return {
            title: asText(raw.title, '今天这件事真的要记一下'),
            body: asText(raw.body || raw.text, '正文生成失败，但这条笔记还在。'),
            images: asInt(raw.images, 1, 1, 9),
            tags: textArray(raw.tags, ['番外']).slice(0, 8),
            author: asText(raw.author, '小红薯'),
            likes: asInt(raw.likes, 0, 0, 999999),
            comments: commentArray(raw.comments, 10),
        };
    }
    if (kind === 'forum') {
        const op = isRecord(raw.op) ? raw.op : {};
        return {
            board: asText(raw.board, '匿名版'),
            title: asText(raw.title, '来吃个瓜'),
            op: { floor: asText(op.floor, '楼主'), text: asText(op.text || raw.text, '楼主先放个耳朵。') },
            replies: asArray(raw.replies).slice(0, 14).map((item, i) => {
                const r = isRecord(item) ? item : {};
                return { floor: asText(r.floor, `${i + 1}L`), text: asText(r.text || r.content, '蹲') };
            }).filter(r => r.text),
        };
    }
    if (kind === 'weibo') {
        return {
            topic: asText(raw.topic || raw.title, '热搜话题'),
            rank: asText(raw.rank, '热搜'),
            posts: asArray(raw.posts).slice(0, 6).map((item, i) => {
                const p = isRecord(item) ? item : {};
                return {
                    author: asText(p.author, `博主${i + 1}`),
                    text: asText(p.text || p.body, '这事有点意思。'),
                    time: asText(p.time, '刚刚'),
                    likes: asInt(p.likes, 0),
                    reposts: asInt(p.reposts, 0),
                    comments: asInt(p.comments, 0),
                };
            }),
            hotComments: asArray(raw.hotComments || raw.comments).slice(0, 8).map((item, i) => {
                const c = isRecord(item) ? item : {};
                return { name: asText(c.name, `网友${i + 1}`), text: asText(c.text || c.content, '这条我先信了'), likes: asInt(c.likes, 0) };
            }).filter(c => c.text),
        };
    }
    if (kind === 'qzone') {
        return {
            owner: asText(raw.owner || raw.author, '空间主人'),
            text: asText(raw.text || raw.body, '今天的心情写在这里。'),
            images: asInt(raw.images, 0, 0, 9),
            time: asText(raw.time, '刚刚'),
            mood: asText(raw.mood),
            visitors: textArray(raw.visitors).slice(0, 8),
            likes: textArray(raw.likes).slice(0, 12),
            comments: commentArray(raw.comments, 12),
        };
    }
    if (kind === 'douban') {
        return {
            group: asText(raw.group, '生活碎片小组'),
            title: asText(raw.title, '大家帮我分析一下'),
            author: asText(raw.author, '楼主'),
            text: asText(raw.text || raw.body, '事情是这样的。'),
            replies: asArray(raw.replies).slice(0, 14).map((item, i) => {
                const r = isRecord(item) ? item : {};
                return { name: asText(r.name, `组员${i + 1}`), text: asText(r.text || r.content, '先蹲'), time: asText(r.time), likes: asInt(r.likes, 0) };
            }).filter(r => r.text),
        };
    }
    if (kind === 'campus') {
        return {
            school: asText(raw.school, '某某大学'),
            wallName: asText(raw.wallName || raw.wall, '校园墙'),
            title: asText(raw.title),
            text: asText(raw.text || raw.body, '匿名投稿一则。'),
            images: asInt(raw.images, 0, 0, 6),
            likes: asInt(raw.likes, 0),
            comments: commentArray(raw.comments, 12),
        };
    }
    if (kind === 'memo') {
        const fallback = asText(raw.body || raw.text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        return {
            title: asText(raw.title, '备忘录'),
            updatedAt: asText(raw.updatedAt || raw.time, '刚刚'),
            lines: textArray(raw.lines, fallback.length ? fallback : ['先记到这里。']).slice(0, 24),
        };
    }
    if (kind === 'schedule') {
        return {
            title: asText(raw.title, '今天'),
            date: asText(raw.date, '今天'),
            items: asArray(raw.items).slice(0, 12).map((item, i) => {
                const it = isRecord(item) ? item : {};
                return {
                    time: asText(it.time, `${String(9 + i).padStart(2, '0')}:00`),
                    title: asText(it.title || it.text, '待办事项'),
                    place: asText(it.place),
                    note: asText(it.note),
                    done: Boolean(it.done),
                };
            }),
        };
    }
    if (kind === 'receipt') {
        return {
            shopName: asText(raw.shopName || raw.shop, '店铺'),
            orderNo: asText(raw.orderNo || raw.id, `MO${Date.now().toString().slice(-8)}`),
            status: asText(raw.status, '已完成'),
            items: asArray(raw.items).slice(0, 8).map((item, i) => {
                const it = isRecord(item) ? item : {};
                return { name: asText(it.name, `商品${i + 1}`), count: asInt(it.count, 1, 1, 99), price: asNumber(it.price, 0, 0, 99999) };
            }),
            total: asNumber(raw.total, 0, 0, 999999),
            timeline: asArray(raw.timeline).slice(0, 8).map((item, i) => {
                const t = isRecord(item) ? item : {};
                return { time: asText(t.time, `${String(18 + i).padStart(2, '0')}:00`), text: asText(t.text || t.content, '订单状态更新') };
            }),
        };
    }
    return {
        query: asText(raw.query || raw.keyword, '搜索词'),
        summary: asText(raw.summary || raw.text, '搜索结果摘要。'),
        results: asArray(raw.results).slice(0, 8).map((item, i) => {
            const r = isRecord(item) ? item : {};
            return { title: asText(r.title, `搜索结果 ${i + 1}`), snippet: asText(r.snippet || r.text, '一条搜索结果摘要。'), url: asText(r.url, `example.com/${i + 1}`) };
        }),
    };
}

const compact = (text: string, max = 180) => text.length > max ? `${text.slice(0, max)}…` : text;

export function formatFauxExport(piece: { kind: FauxKind; data: FauxScreenData | null; fallbackText: string; keyword?: string; charName?: string }): string {
    const label = FAUX_KIND_LABELS[piece.kind] || '仿真图文';
    const header = [`【番外·${label}】`, piece.charName ? `角色：${piece.charName}` : '', piece.keyword ? `主题：${piece.keyword}` : ''].filter(Boolean).join('\n');
    if (!piece.data) return `${header}\n${piece.fallbackText || '（这次只有文字稿）'}`;
    const d: any = piece.data;
    if (piece.kind === 'wechat') return `${header}\n${d.contactName}\n${(d.messages || []).slice(0, 12).map((m: any) => `${m.from === 'user' ? '我' : d.contactName}：${m.text}`).join('\n')}`;
    if (piece.kind === 'moments') return `${header}\n${d.author}：${compact(d.text)}\n点赞：${(d.likes || []).join('、') || '无'}\n评论：${(d.comments || []).slice(0, 5).map((c: any) => `${c.name}：${c.text}`).join(' / ') || '无'}`;
    if (piece.kind === 'xhs') return `${header}\n${d.title}\n${compact(d.body)}\n#${(d.tags || []).join(' #')}\n评论：${(d.comments || []).slice(0, 5).map((c: any) => `${c.name}：${c.text}`).join(' / ') || '无'}`;
    if (piece.kind === 'forum') return `${header}\n${d.board} · ${d.title}\n${d.op?.floor || '楼主'}：${compact(d.op?.text || '')}\n${(d.replies || []).slice(0, 8).map((r: any) => `${r.floor}：${r.text}`).join('\n')}`;
    if (piece.kind === 'weibo') return `${header}\n${d.rank || '热搜'} ${d.topic}\n${(d.posts || []).slice(0, 5).map((p: any) => `${p.author}：${compact(p.text, 120)}`).join('\n')}\n热评：${(d.hotComments || []).slice(0, 4).map((c: any) => `${c.name}：${c.text}`).join(' / ') || '无'}`;
    if (piece.kind === 'qzone') return `${header}\n${d.owner}：${compact(d.text)}\n访客：${(d.visitors || []).join('、') || '无'}\n评论：${(d.comments || []).slice(0, 5).map((c: any) => `${c.name}：${c.text}`).join(' / ') || '无'}`;
    if (piece.kind === 'douban') return `${header}\n${d.group} · ${d.title}\n${d.author}：${compact(d.text)}\n${(d.replies || []).slice(0, 8).map((r: any) => `${r.name}：${r.text}`).join('\n')}`;
    if (piece.kind === 'campus') return `${header}\n${d.school} · ${d.wallName}\n${d.title ? `${d.title}\n` : ''}${compact(d.text)}\n评论：${(d.comments || []).slice(0, 6).map((c: any) => `${c.name}：${c.text}`).join(' / ') || '无'}`;
    if (piece.kind === 'memo') return `${header}\n${d.title}（${d.updatedAt}）\n${(d.lines || []).slice(0, 16).join('\n')}`;
    if (piece.kind === 'schedule') return `${header}\n${d.title} · ${d.date}\n${(d.items || []).slice(0, 12).map((it: any) => `${it.time} ${it.title}${it.place ? ` @${it.place}` : ''}${it.note ? `（${it.note}）` : ''}`).join('\n')}`;
    if (piece.kind === 'receipt') return `${header}\n${d.shopName} · ${d.status}\n订单号：${d.orderNo}\n${(d.items || []).map((it: any) => `${it.name} x${it.count ?? 1} ￥${it.price ?? 0}`).join('\n')}\n合计：￥${d.total ?? 0}\n${(d.timeline || []).slice(0, 6).map((t: any) => `${t.time} ${t.text}`).join('\n')}`;
    return `${header}\n搜索：${d.query}\n${compact(d.summary)}\n${(d.results || []).slice(0, 6).map((r: any) => `${r.title} - ${r.snippet}`).join('\n')}`;
}

/**
 * 生成一段仿真图文番外，返回结构化 JSON（供 UI 仿真渲染）。
 * 失败或解析不出 JSON 时，data=null + fallbackText 原文，UI 退回纯文本。
 */
export async function genFauxPiece(args: {
    api: ResolvedApi; kind: FauxKind; char: CharacterProfile; userProfile: UserProfile; keyword?: string; signal?: AbortSignal;
}): Promise<FauxResult> {
    const { api, kind, char, userProfile, keyword, signal } = args;
    const userName = (userProfile?.name || '').trim() || '我';
    const { sys, user } = extraFauxPrompt({ kind, charName: char.name, description: char.systemPrompt || '', userName, userBio: userProfile?.bio || '', keyword });
    const raw = await chat(api, [{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.95, maxTokens: 2600, signal });
    const data = normalizeFauxData(kind, extractJson(raw));
    return { kind, data, fallbackText: raw || '（这次没生成出来，换个关键词再试试）' };
}

