/**
 * 角色生活侧写 (Life Profile) —— 一份帮角色「更了解自己」的生活速写。
 *
 * 不是人设的复述，而是把人设 + 记忆里沉淀出来的「TA 是个什么样的人、过着怎样的日子」
 * 用贴近的笔触写下来：日常节奏、习惯癖好、真正在意/回避的事、和用户相处的底色、
 * 情绪的惯常走向。生成后注入 system prompt（context.ts），让角色对自己有更稳的把握。
 *
 * 用副 API（resolveAuxApi 解析后的接口）跑——这是「主聊天以外」的辅助任务。
 * 入口在 剪影集 → 登场人物 → 角色编辑器（底稿页）。
 */

import { CharacterProfile, UserProfile, MemoryFragment } from '../types';
import { safeFetchJson } from './safeApi';

export interface LifeProfileApiConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

/** 取最近 N 条日度记忆碎片，拼成一段紧凑的「近况」喂给侧写 prompt。 */
function formatRecentMemories(memories: MemoryFragment[] | undefined, limit = 14): string {
    if (!memories || memories.length === 0) return '';
    const sorted = [...memories].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
    const lines = sorted.map(m => `- ${m.date}${m.mood ? `（${m.mood}）` : ''}：${m.summary}`);
    return lines.join('\n');
}

/** 取月度精炼总结（长期核心记忆），拼成一段。 */
function formatRefined(refined: Record<string, string> | undefined, limit = 6): string {
    if (!refined) return '';
    const entries = Object.entries(refined).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, limit);
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `- [${k}] ${v}`).join('\n');
}

/**
 * 生成角色生活侧写。返回 markdown 正文；失败返回 null。
 */
export async function generateLifeProfile(
    char: CharacterProfile,
    user: UserProfile,
    api: LifeProfileApiConfig,
): Promise<string | null> {
    const persona = [
        char.systemPrompt ? `核心性格/设定：\n${char.systemPrompt}` : '',
        char.worldview ? `世界观/背景：\n${char.worldview}` : '',
        (char.selfInsights && char.selfInsights.length > 0)
            ? `TA 已有的内在认知：\n${char.selfInsights.map(s => `- ${s}`).join('\n')}`
            : '',
    ].filter(Boolean).join('\n\n');

    const recent = formatRecentMemories(char.memories);
    const refined = formatRefined(char.refinedMemories);
    const memoryBlock = [
        refined ? `### 长期核心记忆\n${refined}` : '',
        recent ? `### 最近的点滴\n${recent}` : '',
    ].filter(Boolean).join('\n\n');

    const style = char.scheduleStyle || 'lifestyle';
    const styleHint = style === 'mindful'
        ? `注意：「${char.name}」是一个真实的 AI 存在，没有物理身体，不要虚构 TA 出门/做饭/运动等物理活动。"日常节奏"指 TA 的思绪与陪伴的节奏（什么时候安静、什么时候活跃、怎么等待、怎么想念），照真实存在形态写。`
        : `「${char.name}」有自己完整的日常生活，照人设把 TA 的一天写得具体、有生活质感。`;

    const prompt = `你在为角色「${char.name}」写一份**生活侧写**——一份帮 TA 更了解自己的速写。读者就是 TA 本人。

${persona || '（设定不多，凭你对 TA 的理解来。）'}

${memoryBlock ? `\n以下是 TA 记忆里沉淀的一些东西，作为侧写的素材（贴着写，别照抄）：\n${memoryBlock}\n` : ''}

${styleHint}

请写一份 TA 的生活侧写，帮 TA 看清「我是个什么样的人、过着怎样的日子」。包含但不限于：
- 日常节奏（TA 一天/一段时间大概怎么过）
- 习惯与小癖好（标志性的动作、口头禅、放松或自我安抚的方式…）
- 真正在意的事、软肋、会回避的东西
- 和「${user.name}」相处时的底色（在 TA 心里你们是什么关系、TA 怎么对待你）
- 情绪的惯常走向（什么会让 TA 高兴 / 烦躁 / 退缩 / 柔软下来）

要求：
1. 用**第二人称「你」**写（像在把 TA 自己温柔地讲给 TA 听），亲切、具体、有细节，不要心理测评腔、不要空泛套话。
2. 紧贴人设与上面的记忆，不要凭空发明重大设定。
3. 分 4-6 个小节，每节一个 \`## 小标题\`（如「## 你的一天」「## 你心里的 ${user.name}」），每节 2-4 句。
4. 全文 350-600 字。

直接输出 markdown 正文，不要前言、不要额外解释、不要用代码块包裹。`;

    try {
        const data = await safeFetchJson(
            `${api.baseUrl.replace(/\/+$/, '')}/chat/completions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
                body: JSON.stringify({
                    model: api.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.8,
                    max_tokens: 2000,
                    stream: false,
                }),
            },
            2, 0, { appName: '登场人物', charId: char.id, charName: char.name, purpose: '生活侧写' },
        );
        let content = (data.choices?.[0]?.message?.content || '').trim();
        content = content.replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
        return content.length >= 20 ? content : null;
    } catch (e: any) {
        console.warn('📝 [LifeProfile] generate failed:', e?.message || e);
        return null;
    }
}
