import { describe, it, expect } from 'vitest';
import { declaredFiles, checkDrift } from '../src/drift.js';

const PLAN_BODY = `
## Files that change

- \`server/lib/db.js\` — add git-backed catalog write
- \`server/routes/suits.js\` — call the new writer

## Work order

1. Writer, 2. Route.

## Tests that prove completion

- \`test/db.test.js\`
`;

describe('declaredFiles', () => {
  it('extracts backticked paths from the files section only', () => {
    expect(declaredFiles(PLAN_BODY)).toEqual([
      'server/lib/db.js',
      'server/routes/suits.js',
    ]);
  });
});

describe('checkDrift', () => {
  it('passes when touched files are a subset of declared', () => {
    const r = checkDrift(PLAN_BODY, ['server/lib/db.js'], false);
    expect(r.passed).toBe(true);
  });

  it('warns but passes on undeclared files when drift is not fatal', () => {
    const r = checkDrift(PLAN_BODY, ['server/lib/weather.js'], false);
    expect(r.passed).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/weather\.js/);
  });

  it('fails on undeclared files when drift is fatal', () => {
    const r = checkDrift(PLAN_BODY, ['server/lib/weather.js'], true);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/weather\.js/);
  });

  it('ignores relay artifacts themselves', () => {
    const r = checkDrift(PLAN_BODY, ['.relay/work/001-x/plan.md'], true);
    expect(r.passed).toBe(true);
  });
});
