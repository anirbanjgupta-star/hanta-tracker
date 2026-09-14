import { runStatus, listItemIds, type StatusResult } from '@relay/cli/lib';

export type ItemProjection = StatusResult;

export function buildProjection(cwd: string): ItemProjection[] {
  return listItemIds(cwd)
    .map((id) => runStatus(cwd, id))
    .sort((a, b) => a.id.localeCompare(b.id));
}
