import { describe, it, expect } from 'vitest';
import { extractThinkingChainFromCompletion, extractNativeReasoningFromChoice, stripThinkBlocks } from './llmReasoning';

describe('llmReasoning helpers', () => {
    it('strips visible think blocks from output text', () => {
        expect(stripThinkBlocks('<think>内心</think>台词')).toBe('台词');
        expect(stripThinkBlocks('<thinking>内心')).toBe('');
    });

    it('extracts native reasoning from common alias fields', () => {
        expect(extractNativeReasoningFromChoice({ message: { reasoning: '字段推理' } })).toBe('字段推理');
        expect(extractNativeReasoningFromChoice({ message: { thinking: '字段思绪' } })).toBe('字段思绪');
        expect(extractNativeReasoningFromChoice({ delta: { thought: 'delta思绪' } })).toBe('delta思绪');
    });

    it('extracts thinking chain from completion response', () => {
        const data = {
            choices: [{
                message: {
                    content: '正文 <think>脑内一</think> 尾巴',
                    reasoning_content: 'native reasoning',
                },
            }],
        };
        expect(extractThinkingChainFromCompletion(data)).toBe('native reasoning\n\n脑内一');
    });

    it('works with array-style content carrying reasoning parts', () => {
        const data = {
            choices: [{
                message: {
                    content: [{ type: 'text', text: '正文' }, { type: 'reasoning', text: '分片思绪' }],
                },
            }],
        };
        expect(extractThinkingChainFromCompletion(data)).toBe('分片思绪');
    });
});
