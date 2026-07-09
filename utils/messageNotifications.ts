import { Message } from '../types';
import { DB } from './db';

export const cleanMessagePreview = (content: string, type?: string): string => {
    const cleaned = (content || '').replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
    if (cleaned) return cleaned;
    if (type === 'image') return '[图片]';
    if (type === 'emoji') return '[表情]';
    if (type === 'voice') return '[语音]';
    if (type === 'transfer') return '[转账]';
    if (type === 'location') return '[位置]';
    if (type === 'music_card') return '[音乐分享]';
    if (type === 'call_log') return '[通话]';
    if (type === 'takeout_card') return '[外卖小票]';
    if (type === 'proposal_card') return '[求婚]';
    if (type === 'gift_card') return '[礼物]';
    if (type === 'parcel_card') return content?.includes('蛙游') ? '[蛙游收件]' : content?.includes('主动') ? '[主动寄来]' : '[小包裹]';
    return '[消息]';
};

export const visiblePrivateMessages = (messages: Message[]): Message[] => (
    messages.filter(m => m.role !== 'system' && !m.groupId && !m.metadata?.hidden)
);

export const getLatestPrivateMessage = async (charId: string): Promise<Message | undefined> => {
    const recent = await DB.getRecentMessagesByCharId(charId, 64, true);
    const visible = visiblePrivateMessages(recent);
    return visible[visible.length - 1];
};

export const getUnreadPrivateBubbles = async (charId: string, count: number): Promise<Message[]> => {
    const safeCount = Math.max(1, Math.floor(Number(count)) || 1);
    const recent = await DB.getRecentMessagesByCharId(charId, safeCount + 24, true);
    return visiblePrivateMessages(recent)
        .filter(m => m.role === 'assistant')
        .slice(-safeCount);
};

export const previewForMessage = (message?: Message, fallback = '发来了一条新消息'): string => {
    if (!message) return fallback;
    const preview = cleanMessagePreview(message.content, message.type);
    return preview === '[消息]' ? fallback : preview;
};
