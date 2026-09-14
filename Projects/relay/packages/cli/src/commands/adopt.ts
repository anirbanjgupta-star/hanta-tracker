import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { loadRelayConfig } from '../context.js';
import { allocateItemId } from '../item-id.js';
import { writeArtifact } from '../relay-dir.js';
import { diffText, touchedFiles } from '../git.js';
import { frontmatter } from '../templates.js';
import { hashContent } from '@relay/core';

export interface AdoptedDraft {
  title: string;
  intent: { problem: string; proposedOutcome: string; affectedUsersAndSystems: string; constraints: string; openQuestions: string };
  spec: { requirements: string; design: string; flaggedConcerns: string };
  plan: { workOrder: string; testsThatProveCompletion: string };
}

const ADOPTED_DRAFT_SCHEMA = z.object({
  title: z.string(),
  intent: z.object({
    problem: z.string(),
    proposedOutcome: z.string(),
    affectedUsersAndSystems: z.string(),
    constraints: z.string(),
    openQuestions: z.string(),
  }),
  spec: z.object({
    requirements: z.string(),
    design: z.string(),
    flaggedConcerns: z.string(),
  }),
  plan: z.object({
    workOrder: z.string(),
    testsThatProveCompletion: z.string(),
  }),
});

export type DraftFn = (diff: string) => Promise<AdoptedDraft>;

// Models commonly wrap JSON in a ```json fence or add a line of preamble
// despite being asked for "ONLY" the JSON — strip a fence if present rather
// than handing a syntax error to the caller for a response that was
// otherwise perfectly fine.
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

// Exported separately from draftWithClaude so this — the actual untrusted-
// input boundary — gets real unit coverage without a network call. Guards
// against two real LLM failure modes: a response that isn't valid JSON once
// unwrapped, and one that parses but doesn't match AdoptedDraft's shape
// (missing/wrong-typed fields), either of which would otherwise be trusted
// via a bare type assertion and could write a garbled or partial artifact.
export function parseAdoptedDraft(text: string): AdoptedDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch (err) {
    throw new Error(
      `Could not parse Claude's response as JSON (${(err as Error).message}). Raw response, first 500 chars:\n${text.slice(0, 500)}`
    );
  }

  const result = ADOPTED_DRAFT_SCHEMA.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Claude's response did not match the expected draft shape: ${result.error.message}`);
  }
  return result.data;
}

// The only place ANTHROPIC_API_KEY is read — never config.yml or any other
// repo file (SPEC §4.5). This path is exercised live, once, manually; the
// automated suite always injects a stub via opts.draftFn instead.
async function draftWithClaude(diff: string): Promise<AdoptedDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set — relay adopt needs a key from the environment, never from the repo (SPEC §4.5)'
    );
  }
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content:
        'This diff is already in production. Draft the Relay artifact chain backwards from it: ' +
        'a short kebab-friendly title, and the narrative content for intent.md, spec.md and plan.md ' +
        '(everything except "Files that change", which is derived separately from the diff itself). ' +
        'Respond with ONLY this JSON shape: {"title": string, ' +
        '"intent": {"problem": string, "proposedOutcome": string, "affectedUsersAndSystems": string, "constraints": string, "openQuestions": string}, ' +
        '"spec": {"requirements": string, "design": string, "flaggedConcerns": string}, ' +
        '"plan": {"workOrder": string, "testsThatProveCompletion": string}}.\n\nDiff:\n' + diff,
    }],
  });

  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      "Claude's draft was truncated (hit max_tokens) before finishing — the diff may be too large for a single `relay adopt` call."
    );
  }

  const text = message.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
  return parseAdoptedDraft(text);
}

export interface AdoptOptions {
  base?: string;
  draftFn?: DraftFn;
}

export async function runAdopt(cwd: string, opts: AdoptOptions): Promise<{ id: string }> {
  const config = loadRelayConfig(cwd);
  const base = opts.base ?? 'main';
  const diff = diffText(base, cwd);
  if (diff.trim().length === 0) throw new Error(`No diff against ${base} to adopt from`);

  const filesChanged = touchedFiles(base, cwd);

  const draftFn = opts.draftFn ?? draftWithClaude;
  const draft = await draftFn(diff);

  const id = allocateItemId(draft.title, cwd);
  const lane = config.defaultLane;

  const intentRaw =
    frontmatter({ id, lane, stage: 'plan', upstream: null, origin: 'adopted' }) +
    `\n## Problem\n\n${draft.intent.problem}\n\n` +
    `## Proposed outcome\n\n${draft.intent.proposedOutcome}\n\n` +
    `## Affected users and systems\n\n${draft.intent.affectedUsersAndSystems}\n\n` +
    `## Constraints\n\n${draft.intent.constraints}\n\n` +
    `## Open questions\n\n${draft.intent.openQuestions}\n`;
  writeArtifact(id, 'intent', intentRaw, cwd);

  const specRaw =
    frontmatter({ id, lane, stage: 'design', upstream: hashContent(intentRaw), origin: 'adopted' }) +
    `\n## Requirements\n\n${draft.spec.requirements}\n\n` +
    `## Design\n\n${draft.spec.design}\n\n` +
    `## Flagged concerns\n\n${draft.spec.flaggedConcerns}\n`;
  writeArtifact(id, 'spec', specRaw, cwd);

  const filesSection = filesChanged.map((f) => `- \`${f}\``).join('\n');
  const planRaw =
    frontmatter({ id, lane, stage: 'build', upstream: hashContent(specRaw), origin: 'adopted' }) +
    `\n## Files that change\n\n${filesSection}\n\n` +
    `## Work order\n\n${draft.plan.workOrder}\n\n` +
    `## Tests that prove completion\n\n${draft.plan.testsThatProveCompletion}\n`;
  writeArtifact(id, 'plan', planRaw, cwd);

  return { id };
}
