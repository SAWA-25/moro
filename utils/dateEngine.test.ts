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
});
