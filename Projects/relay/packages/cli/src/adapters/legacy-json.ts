import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Artifact, ArtifactSeed, ExternalRef, SourceOfTruthAdapter, WorkItem } from '@relay/core';

interface Ticket {
  ref: string;
  title: string;
  body: string;
  relayItem?: string;
  linkedCommit?: string;
}

export class LegacyJsonAdapter implements SourceOfTruthAdapter {
  private readonly path: string;

  constructor(cwd: string) {
    this.path = join(cwd, '.relay-legacy-tickets.json');
  }

  private read(): Ticket[] {
    return existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : [];
  }

  private write(tickets: Ticket[]): void {
    writeFileSync(this.path, JSON.stringify(tickets, null, 2));
  }

  async pull(ref: string): Promise<ArtifactSeed> {
    const ticket = this.read().find((t) => t.ref === ref);
    if (!ticket) throw new Error(`No simulated legacy ticket found for ref: ${ref}`);
    return { title: ticket.title, body: ticket.body, externalRef: ticket.ref };
  }

  async push(item: WorkItem, artifact: Artifact): Promise<ExternalRef> {
    const ref = artifact.externalRef;
    if (!ref) throw new Error(`Artifact for ${item.id} has no externalRef to push against`);
    const tickets = this.read();
    const ticket = tickets.find((t) => t.ref === ref);
    if (!ticket) throw new Error(`No simulated legacy ticket found for ref: ${ref}`);
    ticket.relayItem = item.id;
    this.write(tickets);
    return ref;
  }

  async link(item: WorkItem, sha: string): Promise<void> {
    const tickets = this.read();
    const ticket = tickets.find((t) => t.relayItem === item.id);
    if (!ticket) throw new Error(`No simulated legacy ticket is linked to item: ${item.id}`);
    ticket.linkedCommit = sha;
    this.write(tickets);
  }
}
