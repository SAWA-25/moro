/**
 * 占卜解牌 —— 组装 prompt，走副 API（resolveAuxApi），以选中角色口吻 + 世界书解读。
 * ========================================================================
 * UI 在 apps/theater/DivinationApp.tsx；牌面/卦象由 engines.ts 产出后转成文字喂进来。
 * 失败抛错，由调用方兜底（同 theaterExtra 的风格）。
 */

import type { CharacterProfile, UserProfile } from '../../types';
import type { ResolvedApi } from '../auxApi';
import { safeResponseJson, extractContent } from '../safeApi';
import type { DrawnTarot, DrawnLenormand, LiuyaoResult, MeihuaResult } from './engines';

async function chat(api: ResolvedApi, messages: { role: string; content: string }[], opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }): Promise<string> {
    const baseUrl = (api.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
        body: JSON.stringify({
            model: api.model,
            messages,
            temperature: opts?.temperature ?? 0.85,
            max_tokens: opts?.maxTokens ?? 1200,
            stream: false,
        }),
        signal: opts?.signal,
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await safeResponseJson(res);
    return (extractContent(data) || '')
        // 去思维链：成对 <think>…</think> + 被 max_tokens 截断的残缺 <think>…（到结尾）
        .replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(?:think|thinking|thought)>[\s\S]*$/i, '')
        .trim();
}

export type DivinationKind = 'tarot' | 'lenormand' | 'liuyao' | 'meihua';

// ── 把牌面/卦象转成可读文字（也用于「发到聊天」的摘要） ────────────────────

export function tarotToText(spreadName: string, draws: DrawnTarot[]): string {
    return `【塔罗 · ${spreadName}】\n` + draws.map((d, i) =>
        `${i + 1}. [${d.position}] ${d.card.name}（${d.reversed ? '逆位' : '正位'}）—— ${d.reversed ? d.card.reversed : d.card.upright}`,
    ).join('\n');
}

export function lenormandToText(spreadName: string, draws: DrawnLenormand[]): string {
    return `【雷诺曼 · ${spreadName}】\n` + draws.map((d, i) =>
        `${i + 1}. [${d.position}] ${d.card.number}·${d.card.name} —— ${d.card.meaning}`,
    ).join('\n');
}

export function liuyaoToText(r: LiuyaoResult): string {
    const lines = r.lines.map((l, i) => `  ${i + 1}爻：${l.label}`).reverse().join('\n');
    const moving = r.movingPositions.length ? `动爻：第 ${r.movingPositions.join('、')} 爻` : '无动爻（静卦）';
    return `【六爻 · 金钱卦】\n本卦：${r.primary?.name || '—'}\n` +
        (r.changed ? `变卦：${r.changed.name}\n` : '') +
        `${moving}\n六爻（自上而下）：\n${lines}\n卦辞：${r.primary?.judgement || ''}`;
}

export function meihuaToText(r: MeihuaResult): string {
    const ti = r.bodyTrigram === 'upper' ? r.upperName : r.lowerName;
    const yong = r.bodyTrigram === 'upper' ? r.lowerName : r.upperName;
    return `【梅花易数】\n本卦：${r.primary?.name || '—'}（上${r.upperName}下${r.lowerName}）\n` +
        `互卦：${r.mutual?.name || '—'}\n变卦：${r.changed?.name || '—'}\n` +
        `动爻：第 ${r.movingYao} 爻　体卦：${ti}　用卦：${yong}\n卦辞：${r.primary?.judgement || ''}`;
}

// ── 解牌 ───────────────────────────────────────────────────────────────────

export interface InterpretArgs {
    api: ResolvedApi;
    kind: DivinationKind;
    /** engines 产出的牌面/卦象文字（用上面的 *ToText） */
    readingText: string;
    question: string;
    char: CharacterProfile;
    userProfile: UserProfile;
    /** 角色当前生效的世界书文本（local + global 拼好），可空 */
    worldbookText?: string;
    signal?: AbortSignal;
}

const KIND_ROLE: Record<DivinationKind, string> = {
    tarot: '资深塔罗占卜师',
    lenormand: '雷诺曼卡牌占卜师',
    liuyao: '精通六爻纳甲的命理师',
    meihua: '精通梅花易数、体用生克的命理师',
};

export async function interpretReading(args: InterpretArgs): Promise<string> {
    const { api, kind, readingText, question, char, userProfile, worldbookText, signal } = args;
    const userName = (userProfile?.name || '').trim() || '问卜者';
    const wb = (worldbookText || '').trim();
    const sys =
        `你现在以「${char.name}」的身份，作为一位${KIND_ROLE[kind]}，为 ${userName} 解读这一卦/这次抽牌。\n` +
        `角色人设：${String(char.description || '').slice(0, 800)}\n` +
        (wb ? `相关设定（世界书，务必结合）：\n${wb.slice(0, 1200)}\n` : '') +
        `要求：\n` +
        `1) 完全以 ${char.name} 的口吻、性格、价值观来解读，自然代入你们之间的关系；\n` +
        `2) 专业、有据：紧扣牌面/卦象的实际含义（正逆位、动爻、体用生克、牌阵位置都要用上），不要泛泛而谈；\n` +
        `3) 分层次：先点出核心信号，再结合问题逐项解读，最后给一句落地的建议；\n` +
        `4) 真诚体贴，但该提醒的风险也直说；不要复述题面，不要 markdown 标题，控制在 6 段以内。`;
    const user =
        `问卜的问题：${question || '（未明确提问，请做综合运势解读）'}\n\n` +
        `占卜结果：\n${readingText}\n\n` +
        `请你（${char.name}）开始解读。`;
    // 调高 max_tokens：推理模型会先吃掉一大截 token 做思维链，预算太小会把正文解读截断（反馈：解牌只显示半句）
    return (await chat(api, [{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.85, maxTokens: 2200, signal }))
        || '（这次没解出来，换个问法或重新抽一次试试）';
}
