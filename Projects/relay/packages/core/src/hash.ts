import { createHash } from 'node:crypto';

export function hashContent(raw: string): string {
  return 'sha256:' + createHash('sha256').update(raw, 'utf8').digest('hex');
}
