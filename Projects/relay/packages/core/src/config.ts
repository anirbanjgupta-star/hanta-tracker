import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { Lane, LaneRule, RelayConfig, RoleMap } from './types.js';

const STAGE_SCHEMA = z.enum(['intake', 'plan', 'design', 'build', 'done']);

const LANE_RULE_SCHEMA = z.object({
  requires: z.array(z.enum(['intent', 'spec', 'plan'])),
  gateRoles: z.record(STAGE_SCHEMA, z.array(z.string())).default({}),
  allowSelfApproval: z.boolean(),
  driftIsFatal: z.boolean(),
});

const CONFIG_SCHEMA = z.object({
  sourceOfTruth: z.enum(['legacy', 'repo']),
  defaultLane: z.enum(['express', 'standard', 'governed']),
  lanes: z.object({
    express: LANE_RULE_SCHEMA,
    standard: LANE_RULE_SCHEMA,
    governed: LANE_RULE_SCHEMA,
  }),
});

export function parseConfig(raw: string): RelayConfig {
  return CONFIG_SCHEMA.parse(parseYaml(raw));
}

const ROLES_SCHEMA = z.record(z.string(), z.array(z.string()));

export function parseRoles(raw: string): RoleMap {
  return ROLES_SCHEMA.parse(parseYaml(raw) ?? {});
}

export const DEFAULT_LANES: Record<Lane, LaneRule> = {
  express: {
    requires: ['plan'],
    gateRoles: {},
    allowSelfApproval: true,
    driftIsFatal: false,
  },
  standard: {
    requires: ['intent', 'spec', 'plan'],
    gateRoles: {
      plan: ['product-owner'],
      design: ['product-owner'],
      build: ['engineer'],
    },
    allowSelfApproval: true,
    driftIsFatal: false,
  },
  governed: {
    requires: ['intent', 'spec', 'plan'],
    gateRoles: {
      plan: ['product-owner'],
      design: ['product-owner', 'tech-lead'],
      build: ['engineer'],
    },
    allowSelfApproval: false,
    driftIsFatal: true,
  },
};

export const DEFAULT_CONFIG: RelayConfig = {
  sourceOfTruth: 'repo',
  defaultLane: 'standard',
  lanes: DEFAULT_LANES,
};
