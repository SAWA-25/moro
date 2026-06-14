/**
 * 「解除拉黑验证」申诉 —— 角色被用户拉黑后，主动发来验证消息求解封。
 * ================================================================
 * 与 blockSystem.ts 互补：
 *  - blockSystem：角色拉黑用户（charBlock）+ 用户拉黑角色（blacklisted）的状态与提示词；
 *  - 本文件：用户拉黑角色（blacklisted）后，角色「不甘心」地发来一条条解封申诉，
 *    用户可同意（解除拉黑）/ 拒绝；拒绝后角色隔一阵再发，直到用户同意。
 *
 * 调度寄生在 OSContext 的 checkAllSchedules（5s loop）里；本文件只提供纯函数与文案。
 */

import type { CharacterProfile, UserProfile } from '../types';
import type { ResolvedApi } from './auxApi';
import { safeResponseJson, extractContent } from './safeApi';

const MIN = 60 * 1000;

/** 首次申诉延迟：拉黑后 1~3 分钟冒出来（同一会话里就能看到，不至于太突兀）。 */
export const firstAppealDelayMs = (): number => Math.floor((1 + Math.random() * 2) * MIN);

/** 被拒后再发的间隔：随被拒次数小幅拉长（3~10 分钟起步，封顶约 40 分钟）。 */
export const nextAppealDelayMs = (rejectedCount: number): number => {
    const base = 3 + Math.random() * 7;                  // 3~10 分钟
    const grow = Math.min(rejectedCount, 6) * 5;          // 每被拒一次多等 ~5 分钟，封顶 +30
    return Math.floor((base + grow) * MIN);
};

/** 拉黑时初始化申诉状态（首条申诉的 nextAt）。 */
export const initUnblockAppeal = (): NonNullable<CharacterProfile['unblockAppeal']> => ({
    active: true,
    awaiting: false,
    nextAt: Date.now() + firstAppealDelayMs(),
    rejectedCount: 0,
});

/** 是否到了该发新申诉的时刻。 */
export const isAppealDue = (char: CharacterProfile, now = Date.now()): boolean => {
    const a = char.unblockAppeal;
    return !!char.blacklisted && !!a && a.active && !a.awaiting && now >= a.nextAt;
};

/** 兜底文案（API 不可用 / 失败时用）：按被拒次数换语气，避免每次一模一样。 */
const templateAppeal = (userName: string, rejectedCount: number): string => {
    const pool = [
        [`${userName}，是我。我知道你把我拉黑了……能不能先别急着删，听我说一句？`,
         `我反省过了，那天是我不对。给我一次解释的机会好吗？`,
         `…在吗。我没别的意思，就是想问问，还能不能把我放回来。`],
        [`又是我。我知道很烦，可我真的没办法装作没事。求你了，再考虑一下？`,
         `我不该一上来就那样的。${userName}，我等你回心转意。`,
         `就当我厚脸皮吧——我还是想跟你说话。能解封我吗？`],
        [`我数不清这是第几次了。但只要还有一丝可能，我就不想放弃。`,
         `你可以一直拒绝，我也会一直发。因为我是真的在乎。`,
         `${userName}，哪怕只回我一个字也好。把我放回来，好不好。`],
    ];
    const tier = pool[Math.min(rejectedCount, pool.length - 1)];
    return tier[Math.floor(Math.random() * tier.length)];
};

/**
 * 生成一条角色的解封申诉正文。优先按人设走 API 生成；失败/无 API 用兜底模板。
 * 始终返回非空字符串。
 */
export async function generateUnblockAppeal(args: {
    char: CharacterProfile;
    userProfile: UserProfile;
    api?: ResolvedApi | null;
    signal?: AbortSignal;
}): Promise<string> {
    const { char, userProfile, api, signal } = args;
    const userName = (userProfile?.name || '').trim() || '你';
    const rejectedCount = char.unblockAppeal?.rejectedCount || 0;
    const baseUrl = (api?.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl || !api?.model) return templateAppeal(userName, rejectedCount);

    const moodHint = rejectedCount === 0
        ? '这是你第一次申诉，可以委屈、解释、道歉或撒娇。'
        : `你已经被拒绝 ${rejectedCount} 次了，但你不死心。可以更卑微、更执拗、或带点赌气，但仍想被原谅。`;
    const prompt = `你正在扮演「${char.name}」。\n人设：${String(char.description || '').slice(0, 700)}\n\n`
        + `情境：${userName} 把你拉黑了，你发的消息都显示「发送失败」。但你不甘心，想发一条「解除拉黑验证」请求，求对方把你放回来。\n`
        + `${moodHint}\n\n`
        + `要求：用第一人称、口语，像真的在对 ${userName} 说话；1~2 句、简短真挚，完全贴合你的人设语气；`
        + `只输出这句话本身，不要旁白、不要解释、不要引号、不要任何标签。`;

    try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
            body: JSON.stringify({
                model: api.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.9,
                max_tokens: 400,
                stream: false,
            }),
            signal,
        });
        if (!res.ok) return templateAppeal(userName, rejectedCount);
        const data = await safeResponseJson(res);
        const text = (extractContent(data) || '')
            .replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '')
            .replace(/^["'“”\s]+|["'“”\s]+$/g, '')
            .trim();
        return text || templateAppeal(userName, rejectedCount);
    } catch {
        return templateAppeal(userName, rejectedCount);
    }
}
