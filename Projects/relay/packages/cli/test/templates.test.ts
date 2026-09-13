import { describe, it, expect } from 'vitest';
import { parseArtifact, lintArtifact, parseConfig, parseRoles, DEFAULT_CONFIG } from '@relay/core';
import {
  intentTemplate, specTemplate, planTemplate,
  defaultConfigYaml, defaultRolesYaml, ciWorkflowYaml,
} from '../src/templates.js';

describe('intentTemplate', () => {
  it('produces frontmatter parseArtifact can read', () => {
    const raw = intentTemplate('001-x', 'standard');
    const artifact = parseArtifact(raw, 'intent');
    expect(artifact.itemId).toBe('001-x');
    expect(artifact.lane).toBe('standard');
  });

  it('lints as incomplete (empty sections), not as malformed', () => {
    const artifact = parseArtifact(intentTemplate('001-x', 'standard'), 'intent');
    const r = lintArtifact(artifact);
    expect(r.ok).toBe(false);
    expect(r.problems.every((p) => p.includes('empty'))).toBe(true);
  });
});

describe('specTemplate / planTemplate', () => {
  it('carries the given upstream hash in frontmatter', () => {
    const hash = 'sha256:' + 'a'.repeat(64);
    const spec = parseArtifact(specTemplate('001-x', 'standard', hash), 'spec');
    expect(spec.upstream).toBe(hash);

    const plan = parseArtifact(planTemplate('001-x', 'standard', hash), 'plan');
    expect(plan.upstream).toBe(hash);
  });
});

describe('defaultConfigYaml / defaultRolesYaml', () => {
  it('produces YAML that parseConfig accepts and matches DEFAULT_CONFIG', () => {
    const config = parseConfig(defaultConfigYaml());
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('produces YAML that parseRoles accepts', () => {
    expect(parseRoles(defaultRolesYaml())).toEqual({
      'you@example.com': ['product-owner', 'tech-lead', 'engineer'],
    });
  });
});

describe('ciWorkflowYaml', () => {
  it('references `relay verify`', () => {
    expect(ciWorkflowYaml()).toMatch(/relay verify/);
  });
});
