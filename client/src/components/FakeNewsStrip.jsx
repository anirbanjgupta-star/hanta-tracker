import { useEffect, useRef, useState } from 'react';

export default function FakeNewsStrip({ flaggedCount = 0, onViewFlagged }) {
  const [visible, setVisible] = useState(false);
  const prevCount = useRef(0);

  useEffect(() => {
    if (flaggedCount > 0 && prevCount.current === 0) {
      setVisible(false);
      requestAnimationFrame(() => setVisible(true));
    } else if (flaggedCount > 0) {
      setVisible(true);
    } else {
      setVisible(false);
    }
    prevCount.current = flaggedCount;
  }, [flaggedCount]);

  if (!visible || flaggedCount === 0) return null;

  return (
    <>
      <style>{`
        .fakenews-strip {
          width: 100%;
          background: rgba(155, 93, 229, 0.12);
          border-left: 3px solid var(--accent-purple);
          padding: 8px 16px;
          display: flex;
          align-items: center;
          gap: 8px;
          animation: fade-in 0.3s ease;
          font-family: var(--font-display);
          font-size: 12px;
          color: var(--accent-purple);
          letter-spacing: 0.04em;
        }
        .fakenews-view {
          background: none;
          border: none;
          color: var(--accent-purple);
          font-family: var(--font-display);
          font-size: 12px;
          cursor: pointer;
          text-decoration: underline;
          padding: 0;
          letter-spacing: 0.04em;
        }
        .fakenews-view:hover { opacity: 0.8; }
      `}</style>
      <div className="fakenews-strip">
        <span>⚑ DISPUTED CLAIMS DETECTED · {flaggedCount} news item{flaggedCount !== 1 ? 's' : ''} flagged this cycle</span>
        <button className="fakenews-view" onClick={onViewFlagged}>
          [ VIEW FLAGGED ITEMS → ]
        </button>
      </div>
    </>
  );
}
