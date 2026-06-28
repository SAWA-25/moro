import type { PhoneLockState, PhoneLockSubmission, PhoneLockQuestion, PhoneLockAttemptRecord } from '../types';

const DEFAULT_LOCK_MESSAGE = (ownerUserName: string, charName: string) =>
  `${ownerUserName || '用户'} 锁住了 ${charName || 'TA'} 的手机。请先读完留言，再输入正确口令解锁；题目只用于交流和提示。`;

export const sanitizePhoneLockPasscode = (value: string | undefined | null): string =>
  String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);

const comparePhoneLockPasscode = (a: string | undefined | null, b: string | undefined | null): boolean =>
  sanitizePhoneLockPasscode(a).toLocaleLowerCase() === sanitizePhoneLockPasscode(b).toLocaleLowerCase();

export const normalizePhoneLockQuestions = (questions: Array<string | PhoneLockQuestion> | undefined | null): PhoneLockQuestion[] => {
  const out: PhoneLockQuestion[] = [];
  for (const item of questions || []) {
    const text = typeof item === 'string' ? item : item?.text;
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const id = typeof item === 'string' ? '' : String(item?.id || '');
    out.push({ id: id || `q-${out.length + 1}-${Math.random().toString(36).slice(2, 8)}`, text: clean.slice(0, 160) });
  }
  return out.slice(0, 6);
};

export const buildPhoneLockQuestions = (input: {
  presetQuestions: string[];
  customDraft?: string;
  max?: number;
}): string[] => {
  const max = Math.max(1, Math.min(6, input.max ?? 3));
  const seen = new Set<string>();
  const custom: string[] = [];
  const fallback: string[] = [];
  const push = (value: string) => {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    custom.push(clean.slice(0, 160));
  };
  String(input.customDraft || '').split(/\n+/).forEach(push);
  if (custom.length) return custom.slice(0, max);
  (input.presetQuestions || []).forEach(value => {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    fallback.push(clean.slice(0, 160));
  });
  return fallback.slice(0, max);
};

export const createPhoneLockState = (input: {
  ownerUserName: string;
  charName: string;
  note?: string;
  message?: string;
  passcode?: string;
  questions?: Array<string | PhoneLockQuestion>;
  now?: number;
}): PhoneLockState => {
  const now = input.now ?? Date.now();
  const passcode = sanitizePhoneLockPasscode(input.passcode);
  const questions = normalizePhoneLockQuestions(input.questions);
  const note = (input.note || '').trim().slice(0, 500);
  return {
    id: `phone-lock-${now}-${Math.random().toString(36).slice(2, 8)}`,
    active: true,
    createdAt: now,
    ownerUserName: input.ownerUserName || '用户',
    charName: input.charName || 'TA',
    message: (input.message || DEFAULT_LOCK_MESSAGE(input.ownerUserName, input.charName)).trim().slice(0, 280),
    note: note || DEFAULT_LOCK_MESSAGE(input.ownerUserName, input.charName),
    passcode,
    questions,
    attempts: [],
  };
};

const isMeaningfulAnswer = (answer: string | undefined | null): boolean => String(answer || '').trim().length > 0;

export const evaluatePhoneLockSubmission = (
  lock: PhoneLockState,
  submission: PhoneLockSubmission,
  now = Date.now(),
): { unlocked: boolean; reason: 'passcode' | 'question' | 'both' | 'none'; completedQuestionId?: string; nextLock: PhoneLockState } => {
  const passcodeInput = sanitizePhoneLockPasscode(submission.passcodeInput);
  const answers = Array.isArray(submission.answers) ? submission.answers.map(a => String(a || '').trim().slice(0, 240)) : [];
  const passcodeOk = !!lock.passcode && comparePhoneLockPasscode(passcodeInput, lock.passcode);
  let completedQuestionId: string | undefined;
  const idx = answers.findIndex((answer, answerIdx) => !!lock.questions[answerIdx] && isMeaningfulAnswer(answer));
  if (idx >= 0) completedQuestionId = lock.questions[idx]?.id || `q-${idx + 1}`;
  const reason: 'passcode' | 'question' | 'both' | 'none' = passcodeOk && completedQuestionId ? 'both' : passcodeOk ? 'passcode' : completedQuestionId ? 'question' : 'none';
  const unlocked = passcodeOk;
  const record: PhoneLockAttemptRecord = {
    at: now,
    passcodeInput,
    answers,
    result: reason,
    completedQuestionId,
    reply: submission.reply ? String(submission.reply).trim().slice(0, 240) : undefined,
    mood: submission.mood ? String(submission.mood).trim().slice(0, 120) : undefined,
  };
  return {
    unlocked,
    reason,
    completedQuestionId,
    nextLock: {
      ...lock,
      active: unlocked ? false : lock.active,
      unlockedAt: unlocked ? now : lock.unlockedAt,
      unlockedBy: unlocked ? (completedQuestionId ? 'both' : 'passcode') : lock.unlockedBy,
      attempts: [...(lock.attempts || []), record].slice(-20),
    },
  };
};

export const isPhoneLocked = (lock: PhoneLockState | undefined | null, now = Date.now()): boolean => {
  void now;
  return !!lock?.active;
};
