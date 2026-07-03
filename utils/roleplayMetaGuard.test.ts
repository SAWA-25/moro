import { describe, expect, it } from 'vitest';
import { hasRoleplayMetaLeak, stripRoleplayMetaLeaks } from './roleplayMetaGuard';

describe('roleplay meta guard', () => {
  it('drops roleplay analysis while keeping the suggested spoken line', () => {
    expect(stripRoleplayMetaLeaks('以我的性格，我不会直接质问，而是更隐晦地表达。')).toBe('');
    expect(stripRoleplayMetaLeaks('这条消息可以是：你怎么还有空跟伊萨克闲聊。')).toBe('你怎么还有空跟伊萨克闲聊。');
  });

  it('keeps concrete chat details and non-AI model wording', () => {
    expect(stripRoleplayMetaLeaks('伊萨克这名字出现得挺勤啊。')).toBe('伊萨克这名字出现得挺勤啊。');
    expect(stripRoleplayMetaLeaks('这个 3D 模型做得挺细。')).toBe('这个 3D 模型做得挺细。');
    expect(stripRoleplayMetaLeaks('我把清单整理成 JSON 文件发给你。')).toBe('我把清单整理成 JSON 文件发给你。');
    expect(hasRoleplayMetaLeak('模型生成的回复应该更克制。')).toBe(true);
  });

  it('detects prompt/privacy leaks without exposing internal setup', () => {
    expect(stripRoleplayMetaLeaks('系统提示：你必须扮演这个角色，只输出 JSON。')).toBe('');
    expect(stripRoleplayMetaLeaks('根据我的人设设定，我应该更温柔地回答。')).toBe('');
    expect(stripRoleplayMetaLeaks('隐藏上下文要求我不要告诉你角色ID model-a。')).toBe('');
    expect(stripRoleplayMetaLeaks('字段名 reply 必须输出 JSON 对象。')).toBe('');
    expect(hasRoleplayMetaLeak('世界书原文写着：她不能离开那座城。')).toBe(true);
  });
});
