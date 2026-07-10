/**
 * 幕间集·一起入眠。
 * ==================
 * 睡前文字 / 电话式语音陪伴：选一个正式角色，用完整角色设定、完整用户设定
 * 和活字盘电话文字范围生成低刺激、适合朗读的睡前回应。
 *
 * 这里只处理 prompt 与 LLM 调用；录音、TTS、会话存档由 UI 负责。
 * 📌 prompt 文案集中在 utils/theaterPrompts.ts（[拾] 一起入眠 区段）。
 */

import type { CharacterProfile, TheaterSleepChannel, TheaterSleepTurn, UserProfile } from '../types';
import type { ResolvedApi } from './auxApi';
import { ContextBuilder } from './context';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { extractContent } from './safeApi';
import { stripThink } from './llmClient';
import {
    sleepTogetherOpeningUser,
    sleepTogetherReplyUser,
    sleepTogetherSystemPrompt,
} from './theaterPrompts';

const transcript = (turns: TheaterSleepTurn[], charName: string, userName: string): string =>
    turns.map(t => `${t.role === 'user' ? userName : charName}：${t.text}`).join('\n');

const sleepSystem = async (
    char: CharacterProfile,
    userProfile: UserProfile,
    channel: TheaterSleepChannel,
    intention?: string,
): Promise<{ system: string; userName: string }> => {
    const userName = (userProfile.name || '').trim() || '对方';
    const core = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
    return {
        userName,
        system: sleepTogetherSystemPrompt({
            core,
            charName: char.name,
            userName,
            channel,
            intention,
        }),
    };
};

const callSleepLLM = async (
    api: ResolvedApi,
    char: CharacterProfile,
    userName: string,
    system: string,
    user: string,
): Promise<string> => {
    if (!api.baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.72,
        max_tokens: 320,
        stream: false,
    }, {
        meta: makeApiUsageMeta('theater.sleepTogether', {
            charId: char.id,
            charName: char.name,
            apiRole: api.apiRole || 'aux',
            apiBinding: api.apiBinding,
        }),
        presetScope: 'chat.phoneText',
        presetMacros: { charName: char.name, userName },
    });
    return stripThink(extractContent(data) || '').trim();
};

export const generateSleepOpening = async (
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi,
    channel: TheaterSleepChannel,
    intention?: string,
): Promise<string> => {
    const { system, userName } = await sleepSystem(char, userProfile, channel, intention);
    const user = sleepTogetherOpeningUser({ userName, charName: char.name, channel, intention });
    return callSleepLLM(api, char, userName, system, user);
};

export const generateSleepReply = async (
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi,
    channel: TheaterSleepChannel,
    turns: TheaterSleepTurn[],
    userInput: string,
    intention?: string,
): Promise<string> => {
    const { system, userName } = await sleepSystem(char, userProfile, channel, intention);
    const hist = transcript(turns, char.name, userName);
    const user = sleepTogetherReplyUser({ hist, userName, charName: char.name, userInput });
    return callSleepLLM(api, char, userName, system, user);
};
