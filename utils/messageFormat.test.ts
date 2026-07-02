import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { normalizeMessageContent } from './messageFormat';

const musicMessage = (role: Message['role']): Message => ({
    id: 1,
    charId: 'char-a',
    role,
    type: 'music_card',
    content: '[音乐卡片]',
    timestamp: 0,
    metadata: {
        intent: 'share',
        song: {
            id: 100,
            songId: 100,
            name: '晴天',
            artists: '周杰伦',
            album: '叶惠美',
            albumPic: '',
            duration: 269,
            fee: 0,
        },
    },
});

describe('normalizeMessageContent music cards', () => {
    it('formats user-to-character music shares from the user perspective', () => {
        expect(normalizeMessageContent(musicMessage('user'), '小莫', '用户')).toBe(
            '[音乐卡片] 用户把《晴天》— 周杰伦分享给小莫',
        );
    });

    it('keeps assistant music shares in the character perspective', () => {
        expect(normalizeMessageContent(musicMessage('assistant'), '小莫', '用户')).toBe(
            '[音乐卡片] 小莫主动分享给用户一首歌：《晴天》— 周杰伦',
        );
    });
});
