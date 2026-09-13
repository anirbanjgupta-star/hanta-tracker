#!/usr/bin/env node
import { Command, Argument, Option } from 'commander';
import type { Lane, Stage } from '@relay/core';
import { runInit } from './commands/init.js';
import { runNew } from './commands/new.js';
import { runUse } from './commands/use.js';
import { runStatus } from './commands/status.js';
import { runLint } from './commands/lint.js';
import { runGate, type GateAction } from './commands/gate.js';
import { runHandover, type HandoverTarget } from './commands/handover.js';
import { runResume } from './commands/resume.js';
import { runVerify } from './commands/verify.js';
import { runAdopt } from './commands/adopt.js';
import { resolveCurrentItemId } from './current-item.js';

function guarded<T extends unknown[]>(fn: (...args: T) => void | Promise<void>) {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  };
}

const program = new Command();
program.name('relay').description('Relay — the AI-native SDLC runtime');

program.command('init').action(guarded(() => {
  const result = runInit(process.cwd());
  const detected = result.detectedRuleFiles.length > 0 ? ` Detected: ${result.detectedRuleFiles.join(', ')}.` : '';
  console.log(`Tier ${result.tier} reached.${detected}`);
  console.log(result.ciWorkflowWritten ? 'CI workflow written.' : 'No GitHub remote — CI workflow skipped.');
}));

program.command('new')
  .argument('<title>')
  .addOption(new Option('--lane <lane>').choices(['express', 'standard', 'governed']))
  .option('--from <ref>')
  .action(guarded(async (title: string, opts: { lane?: Lane; from?: string }) => {
    const result = await runNew(title, opts, process.cwd());
    console.log(`Created ${result.id} on branch ${result.branch} (${result.lane} lane).`);
  }));

program.command('use')
  .argument('<id>')
  .action(guarded((id: string) => {
    runUse(id, process.cwd());
    console.log(`Current item set to ${id}.`);
  }));

program.command('status')
  .argument('[id]')
  .action(guarded((id?: string) => {
    const result = runStatus(process.cwd(), id);
    console.log(`${result.id} (${result.lane}) — stage: ${result.stage}`);
    if (result.blockedBy.length > 0) {
      console.log('Blocked by:');
      for (const reason of result.blockedBy) console.log(`  - ${reason}`);
    }
  }));

program.command('lint')
  .argument('[id]')
  .action(guarded((id?: string) => {
    const result = runLint(process.cwd(), id);
    if (result.ok) {
      console.log(`${result.id}: lint clean.`);
      return;
    }
    for (const { artifact, problems } of result.problems) {
      console.log(`${artifact}:`);
      for (const p of problems) console.log(`  - ${p}`);
    }
    process.exitCode = 1;
  }));

program.command('gate')
  .addArgument(new Argument('<gate>').choices(['plan', 'design', 'build']))
  .argument('[id]')
  .option('--approve')
  .option('--reject')
  .option('--override')
  .option('--reason <text>')
  .action(guarded(async (
    gate: Stage,
    id: string | undefined,
    opts: { approve?: boolean; reject?: boolean; override?: boolean; reason?: string }
  ) => {
    const actions = [opts.approve && 'approve', opts.reject && 'reject', opts.override && 'override']
      .filter(Boolean) as GateAction[];
    if (actions.length !== 1) throw new Error('Pass exactly one of --approve, --reject, --override');
    if ((actions[0] === 'reject' || actions[0] === 'override') && !opts.reason) {
      throw new Error(`--reason is required for --${actions[0]}`);
    }
    const itemId = id ?? resolveCurrentItemId(process.cwd());
    const approval = await runGate(itemId, gate, actions[0], opts.reason, process.cwd());
    console.log(`Recorded ${approval.verdict} on ${itemId} at the ${gate} gate.`);
  }));

program.command('handover')
  .argument('<id>')
  .addOption(new Option('--to <stage>').choices(['design', 'build']).makeOptionMandatory())
  .action(guarded((id: string, opts: { to: HandoverTarget }) => {
    const path = runHandover(id, opts.to, process.cwd());
    console.log(`Handover bundle written to ${path}.`);
  }));

program.command('resume')
  .argument('[id]')
  .action(guarded((id?: string) => {
    const brief = runResume(process.cwd(), id);
    console.log(`${brief.id} — stage: ${brief.stage}`);
    if (brief.blockedBy.length > 0) {
      console.log('Blocked by:');
      for (const reason of brief.blockedBy) console.log(`  - ${reason}`);
    }
    console.log(`Open questions: ${brief.openQuestions}`);
    console.log('Recent history:');
    for (const h of brief.recentHistory) console.log(`  - ${h}`);
    console.log(`Next: ${brief.next}`);
  }));

program.command('verify')
  .option('--base <ref>', 'branch to diff against', 'main')
  .option('--tests-passed', 'confirm the tests named in plan.md ran and passed')
  .action(guarded((opts: { base: string; testsPassed?: boolean }) => {
    const report = runVerify(process.cwd(), { base: opts.base, testsPassed: opts.testsPassed });
    if (report.passed) {
      console.log(`${report.id}: verify passed.`);
      return;
    }
    console.log(`${report.id ?? '(no item)'}: verify FAILED`);
    for (const r of report.reasons) console.log(`  - ${r}`);
    process.exitCode = 1;
  }));

program.command('adopt')
  .option('--base <ref>', 'branch to diff against', 'main')
  .action(guarded(async (opts: { base: string }) => {
    const result = await runAdopt(process.cwd(), { base: opts.base });
    console.log(`Adopted as ${result.id} (origin: adopted). Review and \`relay lint\` before approving any gate.`);
  }));

program.parseAsync(process.argv);
