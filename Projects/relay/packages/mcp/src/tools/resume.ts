import { runResume } from '@relay/cli/lib';

export function resumeText(cwd: string, idOverride?: string): string {
  const brief = runResume(cwd, idOverride);
  const lines = [`${brief.id} — stage: ${brief.stage}`];
  if (brief.blockedBy.length > 0) {
    lines.push('Blocked by:');
    for (const reason of brief.blockedBy) lines.push(`  - ${reason}`);
  }
  lines.push(`Open questions: ${brief.openQuestions}`);
  lines.push('Recent history:');
  for (const h of brief.recentHistory) lines.push(`  - ${h}`);
  lines.push(`Next: ${brief.next}`);
  return lines.join('\n');
}
