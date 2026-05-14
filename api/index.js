import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { readCasesFromSheet, readNewsFromSheet } from './sheets-integration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

// In-memory cache (fallback for local development)
let dataCache = {
  cases: null,
  news: null,
  guidelines: null,
  meta: null,
  lastRefresh: 0
};

async function readDataFile(filename) {
  try {
    const filePath = path.join(dataDir, filename);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[ERROR] Failed to read ${filename}:`, err.message);
    return null;
  }
}

async function getCases() {
  const now = Date.now();

  // Return cached data if still valid
  if (dataCache.cases && now - dataCache.lastRefresh < CACHE_TTL) {
    return dataCache.cases;
  }

  // Try Google Sheets first
  try {
    console.log('[API] Fetching cases from Google Sheets...');
    const cases = await readCasesFromSheet();
    if (cases && cases.length > 0) {
      dataCache.cases = cases;
      dataCache.lastRefresh = now;
      console.log(`[API] ✓ Loaded ${cases.length} cases from Google Sheets`);
      return cases;
    }
  } catch (err) {
    console.error('[API] Error reading from Google Sheets, falling back to local files');
  }

  // Fall back to local files
  const data = await readDataFile('cases.json');
  if (data && data.cases) {
    dataCache.cases = data.cases;
    dataCache.lastRefresh = now;
    console.log(`[API] ✓ Loaded ${data.cases.length} cases from local files`);
    return data.cases;
  }

  return [];
}

async function getNews() {
  const now = Date.now();

  // Return cached data if still valid
  if (dataCache.news && now - dataCache.lastRefresh < CACHE_TTL) {
    return dataCache.news;
  }

  // Try Google Sheets first
  try {
    console.log('[API] Fetching news from Google Sheets...');
    const articles = await readNewsFromSheet();
    if (articles && articles.length > 0) {
      // Transform to match API format
      const transformed = articles.map(a => ({
        id: a.id,
        title: a.title,
        summary: a.summary,
        source: a.source_name,
        url: a.source_url,
        published_at: a.published_at,
        is_disputed: a.is_disputed || 0,
        is_unverified_claim: a.is_unverified_claim || 0,
      }));
      const sorted = transformed.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
      dataCache.news = sorted;
      dataCache.lastRefresh = now;
      console.log(`[API] ✓ Loaded ${articles.length} articles from Google Sheets`);
      return sorted;
    }
  } catch (err) {
    console.error('[API] Error reading from Google Sheets, falling back to local files');
  }

  // Fall back to local files
  const data = await readDataFile('news_articles.json');
  if (data && Array.isArray(data.articles)) {
    const transformed = data.articles.map(a => ({
      id: a.id || Math.random().toString(36).substr(2, 9),
      title: a.title,
      summary: a.summary || a.description || '',
      source: a.source_name || a.source || 'News',
      url: a.source_url || a.url || '',
      published_at: a.published_at,
      is_disputed: a.is_disputed || 0,
      is_unverified_claim: a.is_unverified_claim || 0,
    }));
    const sorted = transformed.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    dataCache.news = sorted;
    dataCache.lastRefresh = now;
    console.log(`[API] ✓ Loaded ${data.articles.length} articles from local files`);
    return sorted;
  }

  return [];
}

async function getGuidelines() {
  const data = await readDataFile('guidelines.json');
  return data;
}

async function getMeta() {
  const data = await readDataFile('meta.json');
  return data || {
    last_updated: new Date().toISOString(),
    source_status: {},
    stale: false,
    flagged_count: 0
  };
}

export default async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=60');

  const url = new URL(req.url, 'http://' + req.headers.host);
  const pathname = url.pathname;

  try {
    // Route: /api/cases
    if ((pathname === '/api/cases' || pathname === '/cases') && req.method === 'GET') {
      const cases = await getCases();
      return res.status(200).end(JSON.stringify(cases));
    }

    // Route: /api/news
    if ((pathname === '/api/news' || pathname === '/news') && req.method === 'GET') {
      const news = await getNews();
      return res.status(200).end(JSON.stringify(news));
    }

    // Route: /api/meta
    if ((pathname === '/api/meta' || pathname === '/meta') && req.method === 'GET') {
      const meta = await getMeta();
      return res.status(200).end(JSON.stringify(meta || {}));
    }

    // Route: /api/guidelines
    if ((pathname === '/api/guidelines' || pathname === '/guidelines') && req.method === 'GET') {
      const guidelines = await getGuidelines();
      return res.status(200).end(JSON.stringify(guidelines || {}));
    }

    // Route: /api/alerts
    if ((pathname === '/api/alerts' || pathname === '/alerts') && req.method === 'GET') {
      const cases = await getCases();
      const alerts = cases.filter(c => c.confidence === 'low' || c.conflict_flag === 1 || c.alert_level === 'WARNING' || c.alert_level === 'CRITICAL');
      return res.status(200).end(JSON.stringify(alerts));
    }

    // Route: /api/health
    if ((pathname === '/api/health' || pathname === '/health') && req.method === 'GET') {
      return res.status(200).end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
    }

    // Route: /api/cases/:locationId
    const casesMatch = pathname.match(/^\/(?:api\/)?cases\/([a-zA-Z0-9-]+)$/i);
    if (casesMatch && req.method === 'GET') {
      const locationId = casesMatch[1].toUpperCase();
      const allCases = await getCases();
      const found = allCases.find(c => c.location_id === locationId);
      if (!found) {
        return res.status(404).end(JSON.stringify({ error: 'Not found' }));
      }
      const children = allCases.filter(c => c.parent_id === locationId);
      return res.status(200).end(JSON.stringify({ ...found, children }));
    }

    // Route: /api/trend/:locationId
    const trendMatch = pathname.match(/^\/(?:api\/)?trend\/([a-zA-Z0-9-]+)$/i);
    if (trendMatch && req.method === 'GET') {
      const locationId = trendMatch[1].toUpperCase();
      try {
        const snapshots = await readDataFile('daily_snapshots.json');
        if (snapshots && snapshots[locationId]) {
          return res.status(200).end(JSON.stringify(snapshots[locationId]));
        }
      } catch (err) {
        console.error(`Error reading snapshots:`, err);
      }
      return res.status(200).end(JSON.stringify([]));
    }

    // 404
    res.status(404).end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    console.error('API error:', err);
    res.status(500).end(JSON.stringify({ error: 'Internal server error' }));
  }
};
