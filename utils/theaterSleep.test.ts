import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';

vi.mock('./context', () => ({
    ContextBuilder: {
        buildFullCoreContext: vi.fn(async () => 'FULL ROLE CONTEXT'),
    },
}));

vi.mock('./llmClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./llmClient')>();
    return {
        ...actual,
        callChatCompletion: vi.fn(async () => ({
            choices: [{ message: { content: '  晚安，我在。  ' }, finish_reason: 'stop' }],
        })),
    };
});

import { ContextBuilder } from './context';
import { callChatCompletion } from './llmClient';
import { generateSleepOpening, generateSleepReply } from './theaterSleep';

const char = {
    id: 'char-local',
    name: '阿眠',
    description: '温柔的人',
} as CharacterProfile;

const user = {
    name: '小森',
    bio: '晚上容易想太多',
} as UserProfile;

const api = {
    baseUrl: 'https://api.example.test/v1',
    model: 'model-a',
    apiRole: 'aux',
    apiBinding: '副 API',
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('theater sleep together prompts', () => {
    it('uses full formal role context and the phone-text preset scope for replies', async () => {
        const result = await generateSleepReply(
            char,
            user,
            api,
            'voice',
            [{ role: 'user', text: '我睡不着', at: 1, inputMode: 'text' }],
            '你能陪我一会儿吗',
            '别讲大道理，轻一点',
        );

        expect(result).toBe('晚安，我在。');
        expect(ContextBuilder.buildFullCoreContext).toHaveBeenCalledWith(char, user, true);
        expect(callChatCompletion).toHaveBeenCalledTimes(1);

        const [, request, opts] = vi.mocked(callChatCompletion).mock.calls[0];
        expect(request.model).toBe('model-a');
        expect(request.messages[0].content).toContain('FULL ROLE CONTEXT');
        expect(request.messages[0].content).toContain('一起入眠模式');
        expect(request.messages[0].content).toContain('别讲大道理，轻一点');
        expect(request.messages[1].content).toContain('小森 刚刚说：你能陪我一会儿吗');
        expect(opts?.presetScope).toBe('chat.phoneText');
        expect(opts?.presetMacros).toEqual({ charName: '阿眠', userName: '小森' });
        expect(opts?.meta?.featureId).toBe('theater.sleepTogether');
    });

    it('returns text for a text-channel opening without requiring voice setup', async () => {
        const result = await generateSleepOpening(char, user, api, 'text', '今天有点累');

        expect(result).toBe('晚安，我在。');
        const [, request, opts] = vi.mocked(callChatCompletion).mock.calls[0];
        expect(request.messages[0].content).toContain('本次连接是文字入眠');
        expect(request.messages[1].content).toContain('刚进入一起入眠模式');
        expect(opts?.presetScope).toBe('chat.phoneText');
    });
});
