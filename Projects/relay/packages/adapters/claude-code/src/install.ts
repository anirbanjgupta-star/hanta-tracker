import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { INTENT_SKILL, SPEC_SKILL, PLAN_SKILL } from './skills.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

interface HookEntry { type: string; command: string }
interface HookGroup { matcher?: string; hooks: HookEntry[] }
interface Settings {
  hooks?: { PreToolUse?: HookGroup[]; SessionStart?: HookGroup[] };
  [key: string]: unknown;
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

function ensureHook(groups: HookGroup[], matcher: string | undefined, command: string): HookGroup[] {
  const alreadyPresent = groups.some((g) => g.hooks.some((h) => h.command === command));
  if (alreadyPresent) return groups;
  const entry: HookGroup = matcher ? { matcher, hooks: [{ type: 'command', command }] } : { hooks: [{ type: 'command', command }] };
  return [...groups, entry];
}

export interface InstallResult {
  settingsUpdated: boolean;
  skillsWritten: string[];
  mcpRegistered: boolean;
}

export function installClaudeCodeAdapter(targetRepoDir: string): InstallResult {
  const preToolUsePath = join(HERE, 'hooks/pre-tool-use.js');
  const sessionStartPath = join(HERE, 'hooks/session-start.js');

  const settingsPath = join(targetRepoDir, '.claude/settings.json');
  const settings = readJson<Settings>(settingsPath, {});
  settings.hooks = settings.hooks ?? {};
  settings.hooks.PreToolUse = ensureHook(settings.hooks.PreToolUse ?? [], 'Edit|Write', `node ${preToolUsePath}`);
  settings.hooks.SessionStart = ensureHook(settings.hooks.SessionStart ?? [], undefined, `node ${sessionStartPath}`);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  const skills: [string, string][] = [
    ['relay-intent', INTENT_SKILL],
    ['relay-spec', SPEC_SKILL],
    ['relay-plan', PLAN_SKILL],
  ];
  const skillsWritten: string[] = [];
  for (const [name, content] of skills) {
    const dir = join(targetRepoDir, '.claude/skills', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), content);
    skillsWritten.push(name);
  }

  const mcpEntryPath = require.resolve('@relay/mcp');
  const mcpPath = join(targetRepoDir, '.mcp.json');
  const mcpConfig = readJson<{ mcpServers?: Record<string, { command: string; args: string[] }> }>(mcpPath, {});
  mcpConfig.mcpServers = mcpConfig.mcpServers ?? {};
  const mcpRegistered = !mcpConfig.mcpServers.relay;
  mcpConfig.mcpServers.relay = { command: 'node', args: [mcpEntryPath] };
  writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');

  return { settingsUpdated: true, skillsWritten, mcpRegistered };
}
