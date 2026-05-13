import axios from 'axios';
import * as cheerio from 'cheerio';
import storage from '../storage.js';

const WHO_URL = 'https://www.who.int/news-room/fact-sheets/detail/hantavirus-disease';
const CDC_URL = 'https://www.cdc.gov/hantavirus/index.html';

const KEYWORD_SECTIONS = {
  PREVENTION: ['prevent', 'avoid', 'protect', 'seal', 'rodent-proof'],
  SYMPTOMS: ['symptom', 'sign', 'fever', 'fatigue'],
  QUARANTINE: ['isolat', 'quarantin', 'contact precaution'],
  WHEN_TO_SEEK_CARE: ['seek', 'hospital', 'emergency', 'doctor'],
};

function classifyText(text) {
  const lower = text.toLowerCase();
  for (const [section, keywords] of Object.entries(KEYWORD_SECTIONS)) {
    if (keywords.some(kw => lower.includes(kw))) return section;
  }
  return null;
}

async function scrapePage(url) {
  const sections = { PREVENTION: [], SYMPTOMS: [], QUARANTINE: [], WHEN_TO_SEEK_CARE: [] };

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'HantaTracker/1.0 (anirban.j.gupta@gmail.com)' },
    });

    const $ = cheerio.load(response.data);

    $('p, li').each((_, el) => {
      const text = $(el).text().trim();
      if (!text || text.length < 10) return;
      const section = classifyText(text);
      if (section) sections[section].push(text);
    });
  } catch (err) {
    console.error(`[guidelinesScraper] Error fetching ${url}:`, err.message);
  }

  return sections;
}

export async function run() {
  const [whoSections, cdcSections] = await Promise.all([
    scrapePage(WHO_URL),
    scrapePage(CDC_URL),
  ]);

  const existing = await storage.readGuidelines();
  const guidelines = existing.guidelines || {};

  // Only write if scraped arrays are non-empty — never overwrite with empty arrays
  const whoHasContent = Object.values(whoSections).some(arr => arr.length > 0);
  const cdcHasContent = Object.values(cdcSections).some(arr => arr.length > 0);

  if (whoHasContent) {
    guidelines['WHO'] = {
      source_url: WHO_URL,
      last_updated: new Date().toISOString().split('T')[0],
      fetched_at: new Date().toISOString(),
      ...whoSections,
    };
  } else {
    console.warn('[guidelinesScraper] WHO returned empty sections — preserving existing data');
  }

  if (cdcHasContent) {
    guidelines['CDC'] = {
      source_url: CDC_URL,
      last_updated: new Date().toISOString().split('T')[0],
      fetched_at: new Date().toISOString(),
      ...cdcSections,
    };
  } else {
    console.warn('[guidelinesScraper] CDC returned empty sections — preserving existing data');
  }

  await storage.writeGuidelines({ guidelines });
  console.log('[guidelinesScraper] Guidelines updated');
}

export default { run };
