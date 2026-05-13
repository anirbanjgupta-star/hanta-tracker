import cron from 'node-cron';
import { runAggregator } from './aggregator.js';
import { run as runGuidelines } from './scrapers/guidelinesScraper.js';
import { fetchArticles } from './scrapers/newsApiScraper.js';
import { checkArticle } from './factChecker.js';
import storage from './storage.js';

const sseClients = new Set();

export function initCron() {
  runAggregator();
  runGuidelines();
  fetchAndStoreNews();

  cron.schedule('*/5 * * * *', async () => {
    await runAggregator();
    await fetchAndStoreNews();
    broadcastRefresh();
  });

  cron.schedule('0 0 * * *', () => runGuidelines());
}

async function fetchAndStoreNews() {
  const meta = await storage.readMeta();
  const last = meta.last_news_api_call ? new Date(meta.last_news_api_call) : null;
  if (last && Date.now() - last.getTime() < 30 * 60 * 1000) return;

  const articles = await fetchArticles();
  let flaggedCount = 0;
  for (const article of articles) {
    const { is_disputed, dispute_reason } = checkArticle(article);
    if (is_disputed) flaggedCount++;
    await storage.upsertNewsArticle({ ...article, is_disputed, dispute_reason, fetched_at: new Date().toISOString() });
  }
  meta.last_news_api_call = new Date().toISOString();
  meta.flagged_count = flaggedCount;
  await storage.writeMeta(meta);
}

export function addSSEClient(res) {
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

function broadcastRefresh() {
  for (const res of sseClients) {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`);
  }
}

export default { initCron, addSSEClient };
