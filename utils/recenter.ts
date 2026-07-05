/**
 * 回神 (Recenter) — 角色自我校准机制
 * ===================================
 * 长对话里角色「说话的味道」几乎一定会慢慢漂：
 *   · 某句话、某种语气突然不像 ta 本人
 *   · 表达越来越僵硬、模板化，像换了个角色
 *   · 一些措辞让用户隐隐不适，却说不清哪里不对
 *   · 渐渐滑向一个完美的讨好型人格，丢了原本的棱角和个性
 *
 * 过去用户只能删消息 / 反复重生成 / 甚至重写人设来纠。「回神」给一条更优雅的路径：
 * 让角色**自己**暂停下来，照着自己的核心人设，第一人称地审视最近哪里偏了，
 * 然后**悄悄**调回去——不是用户在外面拽，是 ta 自己回神。
 *
 * 产物分两部分：
 *   - monologue：第一人称内心独白（给用户看的情感落点——ta 当着你的面意识到了问题）
 *   - calibration：一句话校准方向（注入后续 system prompt，让 ta 真的调回来，但不解释、不提"回神"）
 *
 * 用的是**主 API**（角色自己的声音），不是副 API——回神是角色本人在说话。
 */

import { CharacterProfile, UserProfile, Message } from '../types';
import { recenterSystem } from './laiwangPrompts';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { callChatCompletion } from './llmClient';
import { buildFullCharacterSetting, buildFullActiveUserSetting } from './characterPromptProfile';

export interface RecenterApiConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

export interface RecenterResult {
    /** 第一人称内心独白（展示给用户） */
    monologue: string;
    /** 察觉到的偏移点（2-4 条，简短，用于展示） */
    drift: string[];
    /** 一句话校准方向（注入后续 prompt，悄悄调回来） */
    calibration: string;
}

/** 回神后注入 prompt 生效的 AI 回复轮数（之后自然淡出，回到常态） */
export const RECENTER_DEFAULT_TURNS = 4;

/** 把最近的对话拍成文本喂给回神 prompt（只看近窗即可感知"跑味"） */
function formatRecentDialogue(messages: Message[], char: CharacterProfile, user: UserProfile): string {
    const tail = messages.slice(-24);
    const lines = tail.map(m => {
        const who = m.role === 'user' ? user.name : (m.role === 'assistant' ? char.name : '系统');
        let text: string;
        if (m.type === 'image') text = '[图片]';
        else if ((m as any).type === 'audio' || (m as any).type === 'voice') text = '[语音]';
        else text = typeof m.content === 'string' ? m.content : '';
        return `${who}: ${text}`;
    }).filter(l => l.trim());
    return lines.join('\n');
}

/**
 * 跑一次回神：让角色照核心人设审视最近的自己，产出独白 + 校准方向。
 * @returns RecenterResult；失败或没东西可校准时返回 null。
 */
export async function runRecenter(
    char: CharacterProfile,
    user: UserProfile,
    recentMessages: Message[],
    api: RecenterApiConfig,
): Promise<RecenterResult | null> {
    const filtered = recentMessages.filter(m => !char.hideBeforeMessageId || m.id >= char.hideBeforeMessageId);
    const dialogue = formatRecentDialogue(filtered, char, user);
    if (!dialogue.trim()) return null;

    // 核心人设：用最原始的设定做「锚」——回神就是拿现在的自己跟这个锚对齐
    const persona = [
        buildFullCharacterSetting(char, { includeMemos: true }),
        await buildFullActiveUserSetting(user, { fallback: `用户名：${user.name || '用户'}` }),
    ].join('\n\n');

    const systemPrompt = recenterSystem({ charName: char.name, userName: user.name, persona, dialogue });

    try {
        const data = await callChatCompletion(api, {
            model: api.model,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: '回神吧。' }],
            temperature: 0.8,
            max_tokens: 2000,
            stream: false,
        }, {
            meta: makeApiUsageMeta('chat.recenter', {
                charId: char.id,
                charName: char.name,
                apiRole: 'main',
            }),
        });

        let content = (data.choices?.[0]?.message?.content || '').trim();
        content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
        // 容错：截取首个 { 到末个 }，剥掉模型可能多写的前后语
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        if (start >= 0 && end > start) content = content.slice(start, end + 1);

        const parsed = JSON.parse(content);
        const monologue = typeof parsed.monologue === 'string' ? parsed.monologue.trim() : '';
        if (!monologue) return null;
        const drift = Array.isArray(parsed.drift)
            ? parsed.drift.filter((d: any) => typeof d === 'string' && d.trim()).map((d: string) => d.trim()).slice(0, 4)
            : [];
        const calibration = typeof parsed.calibration === 'string' ? parsed.calibration.trim() : '';

        return { monologue, drift, calibration };
    } catch (e: any) {
        console.warn('🫧 [Recenter] failed:', e?.message || e);
        return null;
    }
}
