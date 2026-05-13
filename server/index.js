import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import storage from './storage.js';
import { initCron, addSSEClient } from './cron.js';

const app = express();
const PORT = process.env.PORT || 3456;

app.use(cors({
  origin: [
    'http://localhost:5173',
    /\.vercel\.app$/
  ]
}));
app.use(express.json());

// Routes
app.get('/api/cases', async (req, res) => {
  res.json(await storage.getAllCases());
});

app.get('/api/cases/:locationId', async (req, res) => {
  const c = await storage.getCaseByLocationId(req.params.locationId);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const all = await storage.getAllCases();
  const children = all.filter(x => x.parent_id === req.params.locationId);
  res.json({ ...c, children });
});

app.get('/api/trend/:locationId', async (req, res) => {
  res.json(await storage.getSnapshotsByLocationId(req.params.locationId));
});

app.get('/api/meta', async (req, res) => {
  res.json(await storage.readMeta());
});

app.get('/api/news', async (req, res) => {
  let articles = await storage.getAllNewsArticles();
  articles.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  if (req.query.flagged === 'true') articles = articles.filter(a => a.is_disputed === 1);
  if (req.query.verified === 'true') articles = articles.filter(a => a.is_disputed === 0);
  const transformed = articles.map(a => ({
    ...a,
    url: a.source_url,
    source: a.source_name,
    headline: a.title
  }));
  res.json(transformed);
});

app.get('/api/guidelines', async (req, res) => {
  res.json(await storage.readGuidelines());
});

app.get('/api/alerts', async (req, res) => {
  const all = await storage.getAllCases();
  res.json(all.filter(c => c.confidence === 'low' || c.conflict_flag === 1));
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  addSSEClient(res);
});

app.listen(PORT, () => {
  console.log(`[server] running on port ${PORT}`);
  initCron();
});
