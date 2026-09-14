#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { currentItem } from './tools/current-item.js';
import { gateStatus } from './tools/gate-status.js';
import { resumeText } from './tools/resume.js';
import { requestGate } from './tools/request-gate.js';
import { handoverForCurrentStage } from './tools/handover.js';

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

function errorText(err: unknown) {
  return { content: [{ type: 'text' as const, text: (err as Error).message }], isError: true };
}

const server = new McpServer({ name: 'relay', version: '0.1.0' });

server.registerTool(
  'relay_current_item',
  { description: 'Item id, lane, and derived stage for the item on the current branch (or .relay/CURRENT).' },
  async () => {
    try {
      return text(JSON.stringify(currentItem(process.cwd())));
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  'relay_gate_status',
  { description: 'Which gate blocks the current item, why, and which identities can clear it.' },
  async () => {
    try {
      return text(JSON.stringify(gateStatus(process.cwd())));
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  'relay_resume',
  { description: 'The resume briefing for the current item, as text: stage, blockers, open questions, recent history, next step.' },
  async () => {
    try {
      return text(resumeText(process.cwd()));
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  'relay_request_gate',
  { description: "Records that the agent believes the current item's gate is ready for review. Does NOT approve it — only a human (or relay gate --approve) can do that." },
  async () => {
    try {
      return text(JSON.stringify(requestGate(process.cwd())));
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  'relay_handover',
  { description: 'The five-part handover bundle for whichever stage the current item is at.' },
  async () => {
    try {
      return text(handoverForCurrentStage(process.cwd()));
    } catch (err) {
      return errorText(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
