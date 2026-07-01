import { describe, expect, it } from 'vitest';
import { characterDialogueGuidance } from './laiwangPrompts';

describe('laiwang prompt copy', () => {
  it('explains how character settings become natural dialogue', () => {
    const text = characterDialogueGuidance('小夏');

    expect(text).toContain('角色设定的自然对话方式');
    expect(text).toContain('而不是逐条复述给小夏听');
    expect(text).toContain('对话示例只用来学习说话节奏');
    expect(text).toContain('它们不是实际发生过的历史');
  });
});
