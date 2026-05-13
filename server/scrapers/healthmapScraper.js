import axios from 'axios';

function extractLocationFromText(text) {
  const m = text.match(/\bin\s+([A-Z][a-zA-Z\s]+?)(?:\s*[-–,.]|$)/);
  if (m && m[1]) return m[1].trim();
  return 'Unknown';
}

function extractCaseCount(text) {
  const m = text.match(/(\d+)\s*(?:cases?|confirmed|reported)/i);
  return m ? parseInt(m[1], 10) : 0;
}

export async function run() {
  const apiUrl = process.env.HEALTHMAP_API_URL;
  if (!apiUrl) {
    console.warn('[healthmapScraper] HEALTHMAP_API_URL not set');
    return [];
  }

  try {
    const response = await axios.get(apiUrl, { timeout: 15000 });
    const data = response.data;

    if (!Array.isArray(data)) {
      console.warn('[healthmapScraper] Unexpected response format (not an array)');
      return [];
    }

    const results = [];

    for (const alert of data) {
      const disease = (alert.disease || '').toLowerCase();
      const summary = (alert.summary || alert.description || '').toLowerCase();
      if (!disease.includes('hanta') && !summary.includes('hanta')) continue;

      const raw_text = alert.summary || alert.description || '';
      const location_name = alert.place_name || alert.country || extractLocationFromText(raw_text);
      const total_cases = extractCaseCount(raw_text);

      results.push({
        location_name: location_name || 'Unknown',
        total_cases,
        active_cases: 0,
        fatalities: 0,
        transmission_rodent: 0.8,
        transmission_person: 0.2,
        source: 'HealthMap',
        url: alert.link || null,
        published_at: alert.date || null,
        raw_text,
      });
    }

    return results;
  } catch (err) {
    console.error('[healthmapScraper] Error fetching HealthMap API:', err.message);
    return [];
  }
}

export default { run };
