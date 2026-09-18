import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installClaudeCodeAdapter } from '../src/install.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-install-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('installClaudeCodeAdapter', () => {
  it('writes PreToolUse and SessionStart hooks into .claude/settings.json', () => {
    repo = makeScratchRepo();
    installClaudeCodeAdapter(repo.dir);

    const settings = JSON.parse(readFileSync(join(repo.dir, '.claude/settings.json'), 'utf8'));
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Edit|Write');
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toMatch(/pre-tool-use\.js$/);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toMatch(/session-start\.js$/);
  });

  it('writes all three skill files', () => {
    repo = makeScratchRepo();
    installClaudeCodeAdapter(repo.dir);

    for (const name of ['relay-intent', 'relay-spec', 'relay-plan']) {
      const content = readFileSync(join(repo.dir, `.claude/skills/${name}/SKILL.md`), 'utf8');
      expect(content).toMatch(new RegExp(`name: ${name}`));
    }
  });

  it('registers the relay MCP server in .mcp.json', () => {
    repo = makeScratchRepo();
    installClaudeCodeAdapter(repo.dir);

    const mcpConfig = JSON.parse(readFileSync(join(repo.dir, '.mcp.json'), 'utf8'));
    expect(mcpConfig.mcpServers.relay.command).toBe('node');
    expect(mcpConfig.mcpServers.relay.args[0]).toMatch(/mcp\/dist\/index\.js$/);
  });

  it('is idempotent — running twice does not duplicate hook entries', () => {
    repo = makeScratchRepo();
    installClaudeCodeAdapter(repo.dir);
    installClaudeCodeAdapter(repo.dir);

    const settings = JSON.parse(readFileSync(join(repo.dir, '.claude/settings.json'), 'utf8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it('preserves pre-existing settings.json content it does not own', () => {
    repo = makeScratchRepo();
    mkdirSync(join(repo.dir, '.claude'), { recursive: true });
    writeFileSync(join(repo.dir, '.claude/settings.json'), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'some-other-tool' }] }] },
      someOtherSetting: true,
    }));

    installClaudeCodeAdapter(repo.dir);

    const settings = JSON.parse(readFileSync(join(repo.dir, '.claude/settings.json'), 'utf8'));
    expect(settings.someOtherSetting).toBe(true);
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse.some((g: { matcher: string }) => g.matcher === 'Bash')).toBe(true);
  });
});
