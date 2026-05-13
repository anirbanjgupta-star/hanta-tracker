const levelConfig = {
  WATCH:    { color: 'var(--accent-teal)',   bg: 'rgba(46,196,182,0.12)',  border: 'var(--accent-teal)',   pulse: false },
  ADVISORY: { color: 'var(--accent-cyan)',   bg: 'rgba(0,180,216,0.12)',   border: 'var(--accent-cyan)',   pulse: false },
  WARNING:  { color: 'var(--accent-amber)',  bg: 'rgba(244,162,97,0.12)',  border: 'var(--accent-amber)',  pulse: false },
  CRITICAL: { color: 'var(--accent-red)',    bg: 'rgba(230,57,70,0.12)',   border: 'var(--accent-red)',    pulse: true  },
};

export default function AlertLevelBadge({ level }) {
  const cfg = levelConfig[level] || levelConfig.WATCH;
  return (
    <>
      <style>{`
        .alert-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 6px 12px;
          border-radius: 4px;
          font-family: var(--font-display);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .alert-dot-pulse {
          animation: pulse-red 1s infinite;
          border-radius: 50%;
          display: inline-block;
          width: 8px;
          height: 8px;
          flex-shrink: 0;
        }
      `}</style>
      <div
        className="alert-badge"
        style={{
          color: cfg.color,
          background: cfg.bg,
          border: `1px solid ${cfg.border}`,
        }}
      >
        <span
          className={cfg.pulse ? 'alert-dot-pulse' : ''}
          style={{
            display: 'inline-block',
            width: cfg.pulse ? undefined : '8px',
            height: cfg.pulse ? undefined : '8px',
            flexShrink: 0,
          }}
        >
          ◉
        </span>
        {level || 'WATCH'}
      </div>
    </>
  );
}
