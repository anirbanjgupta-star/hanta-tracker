import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  classifyBreach, computeMetrics, parseControlBands,
  type Stage, type ControlBandsConfig,
} from '@relay/core';
import { loadRelayConfig } from '../context.js';
import { listItemIds, loadWorkItem, loadDetectorState, saveDetectorState, writeArtifact } from '../relay-dir.js';
import { allocateItemId } from '../item-id.js';
import { frontmatter } from '../templates.js';

export interface Finding {
  gate: Stage;
  zone: '1sigma' | '2sigma' | '3sigma';
  valueS: number;
  centerlineS: number;
  sigmaS: number;
  newestApprovalTs: string;
}

function loadBands(cwd: string): ControlBandsConfig | null {
  const path = join(cwd, '.relay/policies/stage6-bands.yml');
  return existsSync(path) ? parseControlBands(readFileSync(path, 'utf8')) : null;
}

export function findBreaches(cwd: string): Finding[] {
  const bands = loadBands(cwd);
  if (!bands) return [];

  const config = loadRelayConfig(cwd);
  const items = listItemIds(cwd).map((id) => loadWorkItem(id, config.defaultLane, cwd));
  const metrics = computeMetrics(items);
  const state = loadDetectorState(cwd);

  const findings: Finding[] = [];
  for (const [gate, band] of Object.entries(bands.gateLatencyS) as [Stage, { centerline: number; sigma: number }][]) {
    const stat = metrics.gateLatencyS[gate];
    if (!stat) continue;

    const zone = classifyBreach(stat.avgS, band);
    if (zone === 'none') continue;

    const newestApprovalTs = items
      .flatMap((item) => item.approvals)
      .filter((a) => a.gate === gate && a.latencyS !== undefined)
      .map((a) => a.ts)
      .sort()
      .at(-1);
    if (!newestApprovalTs) continue;

    const lastChecked = state.lastCheckedTs[gate];
    if (lastChecked && newestApprovalTs <= lastChecked) continue; // already handled

    findings.push({
      gate, zone, valueS: stat.avgS, centerlineS: band.centerline, sigmaS: band.sigma, newestApprovalTs,
    });
  }
  return findings;
}

export interface BreachIntentDraft {
  title: string;
  problem: string;
  proposedOutcome: string;
  affectedUsersAndSystems: string;
  constraints: string;
  openQuestions: string;
}

const BREACH_INTENT_DRAFT_SCHEMA = z.object({
  title: z.string(),
  problem: z.string(),
  proposedOutcome: z.string(),
  affectedUsersAndSystems: z.string(),
  constraints: z.string(),
  openQuestions: z.string(),
});

// Same fence-stripping reasoning as adopt.ts's extractJson: models wrap JSON
// in a ```json fence despite being asked for "ONLY" the JSON.
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

export function parseBreachIntentDraft(text: string): BreachIntentDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch (err) {
    throw new Error(
      `Could not parse Claude's response as JSON (${(err as Error).message}). Raw response, first 500 chars:\n${text.slice(0, 500)}`
    );
  }
  const result = BREACH_INTENT_DRAFT_SCHEMA.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Claude's response did not match the expected draft shape: ${result.error.message}`);
  }
  return result.data;
}

export type DraftFn = (finding: Finding) => Promise<BreachIntentDraft>;
export type DiagnoseFn = (finding: Finding) => Promise<string>;

function breachSummary(finding: Finding): string {
  return `The ${finding.gate} gate's average approval latency is ${Math.round(finding.valueS)}s, ` +
    `${finding.zone} from its configured centerline of ${finding.centerlineS}s (sigma: ${finding.sigmaS}s).`;
}

// The only place ANTHROPIC_API_KEY is read for this feature — never
// config.yml or any other repo file (SPEC §4.5), same rule adopt.ts
// already follows. Exercised live, once, manually with a real key; the
// automated suite and this task's own acceptance run always inject a stub
// via opts.draftFn/opts.diagnoseFn instead — no ANTHROPIC_API_KEY is
// configured in this environment, so this path has not itself been run
// against the real API as of this commit. Stated here, not silently
// implied as verified.
function requireClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — the Stage 6 detector needs a key from the environment, never from the repo (SPEC §4.5)');
  }
  return new Anthropic({ apiKey });
}

async function draftWithClaude(finding: Finding): Promise<BreachIntentDraft> {
  const client = requireClient();
  const message = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content:
        'A deterministic control-band detector (not a model) has flagged an operational problem in an ' +
        'AI-native SDLC pipeline. Draft this as a Relay intent.md: a short kebab-friendly title, and the ' +
        'five sections a triaging service owner needs. Respond with ONLY this JSON shape: ' +
        '{"title": string, "problem": string, "proposedOutcome": string, "affectedUsersAndSystems": string, ' +
        '"constraints": string, "openQuestions": string}.\n\n' + breachSummary(finding),
    }],
  });
  if (message.stop_reason === 'max_tokens') {
    throw new Error("Claude's draft was truncated (hit max_tokens) before finishing.");
  }
  const text = message.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
  return parseBreachIntentDraft(text);
}

async function diagnoseWithClaude(finding: Finding): Promise<string> {
  const client = requireClient();
  const message = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: 'In two or three sentences, diagnose a likely cause for this operational anomaly. ' +
        'This is read-only — you are not fixing anything or filing anything, only explaining.\n\n' + breachSummary(finding),
    }],
  });
  return message.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
}

export interface Stage6DetectOptions {
  draftFn?: DraftFn;
  diagnoseFn?: DiagnoseFn;
}

export interface Stage6DetectResult {
  acted: string[];
  diagnosed: Finding[];
  logged: Finding[];
}

export async function runStage6Detect(cwd: string, opts: Stage6DetectOptions = {}): Promise<Stage6DetectResult> {
  const draftFn = opts.draftFn ?? draftWithClaude;
  const diagnoseFn = opts.diagnoseFn ?? diagnoseWithClaude;
  const config = loadRelayConfig(cwd);
  const state = loadDetectorState(cwd);
  const result: Stage6DetectResult = { acted: [], diagnosed: [], logged: [] };

  for (const finding of findBreaches(cwd)) {
    if (finding.zone === '3sigma') {
      const draft = await draftFn(finding);
      const id = allocateItemId(draft.title, cwd);
      const intentRaw =
        frontmatter({ id, lane: config.defaultLane, stage: 'plan', upstream: null, origin: 'stage6-detector' }) +
        `\n## Problem\n\n${draft.problem}\n\n` +
        `## Proposed outcome\n\n${draft.proposedOutcome}\n\n` +
        `## Affected users and systems\n\n${draft.affectedUsersAndSystems}\n\n` +
        `## Constraints\n\n${draft.constraints}\n\n` +
        `## Open questions\n\n${draft.openQuestions}\n`;
      writeArtifact(id, 'intent', intentRaw, cwd);
      result.acted.push(id);
    } else if (finding.zone === '2sigma') {
      const diagnosis = await diagnoseFn(finding);
      console.log(`[stage6] ${finding.gate} gate 2-sigma breach — diagnosis: ${diagnosis}`);
      result.diagnosed.push(finding);
    } else {
      console.log(`[stage6] ${finding.gate} gate 1-sigma breach — ${breachSummary(finding)}`);
      result.logged.push(finding);
    }
    state.lastCheckedTs[finding.gate] = finding.newestApprovalTs;
  }

  saveDetectorState(state, cwd);
  return result;
}
