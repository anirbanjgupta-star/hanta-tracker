import Parser from 'rss-parser';

const parser = new Parser();

function extractLocationFromTitle(title) {
  const patterns = [
    /\bin\s+([A-Z][a-zA-Z\s]+?)(?:\s*[-–,]|$)/,
    /\bfrom\s+([A-Z][a-zA-Z\s]+?)(?:\s*[-–,]|$)/,
    /\b([A-Z][a-zA-Z\s]+?)\s+(?:outbreak|cases?|reports?)\b/i,
  ];
  for (const re of patterns) {
    const m = title.match(re);
    if (m && m[1] && m[1].trim().length > 1) return m[1].trim();
  }
  return 'Unknown';
}

function extractCaseCount(text) {
  const m = text.match(/(\d+)\s*(?:cases?|confirmed|reported)/i);
  return m ? parseInt(m[1], 10) : 0;
}

export async function run() {
  const feedUrl = process.env.PROMED_RSS_URL;
  if (!feedUrl) {
    console.warn('[promedScraper] PROMED_RSS_URL not set');
    return [];
  }

  try {
    const feed = await parser.parseURL(feedUrl);
    const results = [];

    for (const item of feed.items || []) {
      const titleLower = (item.title || '').toLowerCase();
      const contentLower = (item.contentSnippet || item.content || '').toLowerCase();
      if (!titleLower.includes('hanta') && !contentLower.includes('hanta')) continue;

      const raw_text = item.contentSnippet || item.content || item.summary || '';
      const location_name = extractLocationFromTitle(item.title || '');
      const total_cases = extractCaseCount(raw_text);

      if (location_name === 'Unknown' || total_cases === 0) {
        console.warn(`[promedScraper] Could not extract full data from: "${item.title}" — using defaults`);
      }

      results.push({
        location_name,
        total_cases,
        active_cases: 0,
        fatalities: 0,
        transmission_rodent: 0.8,
        transmission_person: 0.2,
        source: 'ProMED',
        url: item.link || null,
        published_at: item.pubDate || null,
        raw_text,
      });
    }

    return results;
  } catch (err) {
    console.error('[promedScraper] Error fetching ProMED RSS:', err.message);
    return [];
  }
}

export default { run };
