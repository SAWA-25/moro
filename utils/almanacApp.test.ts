import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AlmanacApp user-facing stamps', () => {
  it('does not show the implementation placeholder on the promise entry', () => {
    const source = readFileSync('apps/AlmanacApp.tsx', 'utf8');

    expect(source).not.toContain("date: 'TODO'");
    expect(source).toMatch(/title:\s*'时光契约',\s*en:\s*'promise',\s*date:\s*'PLAN'/);
  });
});
