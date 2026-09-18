import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { Stage } from './types.js';

export interface ControlBand {
  centerline: number;
  sigma: number;
}

export interface ControlBandsConfig {
  gateLatencyS: Partial<Record<Stage, ControlBand>>;
}

export type BreachZone = 'none' | '1sigma' | '2sigma' | '3sigma';

// Deviation measured as an absolute distance from the centerline, in sigma
// units — a value can breach by running too fast just as meaningfully as
// too slow (an unrealistically instant approval is as worth flagging as a
// stalled one), so this does not treat "below centerline" as automatically
// fine.
export function classifyBreach(value: number, band: ControlBand): BreachZone {
  const deviation = Math.abs(value - band.centerline) / band.sigma;
  if (deviation >= 3) return '3sigma';
  if (deviation >= 2) return '2sigma';
  if (deviation >= 1) return '1sigma';
  return 'none';
}

const GATE_SCHEMA = z.enum(['plan', 'design', 'build']);
const CONTROL_BAND_SCHEMA = z.object({
  centerline: z.number(),
  sigma: z.number().positive(),
});
const CONTROL_BANDS_SCHEMA = z.object({
  gateLatencyS: z.record(GATE_SCHEMA, CONTROL_BAND_SCHEMA).default({}),
});

export function parseControlBands(raw: string): ControlBandsConfig {
  return CONTROL_BANDS_SCHEMA.parse(parseYaml(raw));
}
