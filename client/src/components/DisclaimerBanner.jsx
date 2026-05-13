import { useState, useEffect, useRef } from 'react';

const DISMISS_KEY = 'disclaimer_dismissed_at';
const TTL = 7 * 24 * 60 * 60 * 1000;
const CONTACT = import.meta.env.VITE_CONTACT_EMAIL || 'contact@hantavirustracker.org';

export default function DisclaimerBanner() {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const bannerRef = useRef(null);

  useEffect(() => {
    const val = localStorage.getItem(DISMISS_KEY);
    if (!val || Date.now() - parseInt(val, 10) > TTL) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    setAnimating(true);
    setTimeout(() => {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
      setVisible(false);
      setAnimating(false);
    }, 300);
  }

  if (!visible) return null;

  return (
    <>
      <style>{`
        .disclaimer-wrap {
          width: 100%;
          background: var(--bg-surface);
          border-top: 3px solid var(--accent-amber);
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 20px;
          overflow: hidden;
        }
        .disclaimer-wrap.slide-up {
          animation: slide-up 0.3s ease forwards;
        }
        .disclaimer-icon {
          font-size: 20px;
          color: var(--accent-amber);
          flex-shrink: 0;
        }
        .disclaimer-text {
          flex: 1;
          font-family: var(--font-body);
          font-size: 13px;
          color: var(--text-primary);
          line-height: 1.5;
        }
        .disclaimer-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }
        .disclaimer-dismiss {
          background: none;
          border: 1px solid var(--accent-amber);
          color: var(--accent-amber);
          font-family: var(--font-display);
          font-size: 11px;
          padding: 4px 10px;
          border-radius: 3px;
          cursor: pointer;
          letter-spacing: 0.05em;
          white-space: nowrap;
        }
        .disclaimer-dismiss:hover { background: rgba(244,162,97,0.1); }
        .disclaimer-flag {
          font-family: var(--font-body);
          font-size: 12px;
          color: var(--accent-cyan);
          text-decoration: none;
          white-space: nowrap;
        }
        .disclaimer-flag:hover { text-decoration: underline; }
      `}</style>
      <div className={`disclaimer-wrap${animating ? ' slide-up' : ''}`} ref={bannerRef}>
        <span className="disclaimer-icon">⚠</span>
        <span className="disclaimer-text">
          This tracker aggregates publicly available disease surveillance data for informational
          purposes only. It is not a substitute for official public health guidance. Case counts
          may be incomplete, delayed, or subject to revision. Always consult WHO, CDC, or your
          local health authority for official information.
        </span>
        <div className="disclaimer-actions">
          <button className="disclaimer-dismiss" onClick={dismiss}>
            I UNDERSTAND — DISMISS
          </button>
          <a
            className="disclaimer-flag"
            href={`mailto:${CONTACT}?subject=Data%20Error%20Report`}
          >
            Spotted an error? Flag it →
          </a>
        </div>
      </div>
    </>
  );
}
