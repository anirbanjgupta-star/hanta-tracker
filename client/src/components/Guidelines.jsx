import { format } from 'date-fns';

const SECTION_KEYS = ['PREVENTION', 'SYMPTOMS', 'QUARANTINE', 'WHEN_TO_SEEK_CARE'];

function fmtDate(str) {
  if (!str) return '—';
  try { return format(new Date(str), 'dd MMM yyyy'); } catch { return str; }
}

function OrgGuidelines({ orgName, data }) {
  if (!data) return (
    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>
      No guidelines available.
    </div>
  );

  return (
    <>
      <style>{`
        .guide-org-header {
          font-family: var(--font-display);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          letter-spacing: 0.08em;
          padding: 12px 0 10px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 12px;
        }
        .guide-section { margin-bottom: 16px; }
        .guide-section-title {
          font-family: var(--font-display);
          font-size: 12px;
          color: var(--accent-cyan);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 6px;
        }
        .guide-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding-left: 8px;
        }
        .guide-item {
          font-family: var(--font-body);
          font-size: 13px;
          color: var(--text-primary);
          line-height: 1.5;
          display: flex;
          align-items: flex-start;
          gap: 6px;
        }
        .guide-item::before {
          content: '·';
          color: var(--accent-cyan);
          flex-shrink: 0;
          margin-top: 1px;
        }
        .guide-footer {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-top: 8px;
          border-top: 1px solid var(--border);
          margin-top: 4px;
        }
        .guide-src-link {
          font-family: var(--font-body);
          font-size: 12px;
          color: var(--accent-cyan);
          text-decoration: none;
        }
        .guide-src-link:hover { text-decoration: underline; }
        .guide-src-date {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
        }
      `}</style>
      <div className="guide-org-header">{orgName}</div>
      {SECTION_KEYS.map(key => {
        const section = data[key];
        if (!section) return null;
        const items = Array.isArray(section.items) ? section.items : (Array.isArray(section) ? section : []);
        const label = (section.label || key).replace(/_/g, ' ');
        return (
          <div className="guide-section" key={key}>
            <div className="guide-section-title">{label}</div>
            <ul className="guide-list">
              {items.map((item, i) => (
                <li className="guide-item" key={i}>{item}</li>
              ))}
            </ul>
          </div>
        );
      })}
      <div className="guide-footer">
        {data.source_url && (
          <a className="guide-src-link" href={data.source_url} target="_blank" rel="noopener noreferrer">
            Source: {orgName} ↗
          </a>
        )}
        {data.last_updated && (
          <span className="guide-src-date">Updated: {fmtDate(data.last_updated)}</span>
        )}
      </div>
    </>
  );
}

export default function Guidelines({ guidelines }) {
  if (!guidelines) return (
    <div style={{ padding: 16, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-muted)' }}>
      Guidelines not available.
    </div>
  );

  return (
    <>
      <style>{`
        .guidelines-wrap {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          padding: 0 16px 16px;
        }
        .guidelines-col {
          padding: 0 16px;
          border-right: 1px solid var(--border);
        }
        .guidelines-col:last-child { border-right: none; }
      `}</style>
      <div className="guidelines-wrap">
        <div className="guidelines-col">
          <OrgGuidelines orgName="WHO" data={guidelines.WHO} />
        </div>
        <div className="guidelines-col">
          <OrgGuidelines orgName="CDC" data={guidelines.CDC} />
        </div>
      </div>
    </>
  );
}
