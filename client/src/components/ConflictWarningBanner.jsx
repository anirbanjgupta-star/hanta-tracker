export default function ConflictWarningBanner({ show }) {
  if (!show) return null;
  return (
    <>
      <style>{`
        .conflict-banner {
          width: 100%;
          padding: 8px 12px;
          background: rgba(244, 162, 97, 0.15);
          border-left: 3px solid var(--accent-amber);
          font-family: var(--font-body);
          font-size: 12px;
          color: var(--accent-amber);
          border-radius: 0 4px 4px 0;
        }
      `}</style>
      <div className="conflict-banner">
        ⚠ Sources disagree on case count. Showing highest reported figure.
      </div>
    </>
  );
}
