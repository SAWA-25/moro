import { describe, expect, it } from 'vitest';
import {
  HIDDEN_PROMPT_TAG,
  PROMPT_PRIVACY_RULE,
  sanitizeAssistantVisibleText,
  wrapHiddenPromptBlock,
} from './promptPrivacy';

describe('prompt privacy helpers', () => {
  it('wraps internal prompt material in a hidden block with the privacy rule', () => {
    const wrapped = wrapHiddenPromptBlock('worldbook', '秘密设定');

    expect(wrapped).toContain(`<${HIDDEN_PROMPT_TAG} kind="worldbook">`);
    expect(wrapped).toContain(PROMPT_PRIVACY_RULE);
    expect(wrapped).toContain('秘密设定');
    expect(wrapped).toContain(`</${HIDDEN_PROMPT_TAG}>`);
  });

  it('removes hidden blocks and prompt leak lines from visible assistant text', () => {
    const text = [
      wrapHiddenPromptBlock('memory', '这段不能出现在气泡里'),
      '系统提示：只输出 JSON 对象。',
      '根据我的人设，我应该先分析。',
      '我在。',
    ].join('\n');

    expect(sanitizeAssistantVisibleText(text)).toBe('我在。');
  });

  it('removes leaked queued-reply task wording', () => {
    const text = [
      '当前要回应的消息（2026/7/5 07:00:00）：「你就说你换不换吧」',
      '不要提前回答后面还没轮到的消息。',
      '嗯。',
    ].join('\n');

    expect(sanitizeAssistantVisibleText(text)).toBe('嗯。');
  });

  it('removes leaked proactive catch-up task wording', () => {
    const text = [
      '未回复消息：',
      '写法要求：像真人隔了一会儿才回消息。',
      '我刚才看到了，没装没看见。',
    ].join('\n');

    expect(sanitizeAssistantVisibleText(text)).toBe('我刚才看到了，没装没看见。');
  });

  it('keeps ordinary roleplay text intact', () => {
    expect(sanitizeAssistantVisibleText('我把伞放门口了，等雨停再走。')).toBe('我把伞放门口了，等雨停再走。');
    expect(sanitizeAssistantVisibleText('这个 3D 模型做得挺细。')).toBe('这个 3D 模型做得挺细。');
  });
});
