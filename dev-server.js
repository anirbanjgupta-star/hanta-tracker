import http from 'http';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import apiHandler from './api/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const server = http.createServer(async (req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // Call the API handler
    await apiHandler(req, res);
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
});

const PORT = 3456;
server.listen(PORT, () => {
  console.log(`✓ Development API server running on http://localhost:${PORT}`);
  console.log(`  Endpoints: /api/cases, /api/news, /api/meta, /api/guidelines, /api/alerts, /api/health`);
});
