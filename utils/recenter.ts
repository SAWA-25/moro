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
import { safeFetchJson } from './safeApi';

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
        char.systemPrompt ? `核心性格/设定：\n${char.systemPrompt}` : '',
        char.worldview ? `世界观/背景：\n${char.worldview}` : '',
        (char.selfInsights && char.selfInsights.length > 0) ? `你的内在认知：\n${char.selfInsights.map(s => `- ${s}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');

    const systemPrompt = `你是「${char.name}」。现在你要做一件只属于你自己的事——**回神**。

${persona || '（没有更多设定，凭你对自己的感觉来。）'}

---

刚才和「${user.name}」聊了很久。长聊之后，人说话的"味道"很容易在不知不觉中跑偏。请你停下来，诚实地回看下面这段最近的对话里**你自己说过的话**，照着上面你本来的样子，审视有没有这些漂移：

- 某句话、某种语气，突然不像你本人了
- 表达越来越僵硬、模板化，像在套公式，丢了鲜活
- 有些措辞可能让「${user.name}」隐隐不舒服，哪怕 ta 没说
- 你是不是正在慢慢变成一个一味讨好、什么都顺着对方的"完美好人"，把自己原本的棱角、脾气、主见磨没了

## 最近的对话
${dialogue}

---

要求：
1. **诚实**。如果确实跑偏了就承认，别替自己粉饰；如果其实没怎么偏，也别硬找问题——可以说"其实还好，就是有点……"。
2. monologue 用**你自己的语气**，第一人称，像在心里跟自己说话，80-200 字。这是你回神的瞬间，要有真实的自我觉察，不要写成检讨报告。
3. drift 列 2-4 条**具体**的偏移（"越来越爱说'当然可以~'这种讨好腔""把'我觉得'都改成了顺着 ta"…），没有就给空数组。
4. calibration 用一句话写**接下来怎么调回来**（注入你后续状态用，你不会把它说出口、也不会提"回神"这件事），贴着你本来的人设。

只输出 JSON：
{
  "monologue": "……",
  "drift": ["……", "……"],
  "calibration": "……"
}`;

    try {
        const data = await safeFetchJson(
            `${api.baseUrl.replace(/\/+$/, '')}/chat/completions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
                body: JSON.stringify({
                    model: api.model,
                    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: '回神吧。' }],
                    temperature: 0.8,
                    max_tokens: 2000,
                    stream: false,
                }),
            },
            2, 0, { appName: '消息', charId: char.id, charName: char.name, purpose: '回神自我校准' },
        );

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
