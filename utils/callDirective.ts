export const CALL_USER_RE = /\[\[\s*CALL_USER\s*(?:[:：]\s*[^\]]*?)?\]\]/gi;

export function extractCallUserDirective(content: string): { wantsCall: boolean; content: string } {
  if (!content) return { wantsCall: false, content };
  CALL_USER_RE.lastIndex = 0;
  const wantsCall = CALL_USER_RE.test(content);
  if (!wantsCall) return { wantsCall: false, content };
  return {
    wantsCall: true,
    content: content.replace(CALL_USER_RE, '').trim(),
  };
}
