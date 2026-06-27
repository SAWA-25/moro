import { describe, expect, it } from 'vitest';
import type { GroupProfile, Message } from '../types';
import {
    buildGroupChatFilename,
    exportGroupChatArchive,
    parseGroupChatArchive,
    serializeGroupChatJsonl,
} from './groupChatArchive';

const group: GroupProfile = {
    id: 'group-1',
    name: '周末小队',
    members: ['char-a', 'char-b'],
    createdAt: 1700000000000,
    chatArchiveTitle: '六月夜谈',
};

const messages: Message[] = [
    { id: 1, charId: 'user', groupId: 'group-1', role: 'user', type: 'text', content: '今晚吃什么？', timestamp: 1700000001000 },
    { id: 2, charId: 'char-a', groupId: 'group-1', role: 'assistant', type: 'text', content: '火锅。', timestamp: 1700000002000 },
    { id: 3, charId: 'system', groupId: 'group-1', role: 'system', type: 'system', content: '你修改了群公告', timestamp: 1700000003000 },
];

describe('group chat archive', () => {
    it('exports and parses Moro group chat archives without preserving IndexedDB ids', () => {
        const raw = exportGroupChatArchive(group, messages, {
            memberNames: { 'char-a': '阿一', 'char-b': '阿二', user: '我' },
            exportedAt: 1700000009000,
        });

        const parsed = parseGroupChatArchive(raw, 'target-group');

        expect(parsed.title).toBe('六月夜谈');
        expect(parsed.source).toBe('moro');
        expect(parsed.group.name).toBe('周末小队');
        expect(parsed.messages).toHaveLength(3);
        expect(parsed.messages[0]).toMatchObject({
            charId: 'user',
            groupId: 'target-group',
            role: 'user',
            type: 'text',
            content: '今晚吃什么？',
            timestamp: 1700000001000,
        });
        expect(parsed.messages[0].id).toBe(0);
        expect(parsed.messages[1].metadata?.speakerName).toBe('阿一');
    });

    it('parses SillyTavern JSONL group chats with chat_metadata header', () => {
        const raw = [
            JSON.stringify({ user_name: '旅人', character_name: 'Group chat', chat_metadata: { name: 'ST 开局', note: 'header' } }),
            JSON.stringify({ name: '旅人', is_user: true, send_date: '2026-06-01T12:00:00.000Z', mes: '大家在吗？' }),
            JSON.stringify({ name: '阿一', is_user: false, send_date: '2026-06-01T12:01:00.000Z', mes: '在。', extra: { character_id: 'char-a' } }),
            JSON.stringify({ name: '阿二', is_user: false, send_date: 1780315320000, mes: '刚到。' }),
        ].join('\n');

        const parsed = parseGroupChatArchive(raw, 'group-import', {
            characterNameMap: { '阿一': 'char-a', '阿二': 'char-b' },
            userName: '旅人',
        });

        expect(parsed.source).toBe('sillytavern');
        expect(parsed.title).toBe('ST 开局');
        expect(parsed.messages.map(m => m.charId)).toEqual(['user', 'char-a', 'char-b']);
        expect(parsed.messages.map(m => m.role)).toEqual(['user', 'assistant', 'assistant']);
        expect(parsed.messages[0].timestamp).toBe(Date.parse('2026-06-01T12:00:00.000Z'));
        expect(parsed.messages[2].timestamp).toBe(1780315320000);
    });

    it('serializes Moro messages to ST-style JSONL with a metadata header', () => {
        const raw = serializeGroupChatJsonl(group, messages, {
            memberNames: { 'char-a': '阿一', 'char-b': '阿二', user: '旅人' },
            exportedAt: 1700000009000,
        });
        const lines = raw.split('\n').map(line => JSON.parse(line));

        expect(lines[0].chat_metadata.title).toBe('六月夜谈');
        expect(lines[1]).toMatchObject({ name: '旅人', is_user: true, mes: '今晚吃什么？' });
        expect(lines[2]).toMatchObject({ name: '阿一', is_user: false, mes: '火锅。' });
    });

    it('builds safe archive filenames from group names and titles', () => {
        expect(buildGroupChatFilename({ ...group, name: 'A/B:*?', chatArchiveTitle: '今晚/火锅' }, 1700000000000))
            .toMatch(/^今晚_火锅-\d{4}-\d{2}-\d{2}-\d{4}\.moro-group-chat\.json$/);
        expect(buildGroupChatFilename({ ...group, chatArchiveTitle: '' }, 1700000000000))
            .toMatch(/^周末小队-\d{4}-\d{2}-\d{2}-\d{4}\.moro-group-chat\.json$/);
    });
});
