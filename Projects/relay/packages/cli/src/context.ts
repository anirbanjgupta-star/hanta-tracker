import { parseConfig, parseRoles, type ApprovalContext, type LaneRule, type RelayConfig } from '@relay/core';
import { loadConfigText, loadRolesText } from './relay-dir.js';
import { gitIdentity } from './git.js';

export function loadRelayConfig(cwd: string): RelayConfig {
  const text = loadConfigText(cwd);
  if (!text) throw new Error('No .relay/config.yml found — run `relay init` first');
  return parseConfig(text);
}

export function buildApprovalContext(cwd: string, lane: LaneRule): ApprovalContext {
  const rolesText = loadRolesText(cwd);
  const roles = rolesText ? parseRoles(rolesText) : {};
  return { roles, lane, author: gitIdentity(cwd) };
}
