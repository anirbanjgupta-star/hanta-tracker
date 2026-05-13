import { useState } from 'react';
import { format } from 'date-fns';
import AlertLevelBadge from './AlertLevelBadge';
import SourceStatusChips from './SourceStatusChips';

function computeAlertLevel(cases) {
  if (!cases || cases.length === 0) return 'WATCH';
  const levels = ['WATCH', 'ADVISORY', 'WARNING', 'CRITICAL'];
  const max = cases.reduce((acc, c) => {
    const idx = levels.indexOf(c.alert_level);
    return idx > acc ? idx : acc;
  }, 0);
  return levels[max];
}

export default function Header({ meta, globalCases, globalFatalities, cases = [] }) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/cases');
      if (res.ok) {
        window.location.reload();
      }
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  };
  const lastUpdated = meta?.last_updated
    ? (() => {
        try { return format(new Date(meta.last_updated), 'dd MMM yyyy HH:mm') + ' UTC'; }
        catch { return meta.last_updated; }
      })()
    : '—';

  const alertLevel = computeAlertLevel(cases);

  return (
    <>
      <style>{`
        .header {
          height: 48px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          padding: 0 20px;
          gap: 20px;
          flex-shrink: 0;
        }
        .header-brand {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .header-icon {
          font-size: 18px;
          color: var(--accent-red);
        }
        .header-title {
          font-family: var(--font-display);
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.15em;
          color: var(--text-primary);
          white-space: nowrap;
        }
        .header-stats {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          justify-content: center;
        }
        .stat-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 3px 10px;
          border-radius: 12px;
          font-family: var(--font-mono);
          font-size: 12px;
          white-space: nowrap;
        }
        .stat-pill-label {
          font-family: var(--font-body);
          font-size: 11px;
          font-weight: 500;
        }
        .header-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }
        .last-updated {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .header-badge-wrap { width: 130px; }
        .refresh-btn {
          background: none;
          border: 1px solid var(--border);
          color: var(--text-muted);
          font-family: var(--font-display);
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 3px;
          cursor: pointer;
          transition: all 0.2s;
          letter-spacing: 0.06em;
        }
        .refresh-btn:hover:not(:disabled) { border-color: var(--accent-cyan); color: var(--accent-cyan); }
        .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .refresh-btn.spinning { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <header className="header">
        <div className="header-brand">
          <span className="header-icon">☣</span>
          <span className="header-title">HANTAVIRUS TRACKER</span>
        </div>

        <div className="header-stats">
          <span
            className="stat-pill"
            style={{ background: 'rgba(230,57,70,0.15)', border: '1px solid var(--accent-red)' }}
          >
            <span className="stat-pill-label" style={{ color: 'var(--accent-red)' }}>GLOBAL CASES</span>
            <span style={{ color: 'var(--text-primary)' }}>
              {globalCases != null ? globalCases.toLocaleString() : '—'}
            </span>
          </span>
          <span
            className="stat-pill"
            style={{ background: 'rgba(28,39,51,0.8)', border: '1px solid var(--border)' }}
          >
            <span className="stat-pill-label" style={{ color: 'var(--text-muted)' }}>FATALITIES</span>
            <span style={{ color: 'var(--text-primary)' }}>
              {globalFatalities != null ? globalFatalities.toLocaleString() : '—'}
            </span>
          </span>
        </div>

        <div className="header-right">
          <span className="last-updated">Updated: {lastUpdated}</span>
          <button
            className={`refresh-btn${refreshing ? ' spinning' : ''}`}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh data"
          >
            ⟳ REFRESH
          </button>
          <div className="header-badge-wrap">
            <AlertLevelBadge level={alertLevel} />
          </div>
          <SourceStatusChips sourceStatus={meta?.source_status || {}} />
        </div>
      </header>
    </>
  );
}
