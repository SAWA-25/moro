import { describe, expect, it } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import { applyCharacterEditorMacros, bakeCharacterEditorMacros } from './characterEditorMacros';

const char = { name: '阿澈' } as CharacterProfile;
const user = { name: '阿月', bio: '喜欢夜跑。' } as UserProfile;

describe('character editor macros', () => {
    it('bakes user and character macros with the active user profile', () => {
        expect(bakeCharacterEditorMacros('{{char}}会给{{user}}写信，<char>认识<user>。', char, user))
            .toBe('阿澈会给阿月写信，阿澈认识阿月。');
        expect(bakeCharacterEditorMacros('{{date}} {{persona}} {{unknown}}', char, user))
            .toBe('{{date}} {{persona}} {{unknown}}');
    });

    it('auto-bakes character card text fields in the editor', () => {
        const text = '设定：{{char}}总提醒{{user}}早点睡。';

        expect(applyCharacterEditorMacros('systemPrompt', text, char, user))
            .toBe('设定：阿澈总提醒阿月早点睡。');
        expect(applyCharacterEditorMacros('worldview', text, char, user))
            .toBe('设定：阿澈总提醒阿月早点睡。');
        expect(applyCharacterEditorMacros('mesExample', '{{user}}: 晚安\n{{char}}: 晚安。', char, user))
            .toBe('阿月: 晚安\n阿澈: 晚安。');
        expect(applyCharacterEditorMacros('firstMes', '终于等到{{user}}了。', char, user))
            .toBe('终于等到阿月了。');
    });

    it('auto-bakes alternate greeting arrays but leaves unrelated fields alone', () => {
        expect(applyCharacterEditorMacros('alternateGreetings', ['你好，{{user}}。', '{{char}}到了。'], char, user))
            .toEqual(['你好，阿月。', '阿澈到了。']);
        expect(applyCharacterEditorMacros('description', '备注：{{user}}', char, user))
            .toBe('备注：{{user}}');
    });
});
