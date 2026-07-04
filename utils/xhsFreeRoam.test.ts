import { describe, expect, it } from 'vitest';
import type { XhsActivityRecord } from '../types';
import { formatXhsActivityChatRecord } from './xhsFreeRoam';

describe('xhs free roam chat records', () => {
  it('keeps visible chat records factual without internal thinking', () => {
    const activity: XhsActivityRecord = {
      id: 'activity-1',
      characterId: 'char-1',
      timestamp: 1,
      actionType: 'search',
      content: {
        keyword: '雨天咖啡',
        notesViewed: [{ noteId: 'n1', title: '雨夜拿铁', desc: '小店', author: 'Nina', likes: 12 }],
        savedTopics: [{ title: '适合雨天的店', desc: '下次去看看', noteId: 'n2' }],
      },
      thinking: '我想看看有没有适合约她去的地方。',
      result: 'success',
    };

    const record = formatXhsActivityChatRecord(activity, '阿迟');

    expect(record).toContain('阿迟的自由活动');
    expect(record).toContain('雨天咖啡');
    expect(record).toContain('雨夜拿铁');
    expect(record).toContain('适合雨天的店');
    expect(record).not.toContain('内心想法');
    expect(record).not.toContain('我想看看');
  });
});
