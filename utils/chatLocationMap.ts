export type ChatLocationMapKind = 'building' | 'shop' | 'park' | 'transport';

export interface ChatLocationPoint {
  x: number;
  y: number;
}

export interface ChatLocationMapLandmark extends ChatLocationPoint {
  id: string;
  label: string;
  kind: ChatLocationMapKind;
}

export interface ChatLocationMapData {
  version: 1;
  mode: 'local';
  seed: string;
  anchor: ChatLocationPoint;
  user: ChatLocationPoint;
  distanceKm: number;
  landmarks: ChatLocationMapLandmark[];
}

const KIND_ORDER: ChatLocationMapKind[] = ['building', 'shop', 'park', 'transport'];

const FALLBACK_LABELS = [
  '旧巷口',
  '24H生活超市',
  '社区卫生站',
  '梧桐小院',
  '交通岗亭',
  '街角咖啡',
  '小广场',
  '便利店',
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const pct = (value: number) => Math.round(clamp(value, 4, 96) * 10) / 10;

export const normalizeLocationText = (value: unknown): string => (
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
);

const hashString = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const makeRng = (seed: string) => {
  let state = hashString(seed) || 0x9e3779b9;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
};

const randBetween = (rng: () => number, min: number, max: number) => min + rng() * (max - min);
const pick = <T,>(rng: () => number, list: T[]): T => list[Math.floor(rng() * list.length) % list.length];

const makeSeed = (name: string, address?: string) => {
  const n = normalizeLocationText(name) || '未知地点';
  const a = normalizeLocationText(address);
  return a ? `${n}|${a}` : n;
};

const wordsFrom = (name: string, address?: string): string[] => {
  const raw = `${normalizeLocationText(address)} ${normalizeLocationText(name)}`;
  return raw
    .split(/[,\uFF0C\u3001\u00B7/\\|;；:：\s-]+/)
    .map(part => part.trim())
    .filter(part => part.length >= 2 && part.length <= 12)
    .filter((part, index, list) => list.indexOf(part) === index)
    .slice(0, 6);
};

const landmarkLabelsFor = (name: string, address: string | undefined, rng: () => number) => {
  const words = wordsFrom(name, address);
  const labels = [...words, ...FALLBACK_LABELS];
  const result: string[] = [];
  while (result.length < 4 && labels.length > 0) {
    const next = labels.splice(Math.floor(rng() * labels.length), 1)[0];
    if (next && next !== name && !result.includes(next)) result.push(next);
  }
  return result.length ? result : FALLBACK_LABELS.slice(0, 4);
};

const farEnough = (a: ChatLocationPoint, b: ChatLocationPoint) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy) >= 24;
};

const normalizePoint = (raw: any): ChatLocationPoint | null => {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: pct(x), y: pct(y) };
};

const normalizeLandmark = (raw: any, index: number): ChatLocationMapLandmark | null => {
  const point = normalizePoint(raw);
  const label = normalizeLocationText(raw?.label);
  const kind = KIND_ORDER.includes(raw?.kind) ? raw.kind as ChatLocationMapKind : KIND_ORDER[index % KIND_ORDER.length];
  if (!point || !label) return null;
  return {
    id: normalizeLocationText(raw?.id) || `lm-${index + 1}`,
    label: label.slice(0, 18),
    kind,
    ...point,
  };
};

export function buildChatLocationMap(name: string, address?: string): ChatLocationMapData {
  const cleanName = normalizeLocationText(name) || '未知地点';
  const cleanAddress = normalizeLocationText(address);
  const seed = makeSeed(cleanName, cleanAddress);
  const rng = makeRng(seed);

  const anchor: ChatLocationPoint = {
    x: pct(randBetween(rng, 52, 82)),
    y: pct(randBetween(rng, 24, 68)),
  };
  let user: ChatLocationPoint = {
    x: pct(randBetween(rng, 16, 42)),
    y: pct(randBetween(rng, 46, 84)),
  };
  if (!farEnough(anchor, user)) {
    user = { x: pct(anchor.x - randBetween(rng, 28, 42)), y: pct(anchor.y + randBetween(rng, 22, 36)) };
  }

  const labels = landmarkLabelsFor(cleanName, cleanAddress, rng);
  const offsets = [
    { x: -34, y: -21 },
    { x: -17, y: 16 },
    { x: 28, y: 21 },
    { x: 23, y: -27 },
  ];
  const landmarks = labels.slice(0, 4).map((label, index) => ({
    id: `lm-${index + 1}`,
    label,
    kind: KIND_ORDER[index % KIND_ORDER.length],
    x: pct(anchor.x + offsets[index].x + randBetween(rng, -8, 8)),
    y: pct(anchor.y + offsets[index].y + randBetween(rng, -8, 8)),
  }));

  const dx = anchor.x - user.x;
  const dy = anchor.y - user.y;
  const distanceKm = Number((0.4 + Math.sqrt(dx * dx + dy * dy) / 19).toFixed(1));

  return {
    version: 1,
    mode: 'local',
    seed,
    anchor,
    user,
    distanceKm,
    landmarks,
  };
}

export function resolveChatLocationMap(name: string, address?: string, raw?: any): ChatLocationMapData {
  if (raw?.version === 1 && raw?.mode === 'local') {
    const anchor = normalizePoint(raw.anchor);
    const user = normalizePoint(raw.user);
    const landmarks = Array.isArray(raw.landmarks)
      ? raw.landmarks.map(normalizeLandmark).filter(Boolean).slice(0, 5) as ChatLocationMapLandmark[]
      : [];
    const distanceKm = Number(raw.distanceKm);
    if (anchor && user && landmarks.length > 0 && Number.isFinite(distanceKm)) {
      return {
        version: 1,
        mode: 'local',
        seed: normalizeLocationText(raw.seed) || makeSeed(name, address),
        anchor,
        user,
        distanceKm: Number(clamp(distanceKm, 0.1, 99).toFixed(1)),
        landmarks,
      };
    }
  }
  return buildChatLocationMap(name, address);
}
