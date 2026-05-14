import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedNews = null;

export async function loadNews() {
  if (cachedNews) return cachedNews;

  try {
    // Try multiple possible paths
    const paths = [
      path.join(__dirname, '../data/news_articles.json'),
      path.join(process.cwd(), 'data/news_articles.json'),
      path.join(process.cwd(), 'hanta-tracker/data/news_articles.json'),
      '/var/task/data/news_articles.json',
      './data/news_articles.json',
    ];

    let data = null;
    for (const filePath of paths) {
      try {
        console.log(`[DEBUG] Trying to read news from ${filePath}`);
        const content = await readFile(filePath, 'utf-8');
        data = JSON.parse(content);
        console.log(`[DEBUG] Successfully loaded news from ${filePath}`);
        break;
      } catch (e) {
        console.log(`[DEBUG] Failed to read ${filePath}: ${e.message}`);
      }
    }

    if (data && data.articles) {
      cachedNews = data.articles.map(a => ({
        id: a.id || Math.random().toString(36).substr(2, 9),
        title: a.title,
        summary: a.summary || a.description || '',
        source: a.source_name || a.source || 'News',
        url: a.source_url || a.url || '',
        published_at: a.published_at,
        is_disputed: a.is_disputed || 0,
        is_unverified_claim: a.is_unverified_claim || 0,
      }));
      return cachedNews.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    }

    return [];
  } catch (err) {
    console.error('[ERROR] Failed to load news:', err);
    return [];
  }
}
