import { describe, it, expect } from 'vitest';
import { parseConfig, parseRoles, DEFAULT_LANES, DEFAULT_CONFIG } from '../src/config.js';

const VALID_CONFIG_YAML = `
sourceOfTruth: repo
defaultLane: standard
lanes:
  express:
    requires: [plan]
    gateRoles: {}
    allowSelfApproval: true
    driftIsFatal: false
  standard:
    requires: [intent, spec, plan]
    gateRoles:
      plan: [product-owner]
      design: [product-owner]
      build: [engineer]
    allowSelfApproval: true
    driftIsFatal: false
  governed:
    requires: [intent, spec, plan]
    gateRoles:
      plan: [product-owner]
      design: [product-owner, tech-lead]
      build: [engineer]
    allowSelfApproval: false
    driftIsFatal: true
`;

describe('parseConfig', () => {
  it('parses a valid config.yml', () => {
    const config = parseConfig(VALID_CONFIG_YAML);
    expect(config.sourceOfTruth).toBe('repo');
    expect(config.defaultLane).toBe('standard');
    expect(config.lanes.express.requires).toEqual(['plan']);
    expect(config.lanes.governed.allowSelfApproval).toBe(false);
  });

  it('throws on an invalid sourceOfTruth value', () => {
    const bad = VALID_CONFIG_YAML.replace('sourceOfTruth: repo', 'sourceOfTruth: bogus');
    expect(() => parseConfig(bad)).toThrow();
  });

  it('throws when gateRoles names something other than a real stage', () => {
    const bad = VALID_CONFIG_YAML.replace('plan: [product-owner]\n      design: [product-owner]', 'not-a-stage: [product-owner]\n      design: [product-owner]');
    expect(() => parseConfig(bad)).toThrow();
  });

  it('throws when a required lane is missing', () => {
    const bad = VALID_CONFIG_YAML.replace(/governed:[\s\S]*$/, '');
    expect(() => parseConfig(bad)).toThrow();
  });
});

describe('parseRoles', () => {
  it('parses an identity-to-roles map', () => {
    const roles = parseRoles('po@example.com: [product-owner]\neng@example.com: [engineer]\n');
    expect(roles['po@example.com']).toEqual(['product-owner']);
  });

  it('returns an empty object for an empty file', () => {
    expect(parseRoles('')).toEqual({});
  });
});

describe('DEFAULT_LANES and DEFAULT_CONFIG', () => {
  it('validates DEFAULT_LANES/DEFAULT_CONFIG structure and reference sharing', () => {
    expect(DEFAULT_CONFIG.lanes).toBe(DEFAULT_LANES);
    expect(DEFAULT_LANES.express.requires).toEqual(['plan']);
    expect(DEFAULT_LANES.standard.requires).toEqual(['intent', 'spec', 'plan']);
    expect(DEFAULT_LANES.governed.driftIsFatal).toBe(true);
  });
});
