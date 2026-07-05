import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterProfile, Persona, UserProfile, Worldbook } from '../types';
import { buildFullCharacterSetting, buildFullUserSetting } from './characterPromptProfile';
import { WorldbookRuntime } from './worldbookRuntime';

const wb = (over: Partial<Worldbook> & { id: string; title: string; content: string }): Worldbook => ({
    category: over.category || '测试世界书',
    enabled: over.enabled,
    activation: over.activation || 'always',
    keys: over.keys || [],
    order: over.order || 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
} as Worldbook);

afterEach(() => {
    WorldbookRuntime.sync([], {}, {}, {});
    WorldbookRuntime.setExtraCategories(null);
    WorldbookRuntime.setScanContext(null);
});

describe('character prompt profile', () => {
    it('keeps full character setting text and mounted worldbooks without truncation', () => {
        const longSystem = `核心人设开头 ${'甲'.repeat(1800)} LONG_SYSTEM_SENTINEL`;
        const longWorld = `世界观开头 ${'乙'.repeat(1600)} LONG_WORLD_SENTINEL`;
        const longLife = `生活侧写开头 ${'丙'.repeat(1400)} LONG_LIFE_SENTINEL`;
        const liveBook = wb({
            id: 'live',
            title: '完整局部书',
            content: `世界书正文 ${'丁'.repeat(1500)} LONG_WB_SENTINEL`,
            category: '局部设定',
        });
        const disabledBook = wb({
            id: 'disabled',
            title: '禁用书',
            content: 'DISABLED_WB_SENTINEL',
            category: '局部设定',
            enabled: false,
        });
        const globalBook = wb({
            id: 'global',
            title: '完整全局书',
            content: `全局世界书正文 ${'戊'.repeat(1200)} GLOBAL_WB_SENTINEL`,
            category: '全局设定',
        });
        const disabledGlobalBook = wb({
            id: 'global-disabled',
            title: '禁用全局书',
            content: 'DISABLED_GLOBAL_WB_SENTINEL',
            category: '全局设定',
            enabled: false,
        });
        WorldbookRuntime.sync([liveBook, disabledBook, globalBook, disabledGlobalBook], {}, { 全局设定: 'global' }, {});

        const char: CharacterProfile = {
            id: 'c1',
            name: '阿澈',
            avatar: '',
            description: '列表备注 DESCRIPTION_SENTINEL',
            systemPrompt: longSystem,
            worldview: longWorld,
            memories: [],
            lifeProfile: { content: longLife, generatedAt: 1 },
            appearanceTags: 'silver hair, amber eyes APPEARANCE_SENTINEL',
            writerPersona: '写作时偏爱短句和冷幽默 WRITER_PERSONA_SENTINEL',
            selfInsights: ['SELF_INSIGHT_SENTINEL'],
            mountedWorldbooks: [liveBook, disabledBook],
            memos: [{ id: 'm1', text: 'MEMO_SENTINEL', done: false, createdAt: 1 }],
        } as CharacterProfile;

        const text = buildFullCharacterSetting(char, { includeMemos: true });
        expect(text).toContain('LONG_SYSTEM_SENTINEL');
        expect(text).toContain('LONG_WORLD_SENTINEL');
        expect(text).toContain('LONG_LIFE_SENTINEL');
        expect(text).toContain('LONG_WB_SENTINEL');
        expect(text).toContain('GLOBAL_WB_SENTINEL');
        expect(text).toContain('DESCRIPTION_SENTINEL');
        expect(text).toContain('APPEARANCE_SENTINEL');
        expect(text).toContain('WRITER_PERSONA_SENTINEL');
        expect(text).toContain('SELF_INSIGHT_SENTINEL');
        expect(text).toContain('MEMO_SENTINEL');
        expect(text).not.toContain('DISABLED_WB_SENTINEL');
        expect(text).not.toContain('DISABLED_GLOBAL_WB_SENTINEL');
    });

    it('keeps full user persona text and persona-bound worldbook content', () => {
        const user: UserProfile = {
            name: '旧名字',
            bio: `旧简介 ${'己'.repeat(900)} OLD_BIO_SENTINEL`,
        } as UserProfile;
        const persona: Persona = {
            id: 'p1',
            name: '当前扮相',
            avatar: '',
            title: '页角备注 TITLE_SENTINEL',
            description: `当前人设 ${'庚'.repeat(1300)} PERSONA_SENTINEL`,
            lorebookCategory: '用户人设世界书',
            createdAt: 1,
            updatedAt: 1,
        } as Persona;
        WorldbookRuntime.sync([
            wb({
                id: 'persona-wb',
                title: '用户绑定书',
                content: `用户绑定世界书 ${'辛'.repeat(1200)} USER_WB_SENTINEL`,
                category: '用户人设世界书',
            }),
        ], {}, {}, {});

        const text = buildFullUserSetting(user, { persona });
        expect(text).toContain('当前扮相');
        expect(text).toContain('TITLE_SENTINEL');
        expect(text).toContain('PERSONA_SENTINEL');
        expect(text).toContain('USER_WB_SENTINEL');
        expect(text).not.toContain('OLD_BIO_SENTINEL');
    });
});
