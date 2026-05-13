import { useState, useEffect, useCallback, useRef } from 'react';

export function useOutbreakData() {
  const [cases, setCases] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const sseRef = useRef(null);
  const reconnectTimer = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const [casesRes, metaRes] = await Promise.all([
        fetch('/api/cases'),
        fetch('/api/meta'),
      ]);
      if (!casesRes.ok) throw new Error(`Cases fetch failed: ${casesRes.status}`);
      if (!metaRes.ok) throw new Error(`Meta fetch failed: ${metaRes.status}`);
      const [casesData, metaData] = await Promise.all([
        casesRes.json(),
        metaRes.json(),
      ]);
      setCases(casesData);
      setMeta(metaData);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const connectSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
    }
    const es = new EventSource('/api/stream');
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'refresh') fetchData();
      } catch { /* ignore malformed frames */ }
    };

    es.onerror = () => {
      es.close();
      sseRef.current = null;
      reconnectTimer.current = setTimeout(() => {
        connectSSE();
      }, 5000);
    };
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    connectSSE();
    return () => {
      if (sseRef.current) sseRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [fetchData, connectSSE]);

  return { cases, meta, loading, error };
}
