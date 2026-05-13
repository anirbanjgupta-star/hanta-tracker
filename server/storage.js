import fs from 'fs/promises';
import path from 'path';

const storagePath = process.env.STORAGE_PATH || './data';

function filePath(filename) {
  return path.resolve(process.cwd(), storagePath, filename);
}

// Per-file write locks: boolean flag + pending queue
const locks = {};
const queues = {};

async function readJSON(filename) {
  try {
    const raw = await fs.readFile(filePath(filename), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJSON(filename, data) {
  return new Promise((resolve, reject) => {
    const doWrite = async () => {
      locks[filename] = true;
      try {
        const fp = filePath(filename);
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.writeFile(fp, JSON.stringify(data, null, 2), 'utf8');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        locks[filename] = false;
        const next = queues[filename]?.shift();
        if (next) next();
      }
    };

    if (locks[filename]) {
      if (!queues[filename]) queues[filename] = [];
      queues[filename].push(doWrite);
    } else {
      doWrite();
    }
  });
}

// ── Cases ────────────────────────────────────────────────────────────────────

export async function readCases() {
  const data = await readJSON('cases.json');
  return data || { cases: [], updated_at: '' };
}

export async function writeCases(data) {
  await writeJSON('cases.json', data);
}

export async function upsertCase(record) {
  const data = await readCases();
  const idx = data.cases.findIndex(c => c.location_id === record.location_id);
  if (idx >= 0) {
    data.cases[idx] = { ...data.cases[idx], ...record };
  } else {
    data.cases.push(record);
  }
  data.updated_at = new Date().toISOString();
  await writeCases(data);
}

export async function getAllCases() {
  const data = await readCases();
  return data.cases || [];
}

export async function getCaseByLocationId(id) {
  const cases = await getAllCases();
  return cases.find(c => c.location_id === id) || null;
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

export async function readSnapshots() {
  const data = await readJSON('daily_snapshots.json');
  return data || { snapshots: {}, updated_at: '' };
}

export async function writeSnapshots(data) {
  await writeJSON('daily_snapshots.json', data);
}

export async function upsertSnapshot(locationId, snapshotObj) {
  const data = await readSnapshots();
  if (!data.snapshots[locationId]) data.snapshots[locationId] = [];
  const today = new Date().toISOString().split('T')[0];
  const idx = data.snapshots[locationId].findIndex(s => s.date === today);
  if (idx >= 0) {
    data.snapshots[locationId][idx] = { date: today, ...snapshotObj };
  } else {
    data.snapshots[locationId].push({ date: today, ...snapshotObj });
  }
  data.updated_at = new Date().toISOString();
  await writeSnapshots(data);
}

export async function getSnapshotsByLocationId(id) {
  const data = await readSnapshots();
  return data.snapshots[id] || [];
}

// ── News Articles ─────────────────────────────────────────────────────────────

export async function readNewsArticles() {
  const data = await readJSON('news_articles.json');
  return data || { articles: [], updated_at: '' };
}

export async function writeNewsArticles(data) {
  await writeJSON('news_articles.json', data);
}

export async function upsertNewsArticle(article) {
  const data = await readNewsArticles();
  const idx = data.articles.findIndex(a => a.source_url === article.source_url);
  if (idx >= 0) {
    data.articles[idx] = { ...data.articles[idx], ...article };
  } else {
    data.articles.push(article);
  }
  data.updated_at = new Date().toISOString();
  await writeNewsArticles(data);
}

export async function getAllNewsArticles() {
  const data = await readNewsArticles();
  return data.articles || [];
}

// ── Guidelines ────────────────────────────────────────────────────────────────

export async function readGuidelines() {
  const data = await readJSON('guidelines.json');
  return data || { guidelines: {} };
}

export async function writeGuidelines(data) {
  await writeJSON('guidelines.json', data);
}

// ── Meta ──────────────────────────────────────────────────────────────────────

export async function readMeta() {
  const data = await readJSON('meta.json');
  return data || {
    last_updated: '',
    source_status: { who: false, promed: false, healthmap: false, cdc: false, newsapi: false },
    stale: true,
    flagged_count: 0,
    last_news_api_call: null
  };
}

export async function writeMeta(data) {
  await writeJSON('meta.json', data);
}

export default {
  readCases,
  writeCases,
  upsertCase,
  getAllCases,
  getCaseByLocationId,
  readSnapshots,
  writeSnapshots,
  upsertSnapshot,
  getSnapshotsByLocationId,
  readNewsArticles,
  writeNewsArticles,
  upsertNewsArticle,
  getAllNewsArticles,
  readGuidelines,
  writeGuidelines,
  readMeta,
  writeMeta,
};
