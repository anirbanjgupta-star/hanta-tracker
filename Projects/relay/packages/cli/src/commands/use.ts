import { setCurrentItemId } from '../current-item.js';

export function runUse(id: string, cwd: string): void {
  setCurrentItemId(id, cwd);
}
