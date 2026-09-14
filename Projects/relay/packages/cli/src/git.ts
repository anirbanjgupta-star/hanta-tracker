import { execFileSync } from 'node:child_process';

// execFileSync with an argv array (not execSync with an interpolated shell
// string) — touchedFiles' baseRef ends up sourced from a CLI flag
// (`relay verify --base <ref>`), so it must never be parsed by a shell.
function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd }).toString().trim();
}

export function currentBranch(cwd: string): string {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

export function createBranch(branch: string, cwd: string): void {
  git(['checkout', '-b', branch, '-q'], cwd);
}

export function gitIdentity(cwd: string): string {
  return git(['config', 'user.email'], cwd);
}

const BRANCH_ITEM = /^relay\/(.+)$/;

export function itemIdFromBranch(branch: string): string | null {
  const m = branch.match(BRANCH_ITEM);
  return m ? m[1] : null;
}

export function touchedFiles(baseRef: string, cwd: string): string[] {
  const out = git(['diff', '--name-only', `${baseRef}...HEAD`], cwd);
  return out.length === 0 ? [] : out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// Same argv-array discipline as touchedFiles above — baseRef reaches this
// from `relay adopt --base <ref>`, so it must never be parsed by a shell.
export function diffText(baseRef: string, cwd: string): string {
  return git(['diff', `${baseRef}...HEAD`], cwd);
}

export function headSha(cwd: string): string {
  return git(['rev-parse', 'HEAD'], cwd);
}

export function remoteIsGitHub(cwd: string): boolean {
  try {
    return git(['remote', 'get-url', 'origin'], cwd).includes('github.com');
  } catch {
    return false; // no remote at all is not an error condition here
  }
}

// No try/catch: `git log -- <pathspec>` for a path with no history exits 0
// with empty output — "no commits" is already covered without swallowing
// anything. A real failure (not a repo, corrupted .git) should propagate
// like it does everywhere else in this file, not read as "no history."
export function logSubjects(pathspec: string, limit: number, cwd: string): string[] {
  const out = git(['log', '--format=%s', '-n', String(limit), '--', pathspec], cwd);
  return out.length === 0 ? [] : out.split('\n');
}
