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
import { makeApiUsageMeta } from './apiUsageCatalog';
import { callChatCompletion } from './llmClient';
import { buildFullActiveUserSetting, buildFullCharacterSetting } from './characterPromptProfile';
import { characterLifeProfilePrompt, characterLifeProfileStyleHint } from './laiwangPrompts';

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
    const persona = buildFullCharacterSetting(char, { includeMemos: true, fallback: '（设定不多，凭你对 TA 的理解来。）' });
    const userSetting = await buildFullActiveUserSetting(user, { fallback: `用户名：${user.name || '用户'}` });

    const recent = formatRecentMemories(char.memories);
    const refined = formatRefined(char.refinedMemories);
    const memoryBlock = [
        refined ? `### 长期核心记忆\n${refined}` : '',
        recent ? `### 最近的点滴\n${recent}` : '',
    ].filter(Boolean).join('\n\n');

    const styleHint = characterLifeProfileStyleHint(char.name, char.scheduleStyle || 'lifestyle');
    const prompt = characterLifeProfilePrompt({
        charName: char.name,
        userName: user.name,
        persona,
        userSetting,
        memoryBlock: memoryBlock || undefined,
        styleHint,
    });

    try {
        const data = await callChatCompletion(api, {
            model: api.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.8,
            max_tokens: 2000,
            stream: false,
        }, {
            meta: makeApiUsageMeta('character.lifeProfile', { apiRole: 'aux', charId: char.id, charName: char.name }),
        });
        let content = (data.choices?.[0]?.message?.content || '').trim();
        content = content.replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
        return content.length >= 20 ? content : null;
    } catch (e: any) {
        console.warn('📝 [LifeProfile] generate failed:', e?.message || e);
        return null;
    }
}
