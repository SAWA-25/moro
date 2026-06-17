/**
 * 占卜解牌 —— 组装 prompt，走副 API（resolveAuxApi），以选中角色口吻 + 世界书解读。
 * ========================================================================
 * UI 在 apps/theater/DivinationApp.tsx；牌面/卦象由 engines.ts 产出后转成文字喂进来。
 * 失败抛错，由调用方兜底（同 theaterExtra 的风格）。
 * 📌 解牌 prompt 文案集中在 utils/theaterPrompts.ts（[叁] 占卜 区段），改文案去那里。
 */

import type { CharacterProfile, UserProfile } from '../../types';
import type { ResolvedApi } from '../auxApi';
import { safeResponseJson, extractContent } from '../safeApi';
import { DIVINATION_KIND_ROLE, divinationInterpretSys, divinationInterpretUser } from '../theaterPrompts';
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

export async function interpretReading(args: InterpretArgs): Promise<string> {
    const { api, kind, readingText, question, char, userProfile, worldbookText, signal } = args;
    const userName = (userProfile?.name || '').trim() || '问卜者';
    const sys = divinationInterpretSys({ charName: char.name, kindRole: DIVINATION_KIND_ROLE[kind], description: char.description || '', userName, worldbookText });
    const user = divinationInterpretUser({ question, readingText, charName: char.name });
    // 调高 max_tokens：推理模型会先吃掉一大截 token 做思维链，预算太小会把正文解读截断（反馈：解牌只显示半句）
    return (await chat(api, [{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.85, maxTokens: 2200, signal }))
        || '（这次没解出来，换个问法或重新抽一次试试）';
}
