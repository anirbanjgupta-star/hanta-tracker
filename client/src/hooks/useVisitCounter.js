import { useState, useEffect } from 'react';

export function useVisitCounter() {
  const [visitCount, setVisitCount] = useState(0);

  useEffect(() => {
    // Track visit on page load
    async function trackVisit() {
      try {
        const res = await fetch('/api/visits', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          setVisitCount(data.total_visits || 0);
        }
      } catch (err) {
        console.error('Failed to track visit:', err);
      }
    }

    trackVisit();
  }, []);

  return { visitCount };
}
