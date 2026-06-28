import { describe, expect, it } from 'vitest';
import { buildPhoneLockQuestions, createPhoneLockState, evaluatePhoneLockSubmission, isPhoneLocked } from './phoneLock';

describe('phone lock state', () => {
  it('uses user-defined questions first and only falls back to presets when custom is empty', () => {
    const questions = buildPhoneLockQuestions({
      presetQuestions: ['今天有没有想我？', '给我一句晚安。', '你最该做什么？'],
      customDraft: '  自定义第一题  \n\n给我解释一下\n今天有没有想我？\n第四题会被截掉',
    });

    expect(questions).toEqual(['自定义第一题', '给我解释一下', '今天有没有想我？']);

    expect(buildPhoneLockQuestions({
      presetQuestions: ['今天有没有想我？', '给我一句晚安。'],
      customDraft: '',
    })).toEqual(['今天有没有想我？', '给我一句晚安。']);
  });

  it('creates an active black-screen lock with custom questions and normalized passcode answer', () => {
    const lock = createPhoneLockState({
      ownerUserName: '阿絮',
      charName: '沈夜',
      note: '我曾经的席位',
      passcode: '  黑王座  ',
      questions: ['说一句真心话', '', '今天为什么不回我？'],
      now: 1000,
    });

    expect(lock.active).toBe(true);
    expect(lock.passcode).toBe('黑王座');
    expect(lock.note).toBe('我曾经的席位');
    expect(lock.questions.map(q => q.text)).toEqual(['说一句真心话', '今天为什么不回我？']);
    expect(lock.message).toContain('阿絮');
    expect(lock.createdAt).toBe(1000);
    expect(isPhoneLocked(lock, 2000)).toBe(true);
  });

  it('unlocks when the role enters the correct passcode answer even without question answers', () => {
    const lock = createPhoneLockState({ ownerUserName: '我', charName: 'TA', passcode: '黑王座', questions: ['写一句话'] });
    const result = evaluatePhoneLockSubmission(lock, { passcodeInput: ' 黑王座 ', answers: [] }, 3000);

    expect(result.unlocked).toBe(true);
    expect(result.reason).toBe('passcode');
    expect(result.nextLock.active).toBe(false);
    expect(result.nextLock.unlockedAt).toBe(3000);
  });

  it('records completed questions but keeps the lock active when passcode is wrong', () => {
    const lock = createPhoneLockState({ ownerUserName: '我', charName: 'TA', passcode: '黑王座', questions: ['现在最想说什么？', '给我一个解释'] });
    const result = evaluatePhoneLockSubmission(lock, { passcodeInput: '白王座', answers: ['', '我刚才在想怎么哄你。'] }, 4000);

    expect(result.unlocked).toBe(false);
    expect(result.reason).toBe('question');
    expect(result.completedQuestionId).toBe(lock.questions[1].id);
    expect(result.nextLock.active).toBe(true);
  });

  it('unlocks by passcode and records both when a question is also completed', () => {
    const lock = createPhoneLockState({ ownerUserName: '我', charName: 'TA', passcode: 'Open Sesame', questions: ['现在最想说什么？'] });
    const result = evaluatePhoneLockSubmission(lock, { passcodeInput: 'open sesame', answers: ['想见你。'] }, 4500);

    expect(result.unlocked).toBe(true);
    expect(result.reason).toBe('both');
    expect(result.nextLock.unlockedBy).toBe('both');
  });


  it('keeps the lock active when neither passcode nor question is completed', () => {
    const lock = createPhoneLockState({ ownerUserName: '我', charName: 'TA', passcode: '黑王座', questions: ['回答我'] });
    const result = evaluatePhoneLockSubmission(lock, { passcodeInput: '白王座', answers: ['   '] }, 5000);

    expect(result.unlocked).toBe(false);
    expect(result.reason).toBe('none');
    expect(result.nextLock.active).toBe(true);
    expect(result.nextLock.attempts).toHaveLength(1);
  });

  it('does not unlock by answer when there is no matching question slot', () => {
    const lock = createPhoneLockState({ ownerUserName: '我', charName: 'TA', passcode: '黑王座', questions: [] });
    const result = evaluatePhoneLockSubmission(lock, { passcodeInput: '白王座', answers: ['我写了，但没有题。'] }, 6000);

    expect(result.unlocked).toBe(false);
    expect(result.reason).toBe('none');
  });
});
