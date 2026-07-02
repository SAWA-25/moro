import { describe, expect, it } from 'vitest';
import { removeManagedCssBlock, replaceManagedCssBlock, scanAppearanceCss } from './appearanceCssSafety';

describe('appearanceCssSafety', () => {
  it('detects dangerous hidden protected selectors', () => {
    const warnings = scanAppearanceCss(`
.moro-dock { display:none; }
.moro-chat-back { pointer-events:none; }
`);
    expect(warnings.some(w => w.severity === 'danger' && w.match === 'display:none')).toBe(true);
    expect(warnings.some(w => w.severity === 'danger' && w.match === 'pointer-events:none')).toBe(true);
  });

  it('detects broad selectors, fixed positioning and high z-index', () => {
    const warnings = scanAppearanceCss(`
* { color:red; }
.panel { position: fixed; z-index: 1200; }
`);
    expect(warnings.some(w => w.title === '全局选择器')).toBe(true);
    expect(warnings.some(w => w.title === '固定定位')).toBe(true);
    expect(warnings.some(w => w.title === '层级过高' && w.severity === 'danger')).toBe(true);
  });

  it('replaces only the managed css block', () => {
    const original = `.keep { color: red; }

/* MORO_APPEARANCE_PACK:test:START */
.old { color: blue; }
/* MORO_APPEARANCE_PACK:test:END */

.keep2 { color: green; }`;
    const next = replaceManagedCssBlock(original, 'test', '.new { color: black; }');
    expect(next).toContain('.keep { color: red; }');
    expect(next).toContain('.keep2 { color: green; }');
    expect(next).toContain('.new { color: black; }');
    expect(next).not.toContain('.old { color: blue; }');
  });

  it('removes only the requested managed css block', () => {
    const css = replaceManagedCssBlock('.user { color: red; }', 'pack-a', '.a{}');
    const removed = removeManagedCssBlock(css, 'pack-a');
    expect(removed).toBe('.user { color: red; }');
  });
});
