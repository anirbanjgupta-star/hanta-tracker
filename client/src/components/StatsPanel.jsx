import { useState, useEffect } from 'react';
import { useVisitCounter } from '../hooks/useVisitCounter';

export default function StatsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const { visitCount } = useVisitCounter();
  const [lastVisit, setLastVisit] = useState('');

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    const stored = localStorage.getItem('hanta-last-visit');
    if (stored) {
      try {
        const date = new Date(stored);
        setLastVisit(date.toLocaleString());
      } catch {
        setLastVisit('Unknown');
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <style>{`
        .stats-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          backdrop-filter: blur(2px);
        }
        .stats-panel {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 24px;
          max-width: 400px;
          width: 90%;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        .stats-title {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 20px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .stats-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid var(--border);
          font-family: var(--font-body);
          font-size: 14px;
          color: var(--text-muted);
        }
        .stats-item:last-child {
          border-bottom: none;
        }
        .stats-label {
          color: var(--text-muted);
        }
        .stats-value {
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-weight: 600;
        }
        .stats-close {
          margin-top: 20px;
          padding: 8px 16px;
          background: none;
          border: 1px solid var(--border);
          color: var(--text-muted);
          font-family: var(--font-display);
          font-size: 12px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
          width: 100%;
          letter-spacing: 0.04em;
        }
        .stats-close:hover {
          border-color: var(--accent-cyan);
          color: var(--accent-cyan);
        }
        .stats-hint {
          margin-top: 16px;
          padding: 8px;
          background: rgba(0, 180, 216, 0.08);
          border-left: 2px solid var(--accent-cyan);
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          border-radius: 2px;
        }
      `}</style>
      <div className="stats-overlay" onClick={() => setIsOpen(false)}>
        <div className="stats-panel" onClick={(e) => e.stopPropagation()}>
          <div className="stats-title">📊 Your Stats</div>
          <div className="stats-item">
            <span className="stats-label">Total Visits</span>
            <span className="stats-value">{visitCount}</span>
          </div>
          <div className="stats-item">
            <span className="stats-label">Last Visit</span>
            <span className="stats-value">{lastVisit || '—'}</span>
          </div>
          <button className="stats-close" onClick={() => setIsOpen(false)}>
            [CLOSE]
          </button>
          <div className="stats-hint">
            Press Ctrl+Shift+S to toggle stats anytime
          </div>
        </div>
      </div>
    </>
  );
}
