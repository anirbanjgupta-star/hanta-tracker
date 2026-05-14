import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  // Load news data
  const newsJson = readFileSync(join(__dirname, 'data/news_articles.json'), 'utf-8');
  const newsData = JSON.parse(newsJson);

  // Transform articles
  const articles = newsData.articles.map(a => ({
    id: a.id || Math.random().toString(36).substr(2, 9),
    title: a.title,
    summary: a.summary || a.description || '',
    source: a.source_name || a.source || 'News',
    url: a.source_url || a.url || '',
    published_at: a.published_at,
    is_disputed: a.is_disputed || 0,
    is_unverified_claim: a.is_unverified_claim || 0,
  })).sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

  // Generate JavaScript module
  const jsContent = `// Auto-generated from data/news_articles.json
export const newsArticles = ${JSON.stringify(articles, null, 2)};
`;

  writeFileSync(join(__dirname, 'api/news-data.js'), jsContent);
  console.log(`✓ Generated api/news-data.js with ${articles.length} articles`);
} catch (err) {
  console.error('Build error:', err.message);
  process.exit(1);
}
