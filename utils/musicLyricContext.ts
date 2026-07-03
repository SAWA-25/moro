import type { LyricLine } from '../context/MusicContext';

export type MusicLyricSource = 'synced' | 'local' | 'preview' | 'none';

export interface MusicLyricWindow {
  lines: string[];
  activeIdx: number;
  activeLine?: string;
}

export interface MusicLyricLineOptions {
  maxLineChars?: number;
}

export interface MusicLyricListOptions extends MusicLyricLineOptions {
  lineCount?: number;
  maxTotalChars?: number;
}

const DEFAULT_MAX_LINE_CHARS = 140;
const DEFAULT_MAX_TOTAL_CHARS = 900;

const timestampRe = /\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/g;
const inlineTimingRe = /<\d+(?:,\d+){1,2}>/g;
const sectionMarkerRe = /^\[[^\]]+\]$/;
const emptyLyricRe = /^(纯音乐|暂无歌词|暂无翻译|instrumental|no lyrics)$/i;

const clampText = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
};

export function cleanLyricText(value: unknown, options: MusicLyricLineOptions = {}): string {
  const maxLineChars = Math.max(20, options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS);
  const text = String(value ?? '')
    .replace(timestampRe, '')
    .replace(inlineTimingRe, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || sectionMarkerRe.test(text) || emptyLyricRe.test(text)) return '';
  return clampText(text, maxLineChars);
}

export function limitLyricLines(lines: unknown[], options: MusicLyricListOptions = {}): string[] {
  const lineCount = Math.max(0, options.lineCount ?? 6);
  const maxTotalChars = Math.max(60, options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS);
  const out: string[] = [];
  let total = 0;

  for (const line of lines) {
    if (out.length >= lineCount) break;
    const text = cleanLyricText(line, options);
    if (!text) continue;
    const nextTotal = total + text.length;
    if (nextTotal > maxTotalChars && out.length > 0) break;
    out.push(text);
    total = nextTotal;
  }

  return out;
}

export function lyricLinesFromRaw(raw: unknown, options: MusicLyricListOptions = {}): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return limitLyricLines(raw.split(/\r?\n/), options);
}

export function lyricLinesFromTimedLines(lines: Array<LyricLine | string>, options: MusicLyricListOptions = {}): string[] {
  return limitLyricLines(lines.map(line => typeof line === 'string' ? line : line.text), options);
}

export function mergeTranslatedLyricLines(
  lyric: LyricLine[],
  tlyric: LyricLine[] = [],
  toleranceSeconds = 0.2,
): LyricLine[] {
  if (!tlyric.length) return lyric;
  return lyric.map(line => {
    const translated = tlyric.find(t => Math.abs(t.t - line.t) <= toleranceSeconds);
    const main = cleanLyricText(line.text);
    const trans = translated ? cleanLyricText(translated.text) : '';
    if (!main) return { ...line, text: trans };
    if (!trans || trans === main) return { ...line, text: main };
    return { ...line, text: `${main} / ${trans}` };
  });
}

export function buildLyricWindow(
  lines: Array<LyricLine | string>,
  activeIdx: number,
  options: MusicLyricLineOptions & { before?: number; after?: number } = {},
): MusicLyricWindow {
  if (!Array.isArray(lines) || !lines.length || activeIdx < 0 || activeIdx >= lines.length) {
    return { lines: [], activeIdx: -1 };
  }

  const before = Math.max(0, options.before ?? 2);
  const after = Math.max(0, options.after ?? 2);
  const start = Math.max(0, activeIdx - before);
  const end = Math.min(lines.length, activeIdx + after + 1);
  const out: string[] = [];
  let mappedActiveIdx = -1;

  for (let i = start; i < end; i += 1) {
    const raw = lines[i];
    const text = cleanLyricText(typeof raw === 'string' ? raw : raw.text, options);
    if (!text) continue;
    if (i === activeIdx) mappedActiveIdx = out.length;
    out.push(text);
  }

  return {
    lines: out,
    activeIdx: mappedActiveIdx,
    activeLine: mappedActiveIdx >= 0 ? out[mappedActiveIdx] : undefined,
  };
}
