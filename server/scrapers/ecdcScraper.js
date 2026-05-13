import axios from 'axios';
import * as cheerio from 'cheerio';

const ECDC_HANTA_URL = 'https://www.ecdc.europa.eu/en/hantavirus-infection';
const ECDC_BASE = 'https://www.ecdc.europa.eu';
const HEADERS = { 'User-Agent': 'HantaTracker/1.0 (anirban.j.gupta@gmail.com)' };
const OUTBREAK_CUTOFF = new Date('2026-05-01T00:00:00Z');

const WORD_NUMS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function toNum(s) {
  return WORD_NUMS[s?.toLowerCase()] ?? (s ? parseInt(s.replace(/,/g, ''), 10) : null);
}

// Parse "As of <date>, N people..." from the ECDC main hantavirus page.
// Returns a Tenerife record (the MV Hondius response hub) or empty.
async function fetchOutbreakSummary() {
  const { data } = await axios.get(ECDC_HANTA_URL, { timeout: 15000, headers: HEADERS });
  const $ = cheerio.load(data);
  const text = $('body').text().replace(/\s+/g, ' ');

  const caseMatch = text.match(/As of (\d+\s+\w+(?:\s+\d{4})?),?\s+(\w+|\d+)\s+people\s+have\s+developed\s+symptoms/i);
  const deathMatch = text.match(/(\w+|\d+)\s+have\s+died/i);

  const total_cases = caseMatch ? toNum(caseMatch[2]) : null;
  const fatalities = deathMatch ? toNum(deathMatch[1]) : null;
  if (!total_cases) return { summary: [], articleLinks: [] };

  console.log(`[ecdcScraper] Outbreak summary: ${total_cases} cases, ${fatalities ?? '?'} deaths`);

  // Also collect all outbreak-related article links from the page to scrape individually
  const articleLinks = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const full = href.startsWith('http') ? href : ECDC_BASE + href;
    if (full.includes('ecdc.europa.eu/en/') && !articleLinks.includes(full)) {
      articleLinks.push(full);
    }
  });

  const summary = [{
    location_name: 'Tenerife',
    total_cases,
    active_cases: total_cases - (fatalities ?? 0),
    fatalities,
    transmission_rodent: 0.0,
    transmission_person: 1.0,
    source: 'ECDC',
    url: ECDC_HANTA_URL,
    published_at: new Date('2026-05-07T00:00:00Z').toISOString(),
    raw_text: caseMatch?.[0] || `${total_cases} cases on MV Hondius`,
  }];

  return { summary, articleLinks };
}

// Patterns for country-specific case sentences in ECDC press releases.
// Each regex captures: (count_word_or_digit, country_name)
// Covers phrasings seen in ECDC/WHO publications:
//   "one new confirmed case has been reported in France"
//   "three cases confirmed in the Netherlands"
//   "Germany: 2 new cases"
//   "two confirmed cases have been reported in Italy"
const COUNTRY_PATTERNS = [
  // "X new [confirmed] case(s) has/have been reported/confirmed in [Country]"
  /(\w+|\d+)\s+new\s+(?:confirmed\s+)?cases?\s+(?:has|have)\s+been\s+(?:reported|confirmed)\s+in\s+([A-Z][a-zA-Z\s\-]{2,30}?)(?:\s*[:,;.]|$)/gi,
  // "X [confirmed] case(s) has/have been reported/confirmed in [Country]"
  /(\w+|\d+)\s+(?:confirmed\s+)?cases?\s+(?:has|have)\s+been\s+(?:reported|confirmed)\s+in\s+([A-Z][a-zA-Z\s\-]{2,30}?)(?:\s*[:,;.]|$)/gi,
  // "X [confirmed] case(s) reported/confirmed in [Country]"
  /(\w+|\d+)\s+(?:confirmed\s+)?cases?\s+(?:reported|confirmed)\s+in\s+([A-Z][a-zA-Z\s\-]{2,30}?)(?:\s*[:,;.]|$)/gi,
  // "[Country]: X [new] [confirmed] case(s)"  (terminator = end of sentence or word boundary)
  /([A-Z][a-zA-Z\s\-]{2,30}?):\s+(\w+|\d+)\s+(?:new\s+)?(?:confirmed\s+)?cases?(?=[\s.,;:]|$)/gi,
];

function extractCountryCases(text) {
  const results = [];
  const seen = new Set();

  for (const re of COUNTRY_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      // Last pattern has (country, count) order swapped
      const isSwapped = re === COUNTRY_PATTERNS[COUNTRY_PATTERNS.length - 1];
      const rawCount = isSwapped ? m[2] : m[1];
      const rawCountry = isSwapped ? m[1] : m[2];
      const country = rawCountry.trim();
      const count = toNum(rawCount);
      if (!count || count > 500) continue;  // sanity bound
      if (seen.has(country.toLowerCase())) continue;
      seen.add(country.toLowerCase());
      results.push({ country, count, matchText: m[0] });
    }
  }

  return results;
}

// Fetch one ECDC article and extract any country-specific case announcements.
// Returns published_at from the page if available (used to skip pre-outbreak articles).
async function scrapeArticle(url) {
  const { data } = await axios.get(url, { timeout: 15000, headers: HEADERS });
  const $ = cheerio.load(data);

  // Try to extract article date
  const dateText = $('time').first().attr('datetime')
    || $('[class*="date"]').first().text().trim();
  const published_at = dateText ? new Date(dateText) : null;

  // Skip articles that pre-date the outbreak
  if (published_at && !isNaN(published_at.getTime()) && published_at < OUTBREAK_CUTOFF) {
    return [];
  }

  const text = $('body').text().replace(/\s+/g, ' ');
  const countryCases = extractCountryCases(text);

  return countryCases.map(({ country, count, matchText }) => ({
    location_name: country,
    total_cases: count,
    active_cases: count,
    fatalities: 0,
    transmission_rodent: 0.0,
    transmission_person: 1.0,
    source: 'ECDC',
    url,
    published_at: published_at?.toISOString() || new Date('2026-05-01T00:00:00Z').toISOString(),
    raw_text: matchText,
  }));
}

export async function run() {
  let summary = [];
  let articleLinks = [];

  try {
    ({ summary, articleLinks } = await fetchOutbreakSummary());
  } catch (err) {
    console.warn('[ecdcScraper] Main page failed:', err.message);
  }

  // Deduplicate and filter article links: only ECDC news/press-release/assessment pages
  const toScrape = [...new Set(articleLinks)].filter(url =>
    /ecdc\.europa\.eu\/en\/(news-events|publications-data)\//.test(url)
  );

  console.log(`[ecdcScraper] Checking ${toScrape.length} ECDC article links for country cases`);

  // Scrape articles sequentially (rate-limit courtesy delay)
  const countryResults = [];
  for (const url of toScrape) {
    try {
      const records = await scrapeArticle(url);
      countryResults.push(...records);
      if (toScrape.length > 1) await new Promise(r => setTimeout(r, 500));
    } catch {
      // skip unreachable articles silently
    }
  }

  // Merge country records: if multiple articles mention the same country, take the max count
  const byCountry = {};
  for (const r of countryResults) {
    const key = r.location_name.toLowerCase();
    if (!byCountry[key] || r.total_cases > byCountry[key].total_cases) {
      byCountry[key] = r;
    }
  }

  const countryList = Object.values(byCountry);
  if (countryList.length > 0) {
    console.log(`[ecdcScraper] Found country-specific cases: ${countryList.map(r => `${r.location_name}:${r.total_cases}`).join(', ')}`);
  }

  return [...summary, ...countryList];
}

export default { run };
