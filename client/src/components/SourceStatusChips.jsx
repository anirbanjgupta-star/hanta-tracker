const SOURCE_LABELS = {
  who:       'World Health Organization',
  promed:    'ProMED Mail',
  healthmap: 'HealthMap',
  cdc:       'Centers for Disease Control',
  newsapi:   'NewsAPI',
};

function Chip({ id, status }) {
  const active = status?.active;
  const dotColor = active ? 'var(--accent-teal)' : 'var(--accent-red)';
  const lastCheck = status?.last_check
    ? new Date(status.last_check).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'unknown';

  return (
    <>
      <style>{`
        .ss-chip {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: var(--bg-surface);
          font-family: var(--font-display);
          font-size: 10px;
          color: var(--text-muted);
          cursor: default;
          user-select: none;
        }
        .ss-chip:hover .ss-tooltip { display: block; }
        .ss-tooltip {
          display: none;
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 6px 8px;
          white-space: nowrap;
          font-family: var(--font-body);
          font-size: 11px;
          color: var(--text-primary);
          z-index: 100;
          pointer-events: none;
        }
        .ss-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
      `}</style>
      <span className="ss-chip">
        <span className="ss-dot" style={{ background: dotColor }} />
        {id.toUpperCase()}
        <span className="ss-tooltip">
          {SOURCE_LABELS[id] || id} · Last check: {lastCheck}
        </span>
      </span>
    </>
  );
}

export default function SourceStatusChips({ sourceStatus = {} }) {
  const sources = ['who', 'promed', 'healthmap', 'cdc', 'newsapi'];
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {sources.map((id) => (
        <Chip key={id} id={id} status={sourceStatus[id]} />
      ))}
    </div>
  );
}
