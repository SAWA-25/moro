import type { ListenAction, ListenMsg } from './listenTogether';

const STORAGE_KEY = 'moro_music_listen_together_session_v1';
const MAX_MESSAGES = 80;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ListenTogetherSession {
  charId: string;
  messages: ListenMsg[];
  input: string;
  updatedAt: number;
  songId?: number | null;
  songName?: string;
}

export interface ListenActionNotice {
  title: string;
  body: string;
  toast: string;
  tag: string;
}

const getStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const sanitizeAction = (value: unknown): ListenAction | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const action = value as Partial<ListenAction>;
  if (action.kind === 'none') return { kind: 'none' };
  if (action.kind === 'pause' || action.kind === 'resume' || action.kind === 'previous' || action.kind === 'next') return { kind: action.kind };
  if (action.kind === 'seek') {
    const seconds = Number(action.seconds);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return { kind: 'seek', seconds: Math.round(seconds * 10) / 10 };
    }
  }
  if (action.kind === 'change_song' && typeof action.query === 'string' && action.query.trim()) {
    return { kind: 'change_song', query: action.query.trim().slice(0, 80) };
  }
  return undefined;
};

const sanitizeMessages = (messages: unknown): ListenMsg[] => {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((msg): ListenMsg | null => {
      if (!msg || typeof msg !== 'object') return null;
      const raw = msg as Partial<ListenMsg>;
      if (raw.role !== 'user' && raw.role !== 'char') return null;
      if (typeof raw.text !== 'string') return null;
      const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : Date.now();
      const action = sanitizeAction(raw.action);
      return {
        role: raw.role,
        text: raw.text.slice(0, 4000),
        at,
        ...(action ? { action } : {}),
      };
    })
    .filter((msg): msg is ListenMsg => !!msg)
    .slice(-MAX_MESSAGES);
};

export function loadListenTogetherSession(
  storage: StorageLike | null = getStorage(),
  now = Date.now(),
): ListenTogetherSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ListenTogetherSession>;
    if (!parsed || typeof parsed.charId !== 'string' || !parsed.charId.trim()) return null;
    const updatedAt = typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
      ? parsed.updatedAt
      : now;
    if (now - updatedAt > MAX_AGE_MS) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      charId: parsed.charId,
      messages: sanitizeMessages(parsed.messages),
      input: typeof parsed.input === 'string' ? parsed.input.slice(0, 1000) : '',
      updatedAt,
      songId: typeof parsed.songId === 'number' ? parsed.songId : null,
      songName: typeof parsed.songName === 'string' ? parsed.songName.slice(0, 120) : undefined,
    };
  } catch {
    return null;
  }
}

export function saveListenTogetherSession(
  session: Omit<ListenTogetherSession, 'updatedAt'> & { updatedAt?: number },
  storage: StorageLike | null = getStorage(),
): void {
  if (!storage || !session.charId) return;
  try {
    const safe: ListenTogetherSession = {
      charId: session.charId,
      messages: sanitizeMessages(session.messages),
      input: (session.input || '').slice(0, 1000),
      updatedAt: session.updatedAt ?? Date.now(),
      songId: typeof session.songId === 'number' ? session.songId : null,
      songName: session.songName?.slice(0, 120),
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // localStorage quota / private mode failure should never break listening.
  }
}

export function clearListenTogetherSession(
  charId?: string | null,
  storage: StorageLike | null = getStorage(),
): void {
  if (!storage) return;
  try {
    if (!charId) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    const current = loadListenTogetherSession(storage);
    if (!current || current.charId === charId) storage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function selectListenTogetherSessionForPartners(
  partnerIds: string[],
  storage: StorageLike | null = getStorage(),
): ListenTogetherSession | null {
  const session = loadListenTogetherSession(storage);
  if (!session) return null;
  return partnerIds.includes(session.charId) ? session : null;
}

export function buildListenActionNotice(
  charName: string,
  action: ListenAction,
  songName?: string,
): ListenActionNotice | null {
  const name = charName || 'TA';
  if (action.kind === 'none') return null;
  if (action.kind === 'change_song') {
    const target = songName || action.query;
    return {
      title: `${name} 换了一首歌`,
      body: target ? `现在播放《${target}》。` : 'TA 换了个新的氛围。',
      toast: target ? `${name} 换到《${target}》` : `${name} 换了一首歌`,
      tag: `music-listen-action-${action.kind}`,
    };
  }
  if (action.kind === 'pause') {
    return {
      title: `${name} 暂停了音乐`,
      body: 'TA 想在这一刻停一下。',
      toast: `${name} 暂停了音乐`,
      tag: `music-listen-action-${action.kind}`,
    };
  }
  if (action.kind === 'resume') {
    return {
      title: `${name} 继续播放`,
      body: '音乐继续响起来了。',
      toast: `${name} 继续播放`,
      tag: `music-listen-action-${action.kind}`,
    };
  }
  if (action.kind === 'seek') {
    const m = Math.floor(Math.max(0, action.seconds) / 60);
    const s = Math.floor(Math.max(0, action.seconds) % 60).toString().padStart(2, '0');
    return {
      title: `${name} 拖动了进度条`,
      body: `TA 想听 ${m}:${s} 附近的这一段。`,
      toast: `${name} 跳到 ${m}:${s}`,
      tag: `music-listen-action-${action.kind}`,
    };
  }
  if (action.kind === 'previous') {
    return {
      title: `${name} 回到上一首`,
      body: 'TA 想把刚才那首接回来。',
      toast: `${name} 回到上一首`,
      tag: `music-listen-action-${action.kind}`,
    };
  }
  return {
    title: `${name} 跳到下一首`,
    body: 'TA 想换个新的氛围。',
    toast: `${name} 跳到下一首`,
    tag: `music-listen-action-${action.kind}`,
  };
}
