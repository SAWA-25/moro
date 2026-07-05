import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPreset, PresetRuntime } from './presets';
import { buildActiveMsg2ScheduledLlmPayload, buildChatProactivePresetResult } from './proactivePresetPayload';

function presetWithMain(content = 'PRESET {{user}} -> {{char}}') {
    const preset = createDefaultPreset();
    const main = preset.prompts.find(p => p.identifier === 'main')!;
    main.content = content;
    preset.prompt_order = [{
        character_id: 100000,
        order: [
            { identifier: 'main', enabled: true },
            { identifier: 'chatHistory', enabled: true },
        ],
    }];
    return preset;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('proactive preset payload helpers', () => {
    it('applies chat.proactive preset skeleton and sampling to ActiveMsg2 scheduled payloads', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue({ temperature: 0.33, max_tokens: 345 });
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(presetWithMain());

        const payload = await buildActiveMsg2ScheduledLlmPayload({
            completePrompt: 'COMPLETE_PROMPT',
            charName: '阿澈',
            userName: '小夏',
            configMaxTokens: 111,
        });

        expect(PresetRuntime.getActiveGenParams).toHaveBeenCalledWith('chat.proactive');
        expect(PresetRuntime.getActivePresetForScope).toHaveBeenCalledWith('chat.proactive');
        expect(payload.completePrompt).toBeUndefined();
        expect(payload.messages?.map(m => m.content)).toEqual(['PRESET 小夏 -> 阿澈', 'COMPLETE_PROMPT']);
        expect(payload.temperature).toBe(0.33);
        expect(payload.maxTokens).toBe(345);
    });

    it('keeps completePrompt payloads when chat.proactive preset is inactive', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue(null);
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(null);

        const payload = await buildActiveMsg2ScheduledLlmPayload({
            completePrompt: 'COMPLETE_PROMPT',
            charName: '阿澈',
            userName: '小夏',
            configMaxTokens: 222,
        });

        expect(payload).toEqual({ completePrompt: 'COMPLETE_PROMPT', maxTokens: 222 });
    });

    it('can preset-apply SW snapshot base messages without dropping history', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue(null);
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(presetWithMain('SW PRESET {{char}}'));

        const result = await buildChatProactivePresetResult([
            { role: 'system', content: 'SW_SYSTEM' },
            { role: 'user', content: 'RECENT_USER' },
            { role: 'assistant', content: 'RECENT_ASSISTANT' },
        ], { charName: '离线角色', userName: '用户' });

        expect(result.presetApplied).toBe(true);
        expect(result.messages?.map(m => `${m.role}:${m.content}`)).toEqual([
            'system:SW_SYSTEM',
            'system:SW PRESET 离线角色',
            'user:RECENT_USER',
            'assistant:RECENT_ASSISTANT',
        ]);
    });
});
