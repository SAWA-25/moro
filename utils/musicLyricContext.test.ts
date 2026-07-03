import { describe, expect, it } from 'vitest';
import {
  buildLyricWindow,
  cleanLyricText,
  lyricLinesFromRaw,
  mergeTranslatedLyricLines,
} from './musicLyricContext';

describe('music lyric context helpers', () => {
  it('cleans timestamps, section markers, and blank lyric lines', () => {
    expect(lyricLinesFromRaw('[Verse]\n[00:01.20]第一句落下来\n\n[Chorus]\n[00:03.00]第二句亮起来')).toEqual([
      '第一句落下来',
      '第二句亮起来',
    ]);
    expect(cleanLyricText('[Bridge]')).toBe('');
  });

  it('builds a stable lyric window around the active line', () => {
    const window = buildLyricWindow([
      { t: 0, text: '前一句' },
      { t: 5, text: '这一句' },
      { t: 10, text: '后一句' },
      { t: 15, text: '再后一句' },
    ], 1, { before: 1, after: 2 });

    expect(window).toEqual({
      lines: ['前一句', '这一句', '后一句', '再后一句'],
      activeIdx: 1,
      activeLine: '这一句',
    });
  });

  it('limits long lyric text for prompt safety', () => {
    const long = '很长'.repeat(120);
    const [line] = lyricLinesFromRaw(`[00:01.00]${long}`, { lineCount: 1, maxLineChars: 32 });

    expect(line.length).toBeLessThanOrEqual(32);
    expect(line.endsWith('...')).toBe(true);
  });

  it('can merge translated lyric lines by timestamp', () => {
    const merged = mergeTranslatedLyricLines(
      [{ t: 12, text: 'Here comes the rain' }],
      [{ t: 12.1, text: '雨又来了' }],
    );

    expect(merged[0].text).toBe('Here comes the rain / 雨又来了');
  });
});
