import { lintArtifact } from '@relay/core';
import { loadWorkItem } from '../relay-dir.js';
import { resolveCurrentItemId } from '../current-item.js';
import { loadRelayConfig } from '../context.js';

export interface LintReport {
  id: string;
  ok: boolean;
  problems: { artifact: string; problems: string[] }[];
}

export function runLint(cwd: string, idOverride?: string): LintReport {
  const id = idOverride ?? resolveCurrentItemId(cwd);
  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(id, config.defaultLane, cwd);

  const problems: { artifact: string; problems: string[] }[] = [];
  for (const [kind, artifact] of Object.entries(item.artifacts)) {
    if (!artifact) continue;
    const result = lintArtifact(artifact);
    if (!result.ok) problems.push({ artifact: `${kind}.md`, problems: result.problems });
  }

  return { id, ok: problems.length === 0, problems };
}
