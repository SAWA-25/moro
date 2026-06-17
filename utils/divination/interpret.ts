/**
 * 占卜解牌 —— 组装 prompt，走副 API（resolveAuxApi），以选中角色口吻 + 世界书解读。
 * ========================================================================
 * UI 在 apps/theater/DivinationApp.tsx；牌面/卦象由 engines.ts 产出后转成文字喂进来。
 * 失败抛错，由调用方兜底（同 theaterExtra 的风格）。
 * 📌 解牌 prompt 文案集中在 utils/theaterPrompts.ts（[叁] 占卜 区段），改文案去那里。
 */

import type { CharacterProfile, UserProfile } from '../../types';
import type { ResolvedApi } from '../auxApi';
import { llmComplete } from '../llmComplete';
import { DIVINATION_KIND_ROLE, divinationInterpretSys, divinationInterpretUser } from '../theaterPrompts';
import type { DrawnTarot, DrawnLenormand, LiuyaoResult, MeihuaResult } from './engines';

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

/** 抽牌后继续对话的一轮（user=问卜者追问 / assistant=角色回应）。 */
export interface ReadingTurn { role: 'user' | 'assistant'; content: string }

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
    /**
     * 抽牌后「继续和角色对话」的历史（按时间顺序）：
     *  - 空 / 省略 = 首次解牌（角色给完整解读）；
     *  - 非空 = 围绕同一副牌的追问对话，最后一条应是 user 的新问题，角色据此口语化回应。
     */
    history?: ReadingTurn[];
    signal?: AbortSignal;
}

export async function interpretReading(args: InterpretArgs): Promise<string> {
    const { api, kind, readingText, question, char, userProfile, worldbookText, history, signal } = args;
    const userName = (userProfile?.name || '').trim() || '问卜者';
    const conversational = !!(history && history.length);
    const sys = divinationInterpretSys({ charName: char.name, kindRole: DIVINATION_KIND_ROLE[kind], description: char.description || '', userName, worldbookText, conversational });
    const user = divinationInterpretUser({ question, readingText, charName: char.name });
    // 首解：[sys, 牌面/问题]；继续对话：再接上「角色解读 + 追问 + 回应…」的历史，角色顺着聊。
    const messages = [
        { role: 'system', content: sys },
        { role: 'user', content: user },
        ...(history || []),
    ];
    // 调高 max_tokens + 自动续写：推理模型会先吃掉一大截 token 做思维链，预算太小会把正文解读截断
    // （反馈：解牌只显示半句）。llmComplete 会在被 finish_reason='length' 截断、
    // 或代理不回 finish_reason 但正文停在半句上时自动接着写完（continueRounds 轮内）。
    return (await llmComplete(api, messages, { temperature: 0.85, maxTokens: 4096, continueRounds: 3, signal }))
        || '（这次没解出来，换个问法或重新抽一次试试）';
}
