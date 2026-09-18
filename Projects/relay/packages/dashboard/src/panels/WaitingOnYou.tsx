import type { ItemProjection } from '../types.js';

async function postGate(body: { id: string; gate: string; action: string; reason?: string }) {
  await fetch('/api/gate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Filtered by "blocked at all," not by the viewer's role (SPEC §13's stated
// intent) — this daemon has no signed-in-viewer concept yet, per this
// plan's own out-of-scope note. Narrowing stated here, not silently done.
//
// These buttons always round-trip to the server (POST /api/gate -> runGate)
// regardless of whether the click would actually clear the gate. runGate
// itself never checks authority before writing — it always appends an
// 'approved'/'rejected' record; only the LATER re-derived stage (via
// validApproval's role/allowSelfApproval check) decides whether that record
// actually satisfied the gate. So an unauthorized click doesn't fail with an
// error — it succeeds (200) and writes a spurious ledger entry that never
// moves the item forward. Pre-existing runGate behavior from Phase 2, not
// introduced here; not fixed by this task since it's shared CLI/daemon
// behavior, out of this panel's own scope.
export function WaitingOnYou({ items }: { items: ItemProjection[] }) {
  const waiting = items.filter((item) => item.blockedBy.length > 0);

  return (
    <section aria-label="Waiting on you">
      {waiting.map((item) => (
        <div key={item.id}>
          <span>{item.id}</span>
          <button onClick={() => postGate({ id: item.id, gate: item.stage, action: 'approve' })}>
            Approve
          </button>
          <button
            onClick={() => {
              const reason = window.prompt('Reason for sending this back:');
              if (reason) postGate({ id: item.id, gate: item.stage, action: 'reject', reason });
            }}
          >
            Send back
          </button>
        </div>
      ))}
    </section>
  );
}
