import Parser from 'rss-parser';
import axios from 'axios';
import * as cheerio from 'cheerio';

const parser = new Parser();

// Extract a country/region name from article title
function extractLocation(title) {
  const patterns = [
    // "... in Tenerife ...", "... in Argentina ..."
    /\bin\s+(?:the\s+)?([A-Z][a-zA-Z\s\-]+?)(?:\s*[-–,]|\s+regarding|\s+following|$)/,
    // "... of Tenerife ...", "... of Chile ..."
    /\bof\s+([A-Z][a-zA-Z\s\-]+?)(?:\s*[-–,]|\s+regarding|$)/,
    // "Argentina reports ...", "Chile confirms ..."
    /^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:reports?|confirms?|records?|outbreak)/i,
    // "Outbreak in X"
    /[Oo]utbreak\s+in\s+([A-Z][a-zA-Z\s\-]+?)(?:\s*[-–,]|$)/,
    // "people of X"
    /\bpeople\s+of\s+([A-Z][a-zA-Z\s\-]+?)(?:\s*[-–,]|$)/,
  ];
  for (const re of patterns) {
    const m = title.match(re);
    if (m && m[1] && m[1].trim().length > 1) return m[1].trim();
  }
  return null;
}

// Fetch the full article page and extract case counts
async function fetchArticleDetails(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'HantaTracker/1.0 (anirban.j.gupta@gmail.com)' },
    });
    const $ = cheerio.load(data);
    const text = $('body').text();

    // Look for explicit case counts: "X cases", "X confirmed", "X people"
    const caseMatch = text.match(/(\d[\d,]*)\s*(?:confirmed\s+)?(?:cases?|people\s+(?:infected|affected))/i);
    const fatalMatch = text.match(/(\d[\d,]*)\s*(?:deaths?|fatalities|fatal\s+cases?)/i);

    return {
      total_cases: caseMatch ? parseInt(caseMatch[1].replace(/,/g, ''), 10) : null,
      fatalities: fatalMatch ? parseInt(fatalMatch[1].replace(/,/g, ''), 10) : null,
    };
  } catch {
    return { total_cases: null, fatalities: null };
  }
}

export async function run() {
  const feedUrl = process.env.WHO_RSS_URL;
  if (!feedUrl) { console.warn('[whoScraper] WHO_RSS_URL not set'); return []; }

  try {
    const feed = await parser.parseURL(feedUrl);
    const results = [];

    for (const item of feed.items || []) {
      const title = item.title || '';
      const content = item.contentSnippet || item.content || item.summary || '';
      const combined = `${title} ${content}`.toLowerCase();

      if (!combined.includes('hanta')) continue;
      if (!item.link) continue;  // no URL = no record

      const location_name = extractLocation(title);
      if (!location_name) {
        console.warn(`[whoScraper] Could not extract location from: "${title}" — skipping`);
        continue;
      }

      // Try to get case numbers from RSS snippet first, then from full article
      let total_cases = null;
      let fatalities = null;
      const snippetCaseMatch = content.match(/(\d[\d,]*)\s*(?:confirmed\s+)?cases?/i);
      const snippetFatalMatch = content.match(/(\d[\d,]*)\s*(?:deaths?|fatalities)/i);
      if (snippetCaseMatch) total_cases = parseInt(snippetCaseMatch[1].replace(/,/g, ''), 10);
      if (snippetFatalMatch) fatalities = parseInt(snippetFatalMatch[1].replace(/,/g, ''), 10);

      if (total_cases === null) {
        // Fetch full article to find numbers
        const details = await fetchArticleDetails(item.link);
        total_cases = details.total_cases;
        fatalities = details.fatalities;
      }

      // Still no case number — include with null so UI shows NO DATA, not 0
      results.push({
        location_name,
        total_cases,
        active_cases: 0,
        fatalities,
        transmission_rodent: 0.85,
        transmission_person: 0.15,
        source: 'WHO',
        url: item.link,
        published_at: item.pubDate || null,
        raw_text: content.slice(0, 500),
      });

      console.log(`[whoScraper] Found: ${location_name} — ${total_cases ?? 'NO_COUNT'} cases (${item.link})`);
    }

    return results;
  } catch (err) {
    console.error('[whoScraper] Error fetching WHO RSS:', err.message);
    return [];
  }
}

export default { run };
