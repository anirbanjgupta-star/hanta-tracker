import { mythsAndFacts } from '../data/mythsAndFacts';

export default function MythVsReality() {
  return (
    <>
      <style>{`
        .mvr-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          padding: 16px;
        }
        .mvr-pair {
          display: contents;
        }
        .mvr-card {
          border-radius: 6px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .mvr-myth {
          background: rgba(230,57,70,0.06);
          border-left: 3px solid var(--accent-red);
        }
        .mvr-reality {
          background: rgba(46,196,182,0.06);
          border-left: 3px solid var(--accent-teal);
        }
        .mvr-header {
          font-family: var(--font-display);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .mvr-body {
          font-family: var(--font-body);
          font-size: 13px;
          color: var(--text-primary);
          line-height: 1.55;
          flex: 1;
        }
        .mvr-source {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-muted);
        }
        .mvr-source a {
          color: var(--accent-teal);
          text-decoration: none;
        }
        .mvr-source a:hover { text-decoration: underline; }
        .mvr-divider {
          grid-column: 1 / -1;
          border: none;
          border-top: 1px solid var(--border);
          margin: 0;
        }
      `}</style>
      <div className="mvr-grid">
        {mythsAndFacts.map((pair, i) => (
          <>
            {i > 0 && <hr className="mvr-divider" key={`div-${i}`} />}
            <div className="mvr-card mvr-myth" key={`myth-${i}`}>
              <div className="mvr-header" style={{ color: 'var(--accent-red)' }}>✗ MYTH</div>
              <div className="mvr-body">{pair.myth}</div>
            </div>
            <div className="mvr-card mvr-reality" key={`reality-${i}`}>
              <div className="mvr-header" style={{ color: 'var(--accent-teal)' }}>✓ REALITY</div>
              <div className="mvr-body">{pair.reality}</div>
              <div className="mvr-source">
                Source:{' '}
                <a href={pair.sourceUrl} target="_blank" rel="noopener noreferrer">
                  {pair.source} ↗
                </a>
              </div>
            </div>
          </>
        ))}
      </div>
    </>
  );
}
