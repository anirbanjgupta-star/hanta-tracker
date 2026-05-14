import { useState, useEffect } from 'react';
import './VisitStatsModal.css';

export function VisitStatsModal({ isOpen, onClose, visitCount }) {
  const [visits, setVisits] = useState(visitCount);

  useEffect(() => {
    if (isOpen) {
      // Fetch latest visit count when modal opens
      fetch('/api/visits')
        .then(res => res.json())
        .then(data => setVisits(data.total_visits || 0))
        .catch(err => console.error('Failed to fetch visit count:', err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="visit-stats-overlay" onClick={onClose}>
      <div className="visit-stats-modal" onClick={e => e.stopPropagation()}>
        <div className="visit-stats-header">
          <h2>Visit Statistics</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="visit-stats-content">
          <div className="stat-box">
            <div className="stat-label">Total Page Visits</div>
            <div className="stat-value">{visits}</div>
          </div>

          <div className="stat-info">
            <p>Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>N</kbd> + <kbd>S</kbd> to view again</p>
            <p>Click outside or press <kbd>Esc</kbd> to close</p>
          </div>
        </div>
      </div>
    </div>
  );
}
