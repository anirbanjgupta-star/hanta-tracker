const heights = { stat: '60px', chart: '120px', card: '180px', map: '400px' };

export default function LoadingSkeleton({ type = 'stat' }) {
  return (
    <>
      <style>{`
        .skeleton {
          background: linear-gradient(90deg, var(--bg-surface) 25%, var(--border) 50%, var(--bg-surface) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s linear infinite;
          border-radius: 4px;
          width: 100%;
        }
      `}</style>
      <div className="skeleton" style={{ height: heights[type] || heights.stat }} />
    </>
  );
}
