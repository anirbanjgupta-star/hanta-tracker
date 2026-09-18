import { describe, it, expect } from 'vitest';
import { INTENT_SKILL, SPEC_SKILL, PLAN_SKILL } from '../src/skills.js';

describe('stage-interview skills', () => {
  it.each([
    ['INTENT_SKILL', INTENT_SKILL, 'relay-intent'],
    ['SPEC_SKILL', SPEC_SKILL, 'relay-spec'],
    ['PLAN_SKILL', PLAN_SKILL, 'relay-plan'],
  ])('%s has valid frontmatter naming itself %s', (_label, content, expectedName) => {
    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(new RegExp(`name: ${expectedName}`));
    expect(content).toMatch(/description: .+/);
  });

  it('each skill references the relay command it exists to fill in', () => {
    expect(INTENT_SKILL).toMatch(/intent\.md/);
    expect(SPEC_SKILL).toMatch(/spec\.md/);
    expect(PLAN_SKILL).toMatch(/plan\.md/);
  });
});
