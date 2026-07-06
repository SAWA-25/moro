export const FORCE_REPLY_EVENT = 'moro-force-reply-request';
export const FORCE_REPLY_STORAGE_KEY = 'moro_force_reply_pending_v1';

export interface ForceReplyEventDetail {
  charId: string;
  reason?: string;
  body?: string;
  messageId?: number;
  source?: string;
  requestedAt?: number;
}

export interface ForceReplyRequest {
  charId: string;
  charName: string;
  avatar?: string;
  reason?: string;
  body?: string;
  messageId?: number;
  source?: string;
  requestedAt: number;
}

export interface ForceReplyExtractResult {
  content: string;
  forceReply: boolean;
  reason?: string;
}

export interface ForceReplyDialogVisibilityOptions {
  activeApp?: string | null;
  activeCharacterId?: string | null;
  chatAppId?: string;
  isLocked?: boolean;
}

const FORCE_REPLY_RE = /\[\[\s*FORCE_REPLY\s*[:：]?\s*([\s\S]*?)\]\]/gi;

const cleanReason = (value: string | undefined): string | undefined => {
  const reason = String(value || '').replace(/\s+/g, ' ').trim();
  return reason ? reason.slice(0, 180) : undefined;
};

export function extractForceReplyDirective(text: string): ForceReplyExtractResult {
  let forceReply = false;
  let reason: string | undefined;
  const content = String(text || '')
    .replace(FORCE_REPLY_RE, (_match, rawReason: string) => {
      forceReply = true;
      reason = reason || cleanReason(rawReason);
      return '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { content, forceReply, reason };
}

export function shouldShowForceReplyDialog(
  request: ForceReplyRequest | null | undefined,
  options: ForceReplyDialogVisibilityOptions = {},
): boolean {
  if (!request?.charId) return false;
  if (options.isLocked) return true;
  const chatAppId = options.chatAppId || 'chat';
  return !(options.activeApp === chatAppId && options.activeCharacterId === request.charId);
}

export function dispatchForceReplyRequest(detail: ForceReplyEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FORCE_REPLY_EVENT, {
    detail: {
      ...detail,
      requestedAt: detail.requestedAt || Date.now(),
    },
  }));
}
