import { readFileSync } from 'node:fs';
import { runStatus, runHandover, type HandoverTarget } from '@relay/cli/lib';
import type { Stage } from '@relay/core';

const STAGE_TO_TARGET: Partial<Record<Stage, HandoverTarget>> = {
  design: 'design',
  build: 'build',
};

export function handoverForCurrentStage(cwd: string, idOverride?: string): string {
  const status = runStatus(cwd, idOverride);
  const target = STAGE_TO_TARGET[status.stage];
  if (!target) {
    throw new Error(`No handover bundle is defined for stage: ${status.stage}`);
  }

  const path = runHandover(status.id, target, cwd);
  return readFileSync(path, 'utf8');
}
