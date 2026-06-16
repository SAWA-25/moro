/**
 * 小剧场·番外 —— 生成逻辑（走副 API）。
 * ============================================
 * 提供几类「番外」内容的生成：
 *  - 问卷番外：系统一题一题出题（恋爱相性100问 / MBTI / 价值观 / 性癖 / 无厘头…，
 *    用户输入想要的问卷名即可），角色作答 + 用户作答，做完为止；
 *  - 贴吧/论坛帖番外、聊天记录番外、热梗番外：一次性生成一段主题内容。
 *
 * 纯函数 + 文案，UI 在 apps/theater/ExtraApp.tsx。失败抛错由调用方兜底。
 */

import type { CharacterProfile, UserProfile } from '../types';
import type { ResolvedApi } from './auxApi';
import { safeResponseJson, extractContent, extractJson } from './safeApi';

async function chat(api: ResolvedApi, messages: { role: string; content: string }[], opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }): Promise<string> {
    const baseUrl = (api.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
        body: JSON.stringify({
            model: api.model,
            messages,
            temperature: opts?.temperature ?? 0.9,
            max_tokens: opts?.maxTokens ?? 900,
            stream: false,
        }),
        signal: opts?.signal,
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await safeResponseJson(res);
    return (extractContent(data) || '')
        .replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '')
        .trim();
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
    api: ResolvedApi; topic: string; index: number; total: number; asked: string[]; signal?: AbortSignal;
}): Promise<string> {
    const { api, topic, index, total, asked, signal } = args;
    const recent = asked.slice(-12).map((q, i) => `${asked.length - Math.min(12, asked.length) + i + 1}. ${q}`).join('\n');
    const sys = '你是一个「问卷出题官」。根据用户指定的问卷主题，一次只出【一道】题目，题目要贴合该问卷的风格与领域。'
        + '只输出题干本身：不要题号、不要引号、不要选项、不要解释、不要任何多余文字。语言用中文。';
    const user = `问卷主题：「${topic}」\n`
        + `这是第 ${index + 1} / ${total} 题。\n`
        + (recent ? `已经出过的题（不要重复、不要近义）：\n${recent}\n` : '')
        + `请给出第 ${index + 1} 题的题干（贴合「${topic}」的风格，简洁、可作答）。`;
    const raw = await chat(api, [{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.95, maxTokens: 200, signal });
    return cleanQuestion(raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || raw) || `（第 ${index + 1} 题生成失败，点重试）`;
}

/** 角色按人设作答某一题。 */
export async function genCharAnswer(args: {
    api: ResolvedApi; char: CharacterProfile; userProfile: UserProfile; topic: string; question: string; signal?: AbortSignal;
}): Promise<string> {
    const { api, char, userProfile, topic, question, signal } = args;
    const userName = (userProfile?.name || '').trim() || '对方';
    const sys = `你正在扮演「${char.name}」回答一份「${topic}」问卷。\n人设：${String(char.description || '').slice(0, 700)}\n`
        + `完全以 ${char.name} 的口吻、价值观、说话习惯第一人称作答，可带点情绪和私心（${userName} 也在一起做这份问卷）。`
        + `只输出答案本身，简短自然（一般 1~3 句），不要复述题目、不要旁白、不要引号。`;
    const user = `题目：${question}\n请以 ${char.name} 的身份作答。`;
    return (await chat(api, [{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.9, maxTokens: 300, signal })) || '……（TA 没说话）';
}

export type ExtraKind = 'tieba' | 'chatlog' | 'meme' | 'custom';

/** 一次性生成一段主题番外（贴吧帖 / 聊天记录 / 热梗 / 自定义）。 */
export async function genExtraPiece(args: {
    api: ResolvedApi; kind: ExtraKind; char: CharacterProfile; userProfile: UserProfile; prompt?: string; signal?: AbortSignal;
}): Promise<string> {
    const { api, kind, char, userProfile, prompt, signal } = args;
    const userName = (userProfile?.name || '').trim() || '我';
    const persona = `角色「${char.name}」人设：${String(char.description || '').slice(0, 600)}`;
    let sys = '', user = '';
    if (kind === 'tieba') {
        sys = '你是贴吧/论坛老哥。写一个以某角色为话题的求助/讨论帖，要有楼主帖 + 几条风格各异的网友回复（含抖机灵、热心、阴阳怪气、过来人等），口语、接地气、有网感。用中文，用「楼主：」「1L：」「2L：」这种格式。';
        user = `${persona}\n场景/诉求：${prompt || `楼主想求助关于「${char.name}」的事`}\n写一个贴吧帖（楼主帖 + 5~8 条回复）。`;
    } else if (kind === 'chatlog') {
        sys = '你是编剧。写一段「聊天记录」番外：两个或多个人围绕某角色或某事件的对话截图文字稿，真实、有梗、有信息量。用「昵称：内容」逐行呈现，可夹杂表情文字。中文。';
        user = `${persona}\n聊天主题/背景：${prompt || `大家在群里聊到了「${char.name}」`}\n写一段 12~20 行的聊天记录。`;
    } else if (kind === 'meme') {
        sys = '你是熟悉中文互联网热梗的网友。围绕某角色，造一组「热梗」番外：把 TA 套进当下流行的梗/句式/表情包文案里，俏皮、有梗、好笑，列 6~10 条。中文。';
        user = `${persona}\n要玩梗的点：${prompt || `${char.name} 的性格与名场面`}\n输出 6~10 条关于 TA 的热梗文案。`;
    } else {
        sys = '你是一个有想象力的同人作者。根据用户的要求，围绕某角色写一段番外内容，贴合角色人设，有画面感。中文。';
        user = `${persona}\n用户要的番外：${prompt || `关于「${char.name}」的一段番外`}\n（${userName} 想看的）`;
    }
    return (await chat(api, [{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 1.0, maxTokens: 1400, signal })) || '（这次没生成出来，换个说法再试试）';
}

// ── 仿真图文番外（结构化 JSON，UI 渲染成仿微信/朋友圈/小红书/论坛） ──────────────

export type FauxKind = 'wechat' | 'moments' | 'xhs' | 'forum';

/** 仿真番外结果：解析成功给 data，失败给 fallbackText（UI 退回纯文本展示）。 */
export interface FauxResult {
    kind: FauxKind;
    data: any | null;
    fallbackText: string;
}

function personaPair(char: CharacterProfile, userProfile: UserProfile): string {
    const userName = (userProfile?.name || '').trim() || '我';
    return `角色「${char.name}」人设：${String(char.description || '').slice(0, 600)}\n`
        + `用户「${userName}」：${String(userProfile?.bio || '').slice(0, 200) || '（无额外设定）'}`;
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
    const persona = personaPair(char, userProfile);
    const topic = keyword?.trim();

    let sys = '', user = '';
    if (kind === 'wechat') {
        sys = '你在写一段“捡到手机看到的微信聊天记录”——极度真实、接地气、有生活质感的中文对话。'
            + '口语化、有错字感的随意、有表情符号/语气词、有时间跳跃、有日常细节和小情绪。不要旁白、不要解释。'
            + '严格只输出 JSON：{"contactName":"对方备注名","messages":[{"from":"user"|"char","text":"...","time":"14:23"}]}。'
            + 'from=user 是机主（你/我），from=char 是对方角色。20~36 条，长短交错。';
        user = `${persona}\n机主=${userName}，对方=${char.name}。\n聊天主题/关键词：${topic || '日常拌嘴与想念，藏着没说出口的在意'}\n生成这段微信聊天记录 JSON。`;
    } else if (kind === 'moments') {
        sys = '你在仿写一条微信朋友圈。真实、有梗、有细节。严格只输出 JSON：'
            + '{"author":"发圈人","text":"正文","images":2,"time":"刚刚/今天 12:30","likes":["昵称1","昵称2"],"comments":[{"name":"昵称","text":"评论"}]}。'
            + 'images 是配图数量(0~9)，likes 是点赞昵称数组，comments 是评论。中文。';
        user = `${persona}\n以「${topic || `${char.name}`}」为主题，发圈人可以是 ${char.name} 或 ${userName}，深扒一点两人之间的八卦/暗流。生成朋友圈 JSON。`;
    } else if (kind === 'xhs') {
        sys = '你在仿写一篇小红书图文笔记，图文并茂、有网感、标题党一点。严格只输出 JSON：'
            + '{"title":"标题(带emoji)","body":"正文(可含换行与小标题)","images":3,"tags":["话题1","话题2"],"author":"作者昵称","likes":1234,"comments":[{"name":"昵称","text":"评论"}]}。'
            + 'images 是配图数量(1~9)。中文。';
        user = `${persona}\n以「${topic || `深扒 ${char.name}`}」为主题写一篇小红书，可带 ${userName} 视角的八卦/爆料口吻。生成 JSON。`;
    } else {
        sys = '你在仿写一个匿名论坛帖（贴吧/虎扑/校园墙风格），楼主 + 多层跟帖，抖机灵、阴阳、热心、吃瓜都要有。严格只输出 JSON：'
            + '{"board":"板块名","title":"帖子标题","op":{"floor":"楼主","text":"..."},"replies":[{"floor":"1L","text":"..."}]}。'
            + '6~12 层回复。中文。';
        user = `${persona}\n以「${topic || `关于 ${char.name} 的瓜`}」开个匿名帖，深扒 ${char.name} 与 ${userName} 的八卦。生成 JSON。`;
    }

    const raw = await chat(api, [{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.95, maxTokens: 1800, signal });
    const data = extractJson(raw);
    return { kind, data: data ?? null, fallbackText: raw || '（这次没生成出来，换个关键词再试试）' };
}

