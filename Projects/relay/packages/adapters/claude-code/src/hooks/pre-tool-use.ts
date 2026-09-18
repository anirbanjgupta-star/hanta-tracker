#!/usr/bin/env node
import { relative, resolve, sep } from 'node:path';
import { runStatus } from '@relay/cli/lib';

interface HookInput {
  cwd: string;
  tool_name: string;
  tool_input?: { file_path?: string };
}

function readStdin(): Promise<string> {
  return new Promise((resolvePromise) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolvePromise(data));
  });
}

// Claude Code's Edit/Write tools pass an absolute file_path, so a literal
// '.relay/'-prefix string check never matches in practice — this resolves
// against cwd first (handling both absolute and relative inputs, and
// collapsing any '..' segments) before comparing the leading path segment.
function isExemptPath(cwd: string, filePath: string): boolean {
  const rel = relative(cwd, resolve(cwd, filePath));
  const first = rel.split(sep)[0];
  return first === '.relay' || first === '.claude';
}

async function main() {
  const raw = await readStdin();
  const input = JSON.parse(raw) as HookInput;

  if (input.tool_name !== 'Edit' && input.tool_name !== 'Write') {
    process.exit(0);
  }

  const filePath = input.tool_input?.file_path ?? '';
  if (filePath === '' || isExemptPath(input.cwd, filePath)) {
    process.exit(0);
  }

  let status;
  try {
    status = runStatus(input.cwd);
  } catch {
    // No .relay/config.yml, no resolvable current item, or any other reason
    // Relay doesn't apply here — this hook is ergonomics for tracked work
    // only, never a second permission system for everything else.
    process.exit(0);
  }

  if (status.stage === 'done') {
    process.exit(0);
  }

  const reason = status.blockedBy.length > 0
    ? status.blockedBy.join('; ')
    : `item ${status.id} is at stage '${status.stage}', not yet past its build gate`;
  process.stderr.write(
    `Relay: blocked — the build gate is not yet approved (${reason}). Run \`relay gate build --approve\` once ready.\n`
  );
  process.exit(2);
}

main().catch(() => {
  // Malformed stdin (e.g. JSON.parse failure) or any other unexpected
  // failure before the try/catch above is reached — fail open, same
  // philosophy as every other "Relay doesn't apply" branch in this hook.
  process.exit(0);
});
