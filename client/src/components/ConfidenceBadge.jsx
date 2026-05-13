export default function ConfidenceBadge({ confidence }) {
  let symbol, label, color;
  if (confidence === 'high') {
    symbol = '●'; label = 'VERIFIED'; color = 'var(--accent-teal)';
  } else if (confidence === 'low') {
    symbol = '◌'; label = 'UNVERIFIED'; color = 'var(--accent-amber)';
  } else {
    symbol = '✕'; label = 'NO DATA'; color = 'var(--text-muted)';
  }

  return (
    <>
      <style>{`
        .confidence-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 2px 6px;
          border-radius: 3px;
          border: 1px solid currentColor;
        }
      `}</style>
      <span className="confidence-badge" style={{ color }}>
        {symbol} {label}
      </span>
    </>
  );
}
