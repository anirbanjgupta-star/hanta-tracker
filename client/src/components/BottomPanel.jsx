import { useState } from 'react';
import FakeNewsStrip from './FakeNewsStrip';
import LatestNews from './LatestNews';
import Guidelines from './Guidelines';
import MythVsReality from './MythVsReality';

const TABS = [
  { id: 'news',       label: 'LATEST NEWS' },
  { id: 'guidelines', label: 'GUIDELINES & PROTECTION' },
  { id: 'myths',      label: 'MYTH VS REALITY' },
];

export default function BottomPanel({
  articles = [],
  guidelines,
  flaggedCount = 0,
  meta,
  onViewFlagged,
  activeNewsFilter,
  onNewsFilterChange,
}) {
  const [activeTab, setActiveTab] = useState('news');

  function handleViewFlagged() {
    setActiveTab('news');
    if (onViewFlagged) onViewFlagged();
  }

  return (
    <>
      <style>{`
        .bottom-panel {
          background: var(--bg-base);
          border-top: 1px solid var(--border);
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          max-height: 260px;
          overflow: hidden;
        }
        .bottom-fakenews { flex-shrink: 0; }
        .bottom-tabs {
          display: flex;
          gap: 0;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
          background: var(--bg-surface);
        }
        .bottom-tab {
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--text-muted);
          font-family: var(--font-display);
          font-size: 12px;
          padding: 10px 18px;
          cursor: pointer;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          transition: color 0.15s, border-color 0.15s;
          white-space: nowrap;
        }
        .bottom-tab:hover { color: var(--text-primary); }
        .bottom-tab.active {
          color: var(--accent-cyan);
          border-bottom-color: var(--accent-cyan);
        }
        .bottom-content {
          overflow-y: auto;
          flex: 1;
          animation: fade-in 0.2s ease;
        }
        .bottom-content::-webkit-scrollbar { width: 4px; }
        .bottom-content::-webkit-scrollbar-track { background: var(--bg-base); }
        .bottom-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
      `}</style>
      <div className="bottom-panel">
        <div className="bottom-fakenews">
          <FakeNewsStrip flaggedCount={flaggedCount} onViewFlagged={handleViewFlagged} />
        </div>
        <div className="bottom-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`bottom-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="bottom-content" key={activeTab}>
          {activeTab === 'news' && (
            <LatestNews
              articles={articles}
              flaggedCount={flaggedCount}
              activeFilter={activeNewsFilter}
              onFilterChange={onNewsFilterChange}
            />
          )}
          {activeTab === 'guidelines' && <Guidelines guidelines={guidelines} />}
          {activeTab === 'myths' && <MythVsReality />}
        </div>
      </div>
    </>
  );
}
