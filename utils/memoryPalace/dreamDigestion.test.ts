import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from '../db';
import { callChatCompletion } from '../llmClient';
import { MemoryNodeDB } from './db';
import { runLocalDreamDigestion } from './dreamDigestion';
import type { MemoryNode } from './types';

vi.mock('../llmClient', () => ({
    callChatCompletion: vi.fn(),
}));

const CHAR = 'dream-digestion-char';
const API = { baseUrl: 'https://api.test/v1', apiKey: 'test-key', model: 'dream-model' };

function node(id: string, patch: Partial<MemoryNode> = {}): MemoryNode {
    const now = Date.now();
    return {
        id,
        charId: CHAR,
        content: `源记忆 ${id}`,
        room: 'bedroom',
        tags: ['源'],
        importance: 8,
        mood: 'tender',
        embedded: true,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        cognitiveLayer: 'event',
        sourceMessageIds: [101, 102],
        sourceQuote: '用户说了一句值得记住的话。',
        ...patch,
    };
}

beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await DB.deleteDB();
});

describe('runLocalDreamDigestion', () => {
    it('does nothing when there is no local material', async () => {
        const result = await runLocalDreamDigestion(CHAR, 'Moro', '', API);

        expect(result.status).toBe('no_material');
        expect(callChatCompletion).not.toHaveBeenCalled();
    });

    it('uses only the chat API and stores local feel memories', async () => {
        await MemoryNodeDB.save(node('source-a'));
        vi.mocked(callChatCompletion).mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify([{
                        layer: 'feel',
                        content: '我醒来时还记得那句话的温度。',
                        sourceRefs: ['M0'],
                        tags: ['梦境消化', '安心'],
                        mood: 'tender',
                        importance: 7,
                        valence: 0.4,
                        arousal: -0.2,
                    }]),
                },
                finish_reason: 'stop',
            }],
        } as any);

        const result = await runLocalDreamDigestion(CHAR, 'Moro', '温柔、慢热', API, '你');
        const nodes = await MemoryNodeDB.getByCharId(CHAR);
        const dream = nodes.find(n => n.origin === 'digestion');
        const source = await MemoryNodeDB.getById('source-a');

        expect(result.status).toBe('done');
        expect(result.stored).toBe(1);
        expect(dream).toMatchObject({
            content: '我醒来时还记得那句话的温度。',
            cognitiveLayer: 'feel',
            embedded: false,
            room: 'attic',
            sourceId: 'source-a',
            sourceMessageIds: [101, 102],
        });
        expect(dream?.sourceQuote).toContain('用户说了一句值得记住的话。');
        expect(source?.internalized).toBe(true);
        expect(source?.resolved).toBe(true);
        expect(callChatCompletion).toHaveBeenCalledTimes(1);
    });
});
