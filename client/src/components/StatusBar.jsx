import { useState, useEffect, useRef } from 'react';

const REFRESH_INTERVAL_MS = 300_000; // 5 minutes

function countActiveSources(sourceStatus) {
  if (!sourceStatus) return 0;
  return Object.values(sourceStatus).filter(Boolean).length;
}

export default function StatusBar({ meta }) {
  const [remaining, setRemaining] = useState(REFRESH_INTERVAL_MS);
  const startRef = useRef(Date.now());

  // Reset when meta updates (SSE refresh fires)
  useEffect(() => {
    startRef.current = Date.now();
    setRemaining(REFRESH_INTERVAL_MS);
  }, [meta?.last_updated]);

  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const left = Math.max(0, REFRESH_INTERVAL_MS - elapsed);
      setRemaining(left);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const totalSec = Math.floor(remaining / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const countdownStr = `${mins}:${String(secs).padStart(2, '0')}`;

  const active = countActiveSources(meta?.source_status);
  const total = 5;

  return (
    <>
      <style>{`
        .status-bar {
          height: 32px;
          background: var(--bg-surface);
          border-top: 1px solid var(--border);
          display: flex;
          align-items: center;
          padding: 0 20px;
          gap: 0;
          flex-shrink: 0;
        }
        .status-left {
          flex: 1;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
        }
        .status-centre {
          flex: 1;
          text-align: center;
          font-family: var(--font-body);
          font-size: 12px;
          color: var(--text-muted);
        }
        .status-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          font-family: var(--font-display);
          font-size: 12px;
          color: var(--text-primary);
        }
        .live-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-teal);
          animation: pulse-green 1.5s infinite;
          flex-shrink: 0;
        }
      `}</style>
      <div className="status-bar">
        <span className="status-left">NEXT REFRESH IN {countdownStr}</span>
        <span className="status-centre">SOURCES ACTIVE: {active}/{total}</span>
        <div className="status-right">
          <span className="live-dot" />
          LIVE
        </div>
      </div>
    </>
  );
}
