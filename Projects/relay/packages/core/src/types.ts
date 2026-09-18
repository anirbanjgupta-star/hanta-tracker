export type Lane = 'express' | 'standard' | 'governed';
export type Stage = 'intake' | 'plan' | 'design' | 'build' | 'done';
export type ArtifactKind = 'intent' | 'spec' | 'plan';
export type Verdict = 'approved' | 'rejected' | 'override';

export interface Artifact {
  kind: ArtifactKind;
  itemId: string;
  lane: Lane;
  upstream: string | null;
  policies: string[];
  externalRef: string | null;
  origin: 'authored' | 'adopted' | 'stage6-detector';
  body: string;
  raw: string;
}

export interface Approval {
  ts: string;
  itemId: string;
  gate: Stage;
  artifact: string;
  hash: string;
  identity: string;
  role: string;
  verdict: Verdict;
  reason?: string;
  latencyS?: number;
}

export interface RoleMap {
  [identity: string]: string[];
}

export interface LaneRule {
  requires: ArtifactKind[];
  gateRoles: Partial<Record<Stage, string[]>>;
  allowSelfApproval: boolean;
  driftIsFatal: boolean;
}

export interface RelayConfig {
  sourceOfTruth: 'legacy' | 'repo';
  defaultLane: Lane;
  lanes: Record<Lane, LaneRule>;
}

export interface WorkItem {
  id: string;
  lane: Lane;
  artifacts: Partial<Record<ArtifactKind, Artifact>>;
  approvals: Approval[];
}

export interface GateResult {
  gate: Stage;
  passed: boolean;
  reasons: string[];
}

export type ExternalRef = string;

export interface ArtifactSeed {
  title: string;
  body: string;
  externalRef: ExternalRef;
}

export interface SourceOfTruthAdapter {
  pull(ref: string): Promise<ArtifactSeed>;
  push(item: WorkItem, artifact: Artifact): Promise<ExternalRef>;
  link(item: WorkItem, sha: string): Promise<void>;
}
