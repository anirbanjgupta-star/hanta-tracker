import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseArtifact, parseLedger, serialiseApproval,
  type Artifact, type ArtifactKind, type WorkItem, type Approval, type Lane,
} from '@relay/core';

const KINDS: ArtifactKind[] = ['intent', 'spec', 'plan'];

export function relayRoot(cwd: string): string {
  return join(cwd, '.relay');
}

export function itemDir(id: string, cwd: string): string {
  return join(relayRoot(cwd), 'work', id);
}

export function loadWorkItem(id: string, defaultLane: Lane, cwd: string): WorkItem {
  const dir = itemDir(id, cwd);
  const artifacts: Partial<Record<ArtifactKind, Artifact>> = {};

  for (const kind of KINDS) {
    const path = join(dir, `${kind}.md`);
    if (existsSync(path)) {
      artifacts[kind] = parseArtifact(readFileSync(path, 'utf8'), kind);
    }
  }

  const ledgerPath = join(dir, 'approvals.jsonl');
  const approvals: Approval[] = existsSync(ledgerPath)
    ? parseLedger(readFileSync(ledgerPath, 'utf8'))
    : [];

  // All of one item's artifacts carry the same lane by construction — this
  // picks whichever earliest-stage artifact happens to exist, not resolving
  // a disagreement between them.
  const lane = artifacts.intent?.lane ?? artifacts.spec?.lane ?? artifacts.plan?.lane ?? defaultLane;

  return { id, lane, artifacts, approvals };
}

export function writeArtifact(id: string, kind: ArtifactKind, raw: string, cwd: string): void {
  const dir = itemDir(id, cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${kind}.md`), raw);
}

export function appendApproval(id: string, approval: Approval, cwd: string): void {
  const dir = itemDir(id, cwd);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'approvals.jsonl'), serialiseApproval(approval) + '\n');
}

export function listItemIds(cwd: string): string[] {
  const workDir = join(relayRoot(cwd), 'work');
  if (!existsSync(workDir)) return [];
  return readdirSync(workDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

export function loadConfigText(cwd: string): string | null {
  const path = join(relayRoot(cwd), 'config.yml');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export function loadRolesText(cwd: string): string | null {
  const path = join(relayRoot(cwd), 'roles.yml');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
