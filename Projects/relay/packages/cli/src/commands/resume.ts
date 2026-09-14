import { loadWorkItem, itemDir } from '../relay-dir.js';
import { loadRelayConfig } from '../context.js';
import { openItemsFor } from '../sections.js';
import { logSubjects } from '../git.js';
import { runStatus } from './status.js';
import { type Stage } from '@relay/core';

export interface ResumeBrief {
  id: string;
  stage: Stage;
  blockedBy: string[];
  openQuestions: string;
  recentHistory: string[];
  next: string;
}

function nextStep(stage: Stage, blockedBy: string[]): string {
  if (stage === 'done') return 'Nothing — this item is complete.';
  // 'intake' means no artifact exists yet — reachable via a typo'd or
  // never-scaffolded id (e.g. `relay use <bogus-id>`), not just internally.
  // It isn't a real gate, so it needs its own message rather than falling
  // into "awaiting approval at the intake gate," which names a gate that
  // doesn't exist.
  if (stage === 'intake') return 'Nothing scaffolded yet — run `relay new`, or check the item id.';
  if (blockedBy.length > 0) {
    return `Resolve: ${blockedBy.join('; ')} — then it can be approved at the ${stage} gate.`;
  }
  return `Awaiting approval at the ${stage} gate.`;
}

export function runResume(cwd: string, idOverride?: string): ResumeBrief {
  const status = runStatus(cwd, idOverride);
  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(status.id, config.defaultLane, cwd);

  const latestKind = (['plan', 'spec', 'intent'] as const).find((k) => item.artifacts[k]) ?? null;
  const openQuestions = latestKind ? openItemsFor(latestKind, item.artifacts[latestKind]!.body) : null;

  const recentHistory = logSubjects(itemDir(status.id, cwd), 5, cwd);

  return {
    id: status.id,
    stage: status.stage,
    blockedBy: status.blockedBy,
    openQuestions: openQuestions ?? 'None recorded.',
    recentHistory,
    next: nextStep(status.stage, status.blockedBy),
  };
}
