import { useState, useEffect, useCallback } from 'react';

export function useNews() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const fetchNews = useCallback(async (currentFilter) => {
    setLoading(true);
    try {
      let url = '/api/news';
      if (currentFilter === 'flagged') url += '?flagged=true';
      else if (currentFilter === 'verified') url += '?verified=true';
      console.log('[useNews] Fetching:', url);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`News fetch failed: ${res.status}`);
      const data = await res.json();
      console.log('[useNews] Received:', data.length, 'articles');
      setArticles(data);
    } catch (err) {
      console.error('[useNews] Error:', err.message);
      setArticles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews(filter);
  }, [filter]);

  return { articles, loading, setFilter, filter };
}
