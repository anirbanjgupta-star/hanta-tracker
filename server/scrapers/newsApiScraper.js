import Parser from 'rss-parser';
import crypto from 'crypto';

const parser = new Parser();
const GOOGLE_NEWS_RSS = 'https://news.google.com/rss/search?q=hantavirus&hl=en-US&gl=US&ceid=US:en';

function generateId(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

// Extract outlet name from Google News title format: "Headline text - Outlet Name"
function parseSourceName(title = '') {
  const m = title.match(/ - ([^-]+)$/);
  return m ? m[1].trim() : 'Unknown';
}

export async function fetchArticles() {
  try {
    const feed = await parser.parseURL(GOOGLE_NEWS_RSS);
    return (feed.items || [])
      .filter(item => item.link)
      .map(item => ({
        id: generateId(item.link),
        title: item.title?.replace(/ - [^-]+$/, '').trim() || '',
        summary: item.contentSnippet || item.content || '',
        source_name: parseSourceName(item.title || ''),
        source_url: item.link,
        published_at: item.pubDate || null,
        is_disputed: 0,
        is_unverified_claim: 0,
        dispute_reason: null,
      }));
  } catch (err) {
    console.error('[newsApiScraper] Error fetching Google News RSS:', err.message);
    return [];
  }
}

export default { fetchArticles };
