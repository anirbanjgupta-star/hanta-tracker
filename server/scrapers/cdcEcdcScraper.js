import axios from 'axios';
import * as cheerio from 'cheerio';

const SURVEILLANCE_URL = 'https://www.cdc.gov/hantavirus/data-research/cases/index.html';
const FALLBACK_URL = 'https://www.cdc.gov/hantavirus/index.html';
const HEADERS = { 'User-Agent': 'HantaTracker/1.0 (anirban.j.gupta@gmail.com)' };

// Parse a number string like "1,234" → 1234, or return null if not a valid count
function parseCount(str) {
  if (!str) return null;
  const cleaned = str.replace(/,/g, '').trim();
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Try to extract state-level rows from the CDC HPS surveillance table
// Expected table columns: State | Cases | Deaths (or similar)
function parseSurveillanceTable($, url) {
  const results = [];

  $('table').each((_, table) => {
    const headers = [];
    $(table).find('thead tr th, thead tr td').each((_, th) => {
      headers.push($(th).text().trim().toLowerCase());
    });

    // Look for a table that has state/location + case count columns
    const stateIdx = headers.findIndex(h => /state|location|region/i.test(h));
    const caseIdx = headers.findIndex(h => /case|reported/i.test(h));
    const deathIdx = headers.findIndex(h => /death|fatal/i.test(h));

    if (stateIdx === -1 || caseIdx === -1) return; // not the right table

    $(table).find('tbody tr').each((_, row) => {
      const cells = $(row).find('td');
      const stateName = cells.eq(stateIdx).text().trim();
      const caseText = cells.eq(caseIdx).text().trim();
      const deathText = deathIdx >= 0 ? cells.eq(deathIdx).text().trim() : null;

      if (!stateName || stateName.toLowerCase() === 'total') return;

      const total_cases = parseCount(caseText);
      const fatalities = parseCount(deathText);

      if (total_cases === null) return; // no usable data

      results.push({
        location_name: stateName,
        total_cases,
        active_cases: 0,
        fatalities,
        transmission_rodent: 0.97,
        transmission_person: 0.03,
        source: 'CDC/ECDC',
        url,
        published_at: new Date().toISOString(),
        raw_text: `${stateName}: ${total_cases} cases${fatalities != null ? `, ${fatalities} deaths` : ''}`,
      });
    });
  });

  return results;
}

// Fallback: look for aggregate US numbers in body text
// Returns the published_at date extracted from the text ("as of December 2020") so the
// aggregator's date filter can discard pre-outbreak historical data.
function parseFallbackText($, url) {
  const text = $('body').text();
  const caseMatch = text.match(/(\d[\d,]*)\s*(?:confirmed\s+)?(?:cases?\s+of\s+hantavirus|hantavirus\s+cases?)/i);
  const fatalMatch = text.match(/(\d[\d,]*)\s*(?:deaths?|fatalities)\s+(?:from|due to)?\s*hantavirus/i);

  // Detect the qualifying date phrase: "as of December 2020", "as of end of 2023", etc.
  const asOfMatch = text.match(/as of(?:\s+the\s+end\s+of)?\s+(?:\w+\s+)?(\d{4})/i);
  const dataYear = asOfMatch ? parseInt(asOfMatch[1], 10) : null;

  const total_cases = caseMatch ? parseCount(caseMatch[1]) : null;
  const fatalities = fatalMatch ? parseCount(fatalMatch[1]) : null;

  if (total_cases === null) return [];

  // Set published_at to the actual data year so the aggregator cutoff filter works
  const published_at = dataYear
    ? new Date(`${dataYear}-12-31T00:00:00Z`).toISOString()
    : new Date().toISOString();

  return [{
    location_name: 'United States',
    total_cases,
    active_cases: 0,
    fatalities,
    transmission_rodent: 0.97,
    transmission_person: 0.03,
    source: 'CDC/ECDC',
    url,
    published_at,
    raw_text: `US aggregate: ${total_cases} cases${dataYear ? ` (as of ${dataYear})` : ''}`,
  }];
}

export async function run() {
  // Try the surveillance data page first
  try {
    const { data } = await axios.get(SURVEILLANCE_URL, { timeout: 15000, headers: HEADERS });
    const $ = cheerio.load(data);
    const results = parseSurveillanceTable($, SURVEILLANCE_URL);
    if (results.length > 0) {
      console.log(`[cdcEcdcScraper] Extracted ${results.length} state records from surveillance table`);
      return results;
    }
    console.warn('[cdcEcdcScraper] Surveillance table found no usable rows — trying fallback text parse');
    const fallback = parseFallbackText($, SURVEILLANCE_URL);
    if (fallback.length > 0) return fallback;
  } catch (err) {
    console.warn(`[cdcEcdcScraper] Surveillance page unavailable: ${err.message} — trying fallback URL`);
  }

  // Fallback to the main CDC hantavirus page
  try {
    const { data } = await axios.get(FALLBACK_URL, { timeout: 15000, headers: HEADERS });
    const $ = cheerio.load(data);
    const results = parseSurveillanceTable($, FALLBACK_URL);
    if (results.length > 0) return results;
    return parseFallbackText($, FALLBACK_URL);
  } catch (err) {
    console.error('[cdcEcdcScraper] Fallback page also failed:', err.message);
    return [];
  }
}

export default { run };
