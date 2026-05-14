import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, writeFile, stat } from 'fs/promises';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env.local') });

(async () => {
const { readCasesFromSheet, readNewsFromSheet } = await import('./api/sheets-integration.js');
const { startScheduler } = await import('./refresh-scheduler.js');

const dataDir = path.join(__dirname, 'data');

// In-memory cache
let dataCache = {
  cases: null,
  news: null,
  lastRefresh: 0,
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const VISITS_FILE = path.join(dataDir, 'visits.json');

async function readDataFile(filename) {
  try {
    const content = await readFile(path.join(dataDir, filename), 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error reading ${filename}:`, err.message);
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

async function incrementVisitCount() {
  try {
    const current = await readDataFile('visits.json') || { total_visits: 0 };
    const updated = {
      total_visits: (current.total_visits || 0) + 1,
      last_visit: new Date().toISOString()
    };
    await writeFile(VISITS_FILE, JSON.stringify(updated, null, 2));
    return updated;
  } catch (err) {
    console.error('Error tracking visit:', err.message);
    return null;
  }
}

async function getVisitCount() {
  const data = await readDataFile('visits.json');
  return data || { total_visits: 0, last_visit: null };
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // /api/visits (track and get visit count)
    if ((pathname === '/api/visits' || pathname === '/visits') && req.method === 'POST') {
      const visits = await incrementVisitCount();
      return res.end(JSON.stringify(visits || { error: 'Failed to track visit' }));
    }

    // /api/visits (get visit count)
    if ((pathname === '/api/visits' || pathname === '/visits') && req.method === 'GET') {
      const visits = await getVisitCount();
      return res.end(JSON.stringify(visits));
    }

    // /api/cases
    if ((pathname === '/api/cases' || pathname === '/cases') && req.method === 'GET') {
      const cases = await getCases();
      return res.end(JSON.stringify(cases));
    }

    // /api/news
    if ((pathname === '/api/news' || pathname === '/news') && req.method === 'GET') {
      const news = await getNews();
      return res.end(JSON.stringify(news));
    }

    // /api/meta
    if ((pathname === '/api/meta' || pathname === '/meta') && req.method === 'GET') {
      const data = await readDataFile('meta.json');
      return res.end(JSON.stringify(data || {}));
    }

    // /api/guidelines
    if ((pathname === '/api/guidelines' || pathname === '/guidelines') && req.method === 'GET') {
      const data = await readDataFile('guidelines.json');
      return res.end(JSON.stringify(data || {}));
    }

    // /api/health
    if ((pathname === '/api/health' || pathname === '/health') && req.method === 'GET') {
      return res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
    }

    // /api/refresh
    if ((pathname === '/api/refresh' || pathname === '/refresh') && req.method === 'GET') {
      console.log('[API] Refresh endpoint called at', new Date().toISOString());
      // Trigger data refresh from Google Sheets
      try {
        const { fetchAllData } = await import('./scrapers.js');
        const { writeCasesToSheet, writeNewsToSheet } = await import('./api/sheets-integration.js');

        const allData = await fetchAllData();
        await writeCasesToSheet(allData.cases);
        await writeNewsToSheet(allData.articles);

        // Clear cache to force reload on next request
        dataCache.cases = null;
        dataCache.news = null;
        dataCache.lastRefresh = 0;

        console.log('[API] ✓ Data refresh completed successfully');
        return res.end(JSON.stringify({ ok: true, refreshed: true, time: new Date().toISOString() }));
      } catch (err) {
        console.error('[API] Error during refresh:', err.message);
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }

    // /api/cases/:locationId
    const casesMatch = pathname.match(/^\/(?:api\/)?cases\/([a-zA-Z0-9-]+)$/i);
    if (casesMatch && req.method === 'GET') {
      const locationId = casesMatch[1].toUpperCase();
      const allCases = await readDataFile('cases.json');
      if (allCases && allCases.cases) {
        const found = allCases.cases.find(c => c.location_id === locationId);
        if (!found) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Not found' }));
        }
        const children = allCases.cases.filter(c => c.parent_id === locationId);
        return res.end(JSON.stringify({ ...found, children }));
      }
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Not found' }));
    }

    // /api/trend/:locationId
    const trendMatch = pathname.match(/^\/(?:api\/)?trend\/([a-zA-Z0-9-]+)$/i);
    if (trendMatch && req.method === 'GET') {
      const locationId = trendMatch[1].toUpperCase();
      const snapshots = await readDataFile('daily_snapshots.json');
      if (snapshots && Array.isArray(snapshots)) {
        const filtered = snapshots.filter(s => s.location_id === locationId);
        return res.end(JSON.stringify(filtered.length > 0 ? filtered : []));
      }
      return res.end(JSON.stringify([]));
    }

    // Serve static files or index.html for SPA routing
    const distPath = path.join(__dirname, 'client/dist');
    let filePath = path.join(distPath, pathname === '/' ? 'index.html' : pathname);

    try {
      const stats = await stat(filePath);
      if (stats.isFile()) {
        const content = await readFile(filePath, 'utf-8');
        if (filePath.endsWith('.html')) {
          res.setHeader('Content-Type', 'text/html');
        } else if (filePath.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css');
        } else if (filePath.endsWith('.json')) {
          res.setHeader('Content-Type', 'application/json');
        }
        return res.end(content);
      }
    } catch (err) {
      // File not found, serve index.html for client-side routing
    }

    // Serve index.html for SPA routing
    try {
      const indexPath = path.join(distPath, 'index.html');
      const content = await readFile(indexPath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      return res.end(content);
    } catch (err) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

const PORT = 3456;
server.listen(PORT, () => {
  console.log(`✓ API server running on http://localhost:${PORT}`);
  console.log(`  Try: curl http://localhost:${PORT}/api/health`);

  // Start the data refresh scheduler
  startScheduler();
});
})();
