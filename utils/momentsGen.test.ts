import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIConfig, CharacterProfile, UserProfile } from '../types';
import { momentsRefreshPrompt } from './laiwangPrompts';
import { generateCharacterMoments, getMomentVisibleCharacters, resolveMomentCharacter } from '../components/moments/momentsGen';

const apiConfig: APIConfig = {
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'sk-test',
    model: 'test-model',
};

const user = {
    name: 'User',
    avatar: '',
    bio: 'tester',
} as UserProfile;

const chars = [
    {
        id: 'local-a',
        modelId: 'model-a',
        name: '林夏',
        avatar: 'lin.png',
        description: '',
        systemPrompt: '爱吐槽，会发很短的生活碎片。',
        memories: [],
    },
    {
        id: 'local-b',
        modelId: 'model-b',
        name: '阿青',
        avatar: 'qing.png',
        description: '',
        systemPrompt: '冷静敏锐，不常发言。',
        memories: [],
    },
] as CharacterProfile[];

afterEach(() => {
    vi.restoreAllMocks();
});

describe('resolveMomentCharacter', () => {
    it('maps model-facing charId back to the local character id', () => {
        expect(resolveMomentCharacter(chars, 'model-a')?.id).toBe('local-a');
        expect(resolveMomentCharacter(chars, 'local-b')?.id).toBe('local-b');
        expect(resolveMomentCharacter(chars, 'missing')).toBeUndefined();
    });
});

describe('moments prompts', () => {
    it('uses floating interaction density instead of hard minimum comment counts', () => {
        const prompt = momentsRefreshPrompt({
            userName: 'User',
            socialCircle: '已建立的用户社交圈：暂无。',
            candidateBlocks: '<<< 角色档案: 林夏 (ID: model-a) charId="model-a" >>>',
            roster: '- 林夏 (ID: model-a) charId="model-a"',
            feedDigest: '(朋友圈暂时是空的)',
        });

        expect(prompt).toContain('禁止');
        expect(prompt).toContain('绝对禁止');
        expect(prompt).toContain('NPC 关系网只能从这里展开');
        expect(prompt).not.toMatch(/每条动态都必须|至少 10|10~16|15~16/);
    });
});

describe('generateCharacterMoments identity mapping', () => {
    it('writes local ids after modelId output and filters unknown characters/user NPCs', async () => {
        const payload = [
            {
                authorKind: 'character',
                charId: 'model-a',
                content: '今天在便利店门口站了两分钟，最后还是没买那杯冰咖啡。',
                heat: 'normal',
                likedByCharIds: ['model-b', 'missing-char'],
                likedByNpcNames: ['User', '小周'],
                comments: [
                    { charId: 'model-b', content: '省钱了。' },
                    { charId: 'missing-char', content: '这条不该留下' },
                    { npcName: 'User', content: '用户不能变成 NPC 评论' },
                    { npcName: '小周', content: '便利店那家确实一般' },
                ],
            },
            {
                authorKind: 'character',
                charId: 'missing-char',
                content: '未知角色动态应丢弃',
            },
            {
                authorKind: 'npc',
                npcName: 'User',
                content: '用户本人不能被当成 NPC 发动态',
            },
        ];
        let requestBody: any = null;
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
            requestBody = JSON.parse(String((init as RequestInit).body || '{}'));
            return new Response(JSON.stringify({
                choices: [{ message: { content: JSON.stringify(payload) } }],
            }), { status: 200 });
        }));

        const posts = await generateCharacterMoments({
            apiConfig,
            characters: chars,
            userProfile: user,
            feed: [],
        });

        expect(requestBody?.messages?.[0]?.content).toContain('charId="model-a"');
        expect(requestBody?.messages?.[0]?.content).not.toContain('charId="local-a"');
        expect(posts).toHaveLength(1);
        expect(posts[0].authorCharId).toBe('local-a');
        expect(posts[0].likedBy).toEqual([
            { id: 'local-b', name: '阿青' },
            { id: 'npc-小周', name: '小周' },
        ]);
        expect(posts[0].comments.map(c => c.content)).toEqual(['省钱了。', '便利店那家确实一般']);
        expect(posts[0].comments[0].authorCharId).toBe('local-b');
        expect(posts[0].comments.some(c => c.authorName === 'User')).toBe(false);
    });

    it('does not materialize NPC content when the user social circle is disabled', async () => {
        const closedUser = {
            ...user,
            ambientSocialEnabled: false,
            ambientSocial: {
                version: 1,
                seededAt: 1,
                entries: [{
                    id: 'amb-nina',
                    kind: 'contact',
                    name: 'Nina',
                    relation: 'friend',
                    relationLabel: 'friend',
                    avatar: '',
                    note: 'old ambient friend',
                    lastMessage: 'hi',
                    lastAt: 1,
                    createdAt: 1,
                }],
            },
        } as UserProfile;
        const payload = [
            { authorKind: 'npc', npcName: 'Nina', content: 'hidden npc post' },
            {
                authorKind: 'character',
                charId: 'model-a',
                content: 'visible character post',
                likedByNpcNames: ['Nina', 'Random Stranger'],
                comments: [
                    { npcName: 'Nina', content: 'hidden comment' },
                    { npcName: 'Random Stranger', content: 'random comment' },
                ],
            },
        ];
        let requestBody: any = null;
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
            requestBody = JSON.parse(String((init as RequestInit).body || '{}'));
            return new Response(JSON.stringify({
                choices: [{ message: { content: JSON.stringify(payload) } }],
            }), { status: 200 });
        }));

        const posts = await generateCharacterMoments({
            apiConfig,
            characters: chars,
            userProfile: closedUser,
            feed: [],
        });

        expect(requestBody?.messages?.[0]?.content).toContain('禁止生成任何 NPC');
        expect(posts).toHaveLength(1);
        expect(posts[0].authorType).toBe('character');
        expect(posts[0].likedBy).toEqual([]);
        expect(posts[0].comments).toEqual([]);
    });

    it('filters connected ambient NPC characters when converted contacts are hidden', async () => {
        const ambientChar = {
            id: 'npc-char',
            modelId: 'npc-model',
            name: 'Nina',
            avatar: 'nina.png',
            description: '',
            systemPrompt: 'ambient',
            memories: [],
            ambientSocialSource: { entryId: 'amb-nina' },
        } as CharacterProfile;
        const profile = {
            ...user,
            ambientSocialHideConverted: true,
            ambientSocial: {
                version: 1,
                seededAt: 1,
                entries: [{
                    id: 'amb-nina',
                    kind: 'contact',
                    name: 'Nina',
                    relation: 'friend',
                    relationLabel: 'friend',
                    avatar: '',
                    note: 'ambient friend',
                    lastMessage: 'hi',
                    lastAt: 1,
                    createdAt: 1,
                    linkedCharId: 'npc-char',
                }],
            },
        } as UserProfile;
        const payload = [
            { authorKind: 'character', charId: 'npc-model', content: 'hidden converted character post' },
            { authorKind: 'character', charId: 'model-a', content: 'visible character post' },
        ];
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify(payload) } }],
        }), { status: 200 })));

        expect(getMomentVisibleCharacters([...chars, ambientChar], profile).map(c => c.id)).toEqual(['local-a', 'local-b']);
        const posts = await generateCharacterMoments({
            apiConfig,
            characters: [...chars, ambientChar],
            userProfile: profile,
            feed: [],
        });

        expect(posts).toHaveLength(1);
        expect(posts[0].authorCharId).toBe('local-a');
    });
});
