import { useState } from 'react';
import { format } from 'date-fns';

const PAGE_SIZE = 12;

function fmtDate(str) {
  if (!str) return '—';
  try { return format(new Date(str), 'dd MMM yyyy'); } catch { return str; }
}

export default function LatestNews({ articles = [], flaggedCount = 0, activeFilter, onFilterChange }) {
  const [page, setPage] = useState(1);

  const filtered = [...articles]
    .filter(a => {
      if (activeFilter === 'flagged') return a.is_disputed || a.is_unverified_claim;
      if (activeFilter === 'verified') return !a.is_disputed && !a.is_unverified_claim;
      return true;
    })
    .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));

  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = filtered.length > visible.length;

  return (
    <>
      <style>{`
        .news-filters {
          display: flex;
          gap: 6px;
          padding: 8px 12px 6px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .news-filter-btn {
          background: none;
          border: 1px solid var(--border);
          color: var(--text-muted);
          font-family: var(--font-display);
          font-size: 9px;
          padding: 3px 8px;
          border-radius: 2px;
          cursor: pointer;
          letter-spacing: 0.04em;
          transition: all 0.15s;
        }
        .news-filter-btn:hover { border-color: var(--accent-cyan); color: var(--accent-cyan); }
        .news-filter-btn.active {
          border-color: var(--accent-cyan);
          color: var(--accent-cyan);
          background: rgba(0,180,216,0.08);
        }
        .news-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          padding: 10px 12px;
        }
        .news-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 10px;
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 4px;
          transition: border-color 0.15s;
        }
        .news-card:hover { border-color: var(--accent-cyan); }
        .news-badges {
          position: absolute;
          top: 6px;
          right: 6px;
          display: flex;
          gap: 3px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .news-badge {
          font-family: var(--font-display);
          font-size: 8px;
          padding: 2px 4px;
          border-radius: 2px;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }
        .news-headline {
          font-family: var(--font-body);
          font-size: 12px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.3;
          padding-right: 50px;
        }
        .news-meta {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-muted);
        }
        .news-summary {
          font-family: var(--font-body);
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.4;
          flex: 1;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .news-link {
          font-family: var(--font-body);
          font-size: 10px;
          color: var(--accent-cyan);
          text-decoration: none;
          margin-top: auto;
        }
        .news-link:hover { text-decoration: underline; }
        .news-load-more {
          display: block;
          margin: 2px auto 8px;
          background: none;
          border: 1px solid var(--border);
          color: var(--text-muted);
          font-family: var(--font-display);
          font-size: 9px;
          padding: 4px 12px;
          border-radius: 2px;
          cursor: pointer;
          letter-spacing: 0.04em;
        }
        .news-load-more:hover { border-color: var(--accent-cyan); color: var(--accent-cyan); }
      `}</style>

      <div className="news-filters">
        {[['all', 'ALL'], ['flagged', `FLAGGED ONLY${flaggedCount > 0 ? ` (${flaggedCount})` : ''}`], ['verified', 'VERIFIED ONLY']].map(([val, label]) => (
          <button
            key={val}
            className={`news-filter-btn${activeFilter === val ? ' active' : ''}`}
            onClick={() => { onFilterChange(val); setPage(1); }}
          >
            [{label}]
          </button>
        ))}
      </div>

      <div className="news-grid">
        {visible.map((a, i) => (
          <div className="news-card" key={a.id || i}>
            <div className="news-badges">
              {a.is_disputed && (
                <span className="news-badge" style={{ background: 'rgba(155,93,229,0.2)', color: 'var(--accent-purple)', border: '1px solid var(--accent-purple)' }}>
                  ⚑ DISPUTED
                </span>
              )}
              {a.is_unverified_claim && (
                <span className="news-badge" style={{ background: 'rgba(244,162,97,0.2)', color: 'var(--accent-amber)', border: '1px solid var(--accent-amber)' }}>
                  ⚠ UNVERIFIED CLAIM
                </span>
              )}
            </div>
            <div className="news-headline">{a.headline || a.title || '—'}</div>
            <div className="news-meta">{a.source || '—'} · {fmtDate(a.published_at)}</div>
            {a.summary && <div className="news-summary">{a.summary}</div>}
            {a.url && (
              <a className="news-link" href={a.url} target="_blank" rel="noopener noreferrer">
                Read more ↗
              </a>
            )}
          </div>
        ))}
        {visible.length === 0 && (
          <div style={{ gridColumn: '1/-1', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>
            No articles match this filter.
          </div>
        )}
      </div>

      {hasMore && (
        <button className="news-load-more" onClick={() => setPage(p => p + 1)}>
          [LOAD MORE]
        </button>
      )}
    </>
  );
}
