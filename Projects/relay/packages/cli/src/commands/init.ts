import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  intentTemplate, specTemplate, planTemplate,
  defaultConfigYaml, defaultRolesYaml, ciWorkflowYaml,
} from '../templates.js';
import { remoteIsGitHub } from '../git.js';

export interface InitResult {
  tier: 0 | 1;
  detectedRuleFiles: string[];
  ciWorkflowWritten: boolean;
}

const RULE_FILES = ['CLAUDE.md', '.cursor/rules', 'AGENTS.md'];

const SCHEMA_STUB = (kind: string, sections: string[]) =>
  `# Mirrors the rules hardcoded in @relay/core's schema.ts as of Phase 2.\n` +
  `# Not yet read back by \`relay lint\` — forkable documentation today, live\n` +
  `# configuration in a future phase.\n` +
  `kind: ${kind}\n` +
  `requiredSections:\n${sections.map((s) => `  - "${s}"`).join('\n')}\n`;

function ensureGitignored(cwd: string, entries: string[]): void {
  const path = join(cwd, '.gitignore');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  // Exact line match, not a substring check — a comment mentioning the path
  // (e.g. "# TODO: .relay/CURRENT") must not count as already ignoring it,
  // since the failure mode of a false match here is silent under-protection.
  const existingLines = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = entries.filter((e) => !existingLines.has(e));
  if (missing.length === 0) return;
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(path, prefix + missing.join('\n') + '\n');
}

export function runInit(cwd: string, opts: { force?: boolean } = {}): InitResult {
  const relayDir = join(cwd, '.relay');
  if (existsSync(relayDir) && !opts.force) {
    throw new Error('.relay/ already initialized — pass --force to re-scaffold');
  }

  for (const dir of ['schemas', 'templates', 'work']) {
    mkdirSync(join(relayDir, dir), { recursive: true });
  }

  writeFileSync(join(relayDir, 'config.yml'), defaultConfigYaml());
  writeFileSync(join(relayDir, 'roles.yml'), defaultRolesYaml());

  writeFileSync(join(relayDir, 'templates/intent.md'), intentTemplate('<id>', 'standard'));
  writeFileSync(join(relayDir, 'templates/spec.md'), specTemplate('<id>', 'standard', '<upstream-hash>'));
  writeFileSync(join(relayDir, 'templates/plan.md'), planTemplate('<id>', 'standard', '<upstream-hash>'));

  writeFileSync(join(relayDir, 'schemas/intent.schema.yml'),
    SCHEMA_STUB('intent', ['Problem', 'Proposed outcome', 'Affected users and systems', 'Constraints', 'Open questions']));
  writeFileSync(join(relayDir, 'schemas/spec.schema.yml'),
    SCHEMA_STUB('spec', ['Requirements', 'Design', 'Flagged concerns']));
  writeFileSync(join(relayDir, 'schemas/plan.schema.yml'),
    SCHEMA_STUB('plan', ['Files that change', 'Work order', 'Tests that prove completion']));

  writeFileSync(join(cwd, '.relay-legacy-tickets.json'), JSON.stringify([
    { ref: 'JIRA-1001', title: 'Persist catalog metadata in git', body: 'Items added through the UI live only in gitignored db.json and are lost on reseed.' },
    { ref: 'JIRA-1002', title: 'Fix typo on the checkout button', body: 'Button reads "Chekout".' },
  ], null, 2));

  ensureGitignored(cwd, ['.relay/CURRENT', '.relay-legacy-tickets.json']);

  const detectedRuleFiles = RULE_FILES.filter((f) => existsSync(join(cwd, f)));
  const tier = detectedRuleFiles.length > 0 ? 1 : 0;

  let ciWorkflowWritten = false;
  if (remoteIsGitHub(cwd)) {
    mkdirSync(join(cwd, '.github/workflows'), { recursive: true });
    writeFileSync(join(cwd, '.github/workflows/relay-verify.yml'), ciWorkflowYaml());
    ciWorkflowWritten = true;
  }

  return { tier, detectedRuleFiles, ciWorkflowWritten };
}
