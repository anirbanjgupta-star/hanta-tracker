import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { currentBranch, itemIdFromBranch } from './git.js';
import { relayRoot } from './relay-dir.js';

export function resolveCurrentItemId(cwd: string): string {
  // Branch wins over CURRENT when both are set. Detached HEAD is safe here:
  // `git rev-parse --abbrev-ref HEAD` returns the literal string "HEAD" in
  // that state, which never matches the relay/<id> pattern, so it falls
  // through to the CURRENT file exactly like any other non-relay branch.
  const fromBranch = itemIdFromBranch(currentBranch(cwd));
  if (fromBranch) return fromBranch;

  const path = join(relayRoot(cwd), 'CURRENT');
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();

  throw new Error(
    'No current item: not on a relay/<id> branch and no .relay/CURRENT set. Run `relay use <id>`.'
  );
}

export function setCurrentItemId(id: string, cwd: string): void {
  mkdirSync(relayRoot(cwd), { recursive: true });
  writeFileSync(join(relayRoot(cwd), 'CURRENT'), id);
}
