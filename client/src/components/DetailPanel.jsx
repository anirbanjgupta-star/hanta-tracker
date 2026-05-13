import { useState, useEffect } from 'react';
import AlertLevelBadge from './AlertLevelBadge';
import ConfidenceBadge from './ConfidenceBadge';
import ConflictWarningBanner from './ConflictWarningBanner';
import TransmissionBreakdownBar from './TransmissionBreakdownBar';
import TrendCharts from './TrendCharts';
import SourceCitationBlock from './SourceCitationBlock';
import LoadingSkeleton from './LoadingSkeleton';

function StatGrid({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {items.map(({ label, value }) => (
        <div key={label} style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '8px 10px',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--text-primary)', animation: 'count-up 0.4s ease' }}>
            {value != null ? value.toLocaleString() : '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

function GlobalOverview({ cases, onSelect }) {
  const knownCases = cases.filter(c => c.total_cases != null);
  const totalCases = knownCases.length ? knownCases.reduce((s, c) => s + c.total_cases, 0) : null;
  const knownActive = cases.filter(c => c.active_cases != null);
  const activeCases = knownActive.length ? knownActive.reduce((s, c) => s + c.active_cases, 0) : null;
  const knownFatal = cases.filter(c => c.fatalities != null);
  const fatalities = knownFatal.length ? knownFatal.reduce((s, c) => s + c.fatalities, 0) : null;
  const countries = new Set(cases.map(c => c.parent_id || c.location_id)).size;

  const top5 = [...cases]
    .sort((a, b) => (b.total_cases ?? -1) - (a.total_cases ?? -1))
    .slice(0, 5);

  const maxCases = top5[0]?.total_cases || 1;

  return (
    <>
      <style>{`
        .overview-header {
          font-family: var(--font-display);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          letter-spacing: 0.1em;
          padding: 14px 16px 10px;
        }
        .panel-divider { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
        .hotspot-label {
          font-family: var(--font-display);
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          padding: 0 16px;
          margin-bottom: 8px;
        }
        .hotspot-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 16px;
        }
        .hotspot-name {
          font-family: var(--font-body);
          font-size: 12px;
          color: var(--text-primary);
          width: 110px;
          flex-shrink: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .hotspot-track {
          flex: 1;
          height: 4px;
          background: var(--border);
          border-radius: 2px;
          overflow: hidden;
        }
        .hotspot-fill {
          height: 100%;
          background: var(--accent-red);
          border-radius: 2px;
        }
        .hotspot-badge { flex-shrink: 0; }
      `}</style>
      <div className="overview-header">GLOBAL OVERVIEW</div>
      <div style={{ padding: '0 16px' }}>
        <StatGrid items={[
          { label: 'Total Cases', value: totalCases },
          { label: 'Active Cases', value: activeCases },
          { label: 'Fatalities', value: fatalities },
          { label: 'Countries', value: countries || null },
        ]} />
      </div>
      <hr className="panel-divider" />
      <div className="hotspot-label">Top 5 Hotspots</div>
      {top5.map((c, i) => (
        <div className="hotspot-row" key={c.location_id || i} onClick={() => onSelect?.(c.location_id)} style={{ cursor: 'pointer' }}>
          <span className="hotspot-name">{c.location_name || '—'}</span>
          <div className="hotspot-track">
            <div className="hotspot-fill" style={{ width: `${Math.round((c.total_cases / maxCases) * 100)}%` }} />
          </div>
          <div className="hotspot-badge" style={{ width: 90 }}>
            <AlertLevelBadge level={c.alert_level} />
          </div>
        </div>
      ))}
    </>
  );
}

function LocationDetail({ locationId, onClear }) {
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!locationId) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/cases/${locationId}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/trend/${locationId}`).then(r => r.ok ? r.json() : null),
    ]).then(([caseData, trendData]) => {
      setData(caseData);
      setTrend(trendData);
    }).catch(() => {
      setData(null);
      setTrend(null);
    }).finally(() => setLoading(false));
  }, [locationId]);

  if (loading) return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LoadingSkeleton type="stat" />
      <LoadingSkeleton type="chart" />
      <LoadingSkeleton type="card" />
    </div>
  );

  if (!data) return (
    <div style={{ padding: 16, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-muted)' }}>
      No data available for this location.
    </div>
  );

  const cfr = (data.total_cases > 0 && data.fatalities != null)
    ? ((data.fatalities / data.total_cases) * 100).toFixed(1) + '%'
    : '—';

  const parts = [data.country, data.region].filter(Boolean);
  const breadcrumb = ['World', ...parts].join(' › ');

  return (
    <>
      <style>{`
        .detail-back {
          background: none;
          border: none;
          color: var(--accent-cyan);
          font-family: var(--font-display);
          font-size: 10px;
          cursor: pointer;
          padding: 10px 16px 0;
          display: block;
          letter-spacing: 0.05em;
        }
        .detail-back:hover { text-decoration: underline; }
        .detail-breadcrumb {
          font-family: var(--font-display);
          font-size: 10px;
          color: var(--text-muted);
          padding: 4px 16px 0;
          letter-spacing: 0.04em;
        }
        .detail-name {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
          padding: 6px 16px 10px;
          letter-spacing: 0.05em;
        }
        .detail-section { padding: 0 16px; margin-bottom: 12px; }
        .detail-section-label {
          font-family: var(--font-display);
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 6px;
        }
      `}</style>

      <button className="detail-back" onClick={onClear}>← Back to global</button>
      <div className="detail-breadcrumb">{breadcrumb}</div>
      <div className="detail-name">{data.location_name || '—'}</div>

      <div className="detail-section">
        <StatGrid items={[
          { label: 'Total Cases', value: data.total_cases },
          { label: 'Active Cases', value: data.active_cases },
          { label: 'Fatalities', value: data.fatalities },
          { label: 'CFR', value: cfr === '—' ? null : cfr },
        ]} />
      </div>

      <div className="detail-section">
        <ConflictWarningBanner show={!!data.conflict_flag} />
      </div>

      <div className="detail-section">
        <AlertLevelBadge level={data.alert_level} />
      </div>

      <div className="detail-section">
        <div className="detail-section-label">Transmission Routes</div>
        <TransmissionBreakdownBar
          rodent={data.transmission_rodent}
          person={data.transmission_person}
        />
      </div>

      {trend && trend.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-label">Case Trends</div>
          <TrendCharts
            sparklineData={trend.slice(-7).map(s => ({ date: s.date || s.snapshot_date, cases: s.total_cases || 0 }))}
            areaData={trend.slice(-30).map(s => ({ date: s.date || s.snapshot_date, cases: s.total_cases || 0 }))}
          />
        </div>
      )}

      <div className="detail-section">
        <SourceCitationBlock sources={data.source_urls || []} />
      </div>

      <div className="detail-section" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="detail-section-label" style={{ marginBottom: 0 }}>Confidence:</div>
        <ConfidenceBadge confidence={data.confidence} />
      </div>
    </>
  );
}

export default function DetailPanel({ selected, cases = [], onSelect }) {
  return (
    <>
      <style>{`
        .detail-panel {
          width: 320px;
          flex-shrink: 0;
          background: var(--bg-surface);
          border-left: 1px solid var(--border);
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          animation: fade-in 0.2s ease-out;
        }
        .detail-panel::-webkit-scrollbar { width: 4px; }
        .detail-panel::-webkit-scrollbar-track { background: var(--bg-base); }
        .detail-panel::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
      `}</style>
      <div className="detail-panel">
        {selected
          ? <LocationDetail locationId={selected.locationId} onClear={() => onSelect(null)} />
          : <GlobalOverview cases={cases} onSelect={onSelect} />
        }
      </div>
    </>
  );
}
