import { checkDrift, evaluateGate, GATE_FOR_KIND } from '@relay/core';
import { loadWorkItem } from '../relay-dir.js';
import { loadRelayConfig, buildApprovalContext } from '../context.js';
import { currentBranch, itemIdFromBranch, touchedFiles } from '../git.js';

export interface VerifyOptions {
  base?: string;
  testsPassed?: boolean;
}

export interface VerifyReport {
  id: string | null;
  passed: boolean;
  reasons: string[];
}

export function runVerify(cwd: string, opts: VerifyOptions = {}): VerifyReport {
  const branch = currentBranch(cwd);
  const id = itemIdFromBranch(branch);
  if (!id) {
    return {
      id: null,
      passed: false,
      reasons: [`Branch ${branch} does not declare a work item (expected relay/<id>)`],
    };
  }

  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(id, config.defaultLane, cwd);
  const laneRule = config.lanes[item.lane];
  const ctx = buildApprovalContext(cwd, laneRule);

  const reasons: string[] = [];

  // SPEC §7.4 checks 2, 3, 4 — required artifacts, schema, authority — all
  // answered per required gate by evaluateGate. Check 6 (overrides need a
  // reason) is enforced inside validApproval, reached transitively here.
  for (const kind of laneRule.requires) {
    const gate = GATE_FOR_KIND[kind];
    const result = evaluateGate(item, gate, ctx, { testsRan: opts.testsPassed });
    reasons.push(...result.reasons.map((r) => `[${gate}:${kind}] ${r}`));
  }

  // SPEC §7.4 check 5 — drift. touchedFiles shells out to `git diff
  // <base>...HEAD`, which throws if `base` doesn't resolve in this repo (e.g.
  // the hardcoded 'main' default on a repo whose default branch is 'trunk').
  // runVerify's whole contract is that it always returns a report rather than
  // throwing, so a bad base ref must become a reason, not an unhandled crash.
  if (item.artifacts.plan) {
    const base = opts.base ?? 'main';
    try {
      const drift = checkDrift(item.artifacts.plan.body, touchedFiles(base, cwd), laneRule.driftIsFatal);
      if (!drift.passed) reasons.push(...drift.reasons);
    } catch (err) {
      // execFileSync's own .message is just "Command failed: git diff ...";
      // git's actual reason (e.g. "fatal: ambiguous argument ...") is on
      // stderr, and that's what's actually useful to someone reading CI output.
      const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim().split('\n')[0];
      reasons.push(`Could not compute the diff against base '${base}': ${stderr || (err as Error).message.split('\n')[0]}`);
    }
  }

  return { id, passed: reasons.length === 0, reasons };
}
