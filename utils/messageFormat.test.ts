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

describe('normalizeMessageContent parcel cards', () => {
    const parcelMessage = (role: Message['role']): Message => ({
        id: 2,
        charId: 'char-a',
        role,
        type: 'parcel_card',
        content: '[日常寄物]',
        timestamp: 0,
        metadata: {
            parcel: {
                id: 'parcel-1',
                direction: role === 'user' ? 'user_to_char' : 'char_to_user',
                senderRole: role === 'user' ? 'user' : 'char',
                fromName: role === 'user' ? '用户' : '小莫',
                toName: role === 'user' ? '小莫' : '用户',
                itemName: '热饮',
                emoji: '☕',
                method: '同城跑腿',
                note: '趁热喝',
                at: 0,
            },
        },
    });

    it('formats user-to-character daily parcels separately from shop gifts', () => {
        expect(normalizeMessageContent(parcelMessage('user'), '小莫', '用户')).toBe(
            '[日常寄物] 用户寄给小莫 ☕热饮，同城跑腿，附言「趁热喝」',
        );
    });

    it('formats character-to-user daily parcels from the character side', () => {
        expect(normalizeMessageContent(parcelMessage('assistant'), '小莫', '用户')).toBe(
            '[日常寄物] 小莫寄给用户 ☕热饮，同城跑腿，附言「趁热喝」',
        );
    });

    it('formats proactive character parcels separately from requested parcels', () => {
        const msg = parcelMessage('assistant');
        msg.content = '[主动寄来]';
        msg.metadata!.parcel = {
            ...msg.metadata!.parcel,
            mode: 'proactive',
            note: '突然想到你，就寄来了。',
        };

        expect(normalizeMessageContent(msg, '小莫', '用户')).toBe(
            '[主动寄来] 小莫寄给用户 ☕热饮，同城跑腿，附言「突然想到你，就寄来了。」',
        );
    });

    it('formats travel-frog received parcels with origin and travel snippet', () => {
        const msg = parcelMessage('assistant');
        msg.content = '[蛙游收件]';
        msg.metadata!.parcel = {
            ...msg.metadata!.parcel,
            mode: 'travel_frog',
            itemName: '风景明信片',
            emoji: '🏞️',
            method: '旅行邮筒',
            originLabel: '海边小站',
            travelSnippet: '路过蓝色站台时想寄给你',
            note: '给你看一眼今天的海。',
        };

        expect(normalizeMessageContent(msg, '小莫', '用户')).toBe(
            '[蛙游收件] 小莫寄给用户 🏞️风景明信片，旅行邮筒，来自海边小站，路上见闻「路过蓝色站台时想寄给你」，附言「给你看一眼今天的海。」',
        );
    });
});
