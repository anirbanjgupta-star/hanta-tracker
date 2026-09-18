import { runStatus } from '@relay/cli/lib';

export interface CurrentItemResult {
  id: string;
  lane: string;
  stage: string;
}

export function currentItem(cwd: string): CurrentItemResult {
  const status = runStatus(cwd);
  return { id: status.id, lane: status.lane, stage: status.stage };
}
