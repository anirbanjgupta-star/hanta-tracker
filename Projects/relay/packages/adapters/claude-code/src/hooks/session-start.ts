#!/usr/bin/env node
import { runResume } from '@relay/cli/lib';

interface HookInput {
  cwd: string;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

async function main() {
  const raw = await readStdin();
  const input = JSON.parse(raw) as HookInput;

  try {
    const brief = runResume(input.cwd);
    const lines = [`Relay: resuming ${brief.id} — stage: ${brief.stage}`];
    if (brief.blockedBy.length > 0) lines.push(`Blocked by: ${brief.blockedBy.join('; ')}`);
    lines.push(`Open questions: ${brief.openQuestions}`);
    lines.push(`Next: ${brief.next}`);
    process.stdout.write(lines.join('\n') + '\n');
  } catch {
    // No .relay/config.yml or no resolvable current item — nothing to
    // resume, and printing nothing is correct, not an error.
  }
  process.exit(0);
}

main();
