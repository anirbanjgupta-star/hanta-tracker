import type { GateResult } from './types.js';

export function declaredFiles(planBody: string): string[] {
  const section = planBody.split(/^##\s+/m).find((s) =>
    s.toLowerCase().startsWith('files that change')
  );
  if (!section) return [];
  return [...section.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

export function checkDrift(
  planBody: string,
  touched: string[],
  fatal: boolean
): GateResult {
  const declared = new Set(declaredFiles(planBody));
  const stray = touched.filter(
    (f) => !declared.has(f) && !f.startsWith('.relay/')
  );

  if (stray.length === 0) return { gate: 'build', passed: true, reasons: [] };

  const reasons = [
    `Files touched but not declared in plan.md: ${stray.join(', ')}`,
  ];
  return { gate: 'build', passed: !fatal, reasons };
}
