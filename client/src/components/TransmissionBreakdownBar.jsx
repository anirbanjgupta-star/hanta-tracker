export default function TransmissionBreakdownBar({ rodent = 0, person = 0 }) {
  const rodentPct = Math.round((rodent || 0) * 100);
  const personPct = Math.round((person || 0) * 100);

  return (
    <>
      <style>{`
        .tx-breakdown { display: flex; flex-direction: column; gap: 8px; }
        .tx-row { display: flex; flex-direction: column; gap: 3px; }
        .tx-label-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .tx-label {
          font-family: var(--font-body);
          font-size: 11px;
          color: var(--text-muted);
        }
        .tx-pct {
          font-family: var(--font-mono);
          font-size: 11px;
        }
        .tx-track {
          width: 100%;
          height: 6px;
          background: var(--border);
          border-radius: 3px;
          overflow: hidden;
        }
        .tx-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.4s ease;
        }
      `}</style>
      <div className="tx-breakdown">
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontStyle: 'italic' }}>
          (Approximate distribution)
        </div>
        <div className="tx-row">
          <div className="tx-label-row">
            <span className="tx-label">Rodent-to-human</span>
            <span className="tx-pct" style={{ color: 'var(--accent-red)' }}>
              {rodentPct}%
            </span>
          </div>
          <div className="tx-track">
            <div
              className="tx-fill"
              style={{ width: `${rodentPct}%`, background: 'var(--accent-red)' }}
            />
          </div>
        </div>
        <div className="tx-row">
          <div className="tx-label-row">
            <span className="tx-label">Person-to-person</span>
            <span className="tx-pct" style={{ color: 'var(--accent-cyan)' }}>
              {personPct}%
            </span>
          </div>
          <div className="tx-track">
            <div
              className="tx-fill"
              style={{ width: `${personPct}%`, background: 'var(--accent-cyan)' }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
