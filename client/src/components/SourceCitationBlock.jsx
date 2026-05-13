import { format } from 'date-fns';

function isTrusted(name) {
  return name && (name.toUpperCase().includes('WHO') || name.toUpperCase().includes('CDC'));
}

function fmtDate(str) {
  if (!str) return '—';
  try { return format(new Date(str), 'dd MMM yyyy'); } catch { return str; }
}

export default function SourceCitationBlock({ sources = [] }) {
  return (
    <>
      <style>{`
        .src-block {
          background: var(--bg-base);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 10px 12px;
        }
        .src-header {
          font-family: var(--font-display);
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 8px;
        }
        .src-entry {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 5px 0;
          border-top: 1px solid var(--border);
        }
        .src-entry:first-of-type { border-top: none; }
        .src-dot { font-size: 10px; margin-top: 2px; flex-shrink: 0; }
        .src-content { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
        .src-name {
          font-family: var(--font-body);
          font-size: 12px;
          color: var(--accent-cyan);
          text-decoration: none;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .src-name:hover { text-decoration: underline; }
        .src-url {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .src-date {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
        }
      `}</style>
      <div className="src-block">
        <div className="src-header">Data Sources for This Location</div>
        {sources.length === 0 && (
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-muted)' }}>
            No sources available.
          </span>
        )}
        {sources.map((s, i) => (
          <div className="src-entry" key={i}>
            <span
              className="src-dot"
              style={{ color: isTrusted(s.source) ? 'var(--accent-teal)' : 'var(--accent-amber)' }}
            >
              ●
            </span>
            <div className="src-content">
              <a
                className="src-name"
                href={s.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.source || '—'}
              </a>
              {s.url && <span className="src-url">{s.url}</span>}
              <span className="src-date">{fmtDate(s.published_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
