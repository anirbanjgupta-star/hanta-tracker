import { useState, useEffect } from 'react';

export function useGuidelines() {
  const [guidelines, setGuidelines] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/guidelines')
      .then((res) => {
        if (!res.ok) throw new Error(`Guidelines fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setGuidelines(data.guidelines || data);
      })
      .catch(() => {
        setGuidelines(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return { guidelines, loading };
}
