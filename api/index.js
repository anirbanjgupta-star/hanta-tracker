import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../data');

// Cache for data to avoid re-fetching on every request
let casesCache = null;
let newsCache = null;
let guidelinesCache = null;
let metaCache = null;
let lastCasesRefresh = 0;
let lastNewsRefresh = 0;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function readDataFile(filename) {
  try {
    const filePath = path.join(dataDir, filename);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Failed to read ${filename}:`, err);
    return null;
  }
}

async function getCases() {
  const now = Date.now();
  if (casesCache && now - lastCasesRefresh < CACHE_TTL) {
    return casesCache;
  }

  const data = await readDataFile('cases.json');
  if (data && data.cases) {
    casesCache = data.cases;
    lastCasesRefresh = now;
    return casesCache;
  }
  return [];
}

async function getNews() {
  const now = Date.now();
  if (newsCache && now - lastNewsRefresh < CACHE_TTL) {
    return newsCache;
  }

  const data = await readDataFile('news_articles.json');
  if (data && Array.isArray(data)) {
    const transformed = data.map(a => ({
      id: a.id || Math.random().toString(36).substr(2, 9),
      title: a.title,
      summary: a.summary || a.description || '',
      source: a.source_name || a.source || 'News',
      url: a.source_url || a.url || '',
      published_at: a.published_at,
      is_disputed: a.is_disputed || 0,
      is_unverified_claim: a.is_unverified_claim || 0,
    }));
    newsCache = transformed.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    lastNewsRefresh = now;
    return newsCache;
  }
  return [];
}

async function getGuidelines() {
  const data = await readDataFile('guidelines.json');
  guidelinesCache = data;
  return data;
}

async function getMeta() {
  const data = await readDataFile('meta.json');
  metaCache = data;
  return data;
}

export default async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(req.url, 'http://' + req.headers.host);
  const pathname = url.pathname;

  try {
    // Route: /api/cases
    if (pathname === '/api/cases' && req.method === 'GET') {
      const cases = await getCases();
      return res.status(200).end(JSON.stringify(cases));
    }

    // Route: /api/news
    if (pathname === '/api/news' && req.method === 'GET') {
      const news = await getNews();
      return res.status(200).end(JSON.stringify(news));
    }

    // Route: /api/meta
    if (pathname === '/api/meta' && req.method === 'GET') {
      const meta = await getMeta();
      return res.status(200).end(JSON.stringify(meta || { last_updated: new Date().toISOString(), source_status: {}, stale: false, flagged_count: 0 }));
    }

    // Route: /api/guidelines
    if (pathname === '/api/guidelines' && req.method === 'GET') {
      const guidelines = await getGuidelines();
      return res.status(200).end(JSON.stringify(guidelines || {}));
    }

    // Route: /api/alerts
    if (pathname === '/api/alerts' && req.method === 'GET') {
      const cases = await getCases();
      const alerts = cases.filter(c => c.confidence === 'low' || c.conflict_flag === 1 || c.alert_level === 'WARNING' || c.alert_level === 'CRITICAL');
      return res.status(200).end(JSON.stringify(alerts));
    }

    // Route: /api/health
    if (pathname === '/api/health' && req.method === 'GET') {
      return res.status(200).end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
    }

    // Route: /api/stream
    if (pathname === '/api/stream' && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
      return setTimeout(() => res.end(), 100);
    }

    // Route: /api/cases/:locationId
    const casesMatch = pathname.match(/^\/api\/cases\/([a-z0-9-]+)$/);
    if (casesMatch && req.method === 'GET') {
      const locationId = casesMatch[1];
      const allCases = await getCases();
      const found = allCases.find(c => c.location_id === locationId);
      if (!found) {
        return res.status(404).end(JSON.stringify({ error: 'Not found' }));
      }
      const children = allCases.filter(c => c.parent_id === locationId);
      return res.status(200).end(JSON.stringify({ ...found, children }));
    }

    // Route: /api/trend/:locationId
    const trendMatch = pathname.match(/^\/api\/trend\/([a-z0-9-]+)$/);
    if (trendMatch && req.method === 'GET') {
      const locationId = trendMatch[1];
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
