import { describe, expect, it } from 'vitest';
import type { CharacterProfile, DateScene, DateWorldline, UserProfile } from '../types';
import { buildDateTurnPrompt } from './dateEngine';

describe('dateEngine prompt context', () => {
    it('keeps full character setting and full active user setting in each roleplay turn', () => {
        const char = {
            id: 'char-date-full-context',
            name: '阿澈',
            avatar: '',
            description: '角色简介不应替代完整设定',
            systemPrompt: `完整核心人设 ${'甲'.repeat(1200)} FULL_DATE_CHAR_SENTINEL`,
            worldview: '角色世界观 FULL_DATE_WORLD_SENTINEL',
            memories: [],
        } as CharacterProfile;
        const user = {
            name: '旧档案名',
            bio: '旧档案简介不应替代当前完整扮相',
        } as UserProfile;
        const scene: DateScene = {
            id: 'scene',
            name: '雨天街角',
            emoji: '🌧️',
            vibe: '雨声和靠近',
            opening: '雨落下来。',
        };
        const worldline: DateWorldline = {
            id: 'worldline',
            charId: char.id,
            sceneId: scene.id,
            sceneName: scene.name,
            sceneEmoji: scene.emoji,
            vibe: scene.vibe,
            title: '雨中一线',
            createdAt: 1,
            updatedAt: 1,
            turnCount: 0,
            messages: [],
        };
        const roleContext = [
            `【完整角色设定】\n角色名：${char.name}\n【核心人设】\n${char.systemPrompt}\n【世界观/背景】\n${char.worldview}`,
            `【完整用户设定】\n用户名：当前扮相\n【扮相手账自述】\n${'乙'.repeat(1200)} FULL_DATE_USER_SENTINEL\n【扮相手账绑定世界书】\nFULL_DATE_USER_WORLDBOOK_SENTINEL`,
        ].join('\n\n');

        const prompt = buildDateTurnPrompt(
            char,
            user,
            scene,
            worldline,
            '我们在这里躲雨吧。',
            '把伞往你那边偏了偏',
            true,
            roleContext,
        );

        expect(prompt).toContain('FULL_DATE_CHAR_SENTINEL');
        expect(prompt).toContain('FULL_DATE_WORLD_SENTINEL');
        expect(prompt).toContain('FULL_DATE_USER_SENTINEL');
        expect(prompt).toContain('FULL_DATE_USER_WORLDBOOK_SENTINEL');
    });

    it('asks for and carries forward character inner OS', () => {
        const char = {
            id: 'char-date-thinking',
            name: '阿澈',
            avatar: '',
            description: '雨天会下意识照顾人',
            systemPrompt: '雨天会下意识照顾人',
            memories: [],
        } as CharacterProfile;
        const user = { name: '小夏' } as UserProfile;
        const scene: DateScene = {
            id: 'rain',
            name: '雨天街角',
            emoji: '🌧️',
            vibe: '雨声和靠近',
            opening: '雨落下来。',
        };
        const worldline: DateWorldline = {
            id: 'worldline-thinking',
            charId: char.id,
            sceneId: scene.id,
            sceneName: scene.name,
            sceneEmoji: scene.emoji,
            vibe: scene.vibe,
            title: '雨中一线',
            createdAt: 1,
            updatedAt: 1,
            turnCount: 1,
            messages: [
                {
                    id: 'm1',
                    role: 'char',
                    speech: '慢点，别踩到水。',
                    thinking: '她把伞往我这边偏了，我不能表现得太明显。',
                    ts: 1,
                },
            ],
        };

        const prompt = buildDateTurnPrompt(
            char,
            user,
            scene,
            worldline,
            '你也靠过来一点。',
            '',
            false,
            '完整角色和用户设定',
        );

        expect(prompt).toContain('"thinking"');
        expect(prompt).toContain('内心OS');
        expect(prompt).toContain('心里想：她把伞往我这边偏了');
    });

    it('switches to side narration without placing the character in scene', () => {
        const char = {
            id: 'char-date-side',
            name: '阿澈',
            avatar: '',
            description: '侧幕测试角色',
            systemPrompt: '不应在侧幕里登场',
            memories: [],
        } as CharacterProfile;
        const user = { name: '小夏' } as UserProfile;
        const scene: DateScene = {
            id: 'market',
            name: '旧街夜市',
            emoji: '🏮',
            vibe: '人声、灯影、支线线索',
            opening: '夜市亮起来。',
        };
        const worldline: DateWorldline = {
            id: 'worldline-side',
            charId: char.id,
            sceneId: scene.id,
            sceneName: scene.name,
            sceneEmoji: scene.emoji,
            vibe: scene.vibe,
            title: '夜市侧影',
            createdAt: 1,
            updatedAt: 1,
            turnCount: 1,
            sideNarrationEnabled: true,
            messages: [],
        };

        const prompt = buildDateTurnPrompt(
            char,
            user,
            scene,
            worldline,
            '去问问摊主刚才看见了什么。',
            '独自走进巷口',
            false,
            '完整角色和用户设定',
            true,
        );

        expect(prompt).toContain('侧幕描写模式');
        expect(prompt).toContain('阿澈」不在当前现场');
        expect(prompt).toContain('char_speech、char_action、thinking 必须为空字符串');
        expect(prompt).toContain('不要让 阿澈 回应');
    });
});
