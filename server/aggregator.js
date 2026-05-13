import { run as whoRun } from './scrapers/whoScraper.js';
import { run as promedRun } from './scrapers/promedScraper.js';
import { run as healthmapRun } from './scrapers/healthmapScraper.js';
import { run as cdcRun } from './scrapers/cdcEcdcScraper.js';
import { run as ecdcRun } from './scrapers/ecdcScraper.js';

// Discard any scraped record dated before the 2026 Andes outbreak
const OUTBREAK_CUTOFF = new Date('2026-05-01T00:00:00Z');
function isCurrentOutbreak(record) {
  if (!record.published_at) return true;  // no date = keep
  const d = new Date(record.published_at);
  return isNaN(d.getTime()) || d >= OUTBREAK_CUTOFF;
}
import { geocode } from './geocoder.js';
import storage from './storage.js';

function alertLevel(activeCases) {
  if (!activeCases) return 'WATCH';
  if (activeCases > 100) return 'CRITICAL';
  if (activeCases > 20) return 'WARNING';
  if (activeCases > 5) return 'ADVISORY';
  return 'WATCH';
}

function conflictFlag(records) {
  if (records.length < 2) return 0;
  const totals = records.map(r => r.total_cases).filter(n => n > 0);
  if (totals.length < 2) return 0;
  const max = Math.max(...totals);
  const min = Math.min(...totals);
  if (max === 0) return 0;
  return (max - min) / max > 0.2 ? 1 : 0;
}

export async function runAggregator() {
  console.log('[aggregator] Starting aggregation run');

  const results = await Promise.allSettled([
    whoRun(),
    promedRun(),
    healthmapRun(),
    cdcRun(),
    ecdcRun(),
  ]);

  const scraperNames = ['who', 'promed', 'healthmap', 'cdc', 'ecdc'];
  const sourceStatus = {};
  const allRecords = [];

  results.forEach((result, i) => {
    const name = scraperNames[i];
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      const records = result.value
        .filter(r => r.url)
        .filter(isCurrentOutbreak);
      sourceStatus[name] = records.length > 0;
      allRecords.push(...records);
    } else {
      sourceStatus[name] = false;
      if (result.status === 'rejected') {
        console.error(`[aggregator] Scraper ${name} rejected:`, result.reason);
      }
    }
  });

  console.log(`[aggregator] Collected ${allRecords.length} records across scrapers`);

  // Geocode each record sequentially (geocoder handles queue/rate-limit)
  const geocoded = [];
  for (const record of allRecords) {
    const geo = await geocode(record.location_name);
    if (!geo) {
      console.warn(`[aggregator] No geocode result for "${record.location_name}" — skipping`);
      continue;
    }
    geocoded.push({ ...record, ...geo });
  }

  // Group by location_id
  const groups = {};
  for (const record of geocoded) {
    if (!groups[record.location_id]) groups[record.location_id] = [];
    groups[record.location_id].push(record);
  }

  // Merge each group and collect results
  const mergedCases = [];
  for (const [locationId, records] of Object.entries(groups)) {
    const first = records[0];

    const seenUrls = new Set();
    const sourceUrls = records
      .filter(r => r.url && !seenUrls.has(r.url) && seenUrls.add(r.url))
      .map(r => ({ source: r.source, url: r.url, published_at: r.published_at || null }));
    const uniqueSources = [...new Set(records.map(r => r.source))];
    const confidence = uniqueSources.length >= 2 ? 'high' : 'low';

    const caseCounts = records.map(r => r.total_cases).filter(n => n != null && n >= 0);
    const activeCounts = records.map(r => r.active_cases).filter(n => n != null && n >= 0);
    const fatalCounts = records.map(r => r.fatalities).filter(n => n != null && n >= 0);
    const totalCases = caseCounts.length ? Math.max(...caseCounts) : null;
    const activeCases = activeCounts.length ? Math.max(...activeCounts) : null;
    const fatalities = fatalCounts.length ? Math.max(...fatalCounts) : null;

    const merged = {
      location_id: locationId,
      location_name: first.location_name,
      lat: first.lat,
      lng: first.lng,
      level: first.level,
      parent_id: first.parent_id,
      total_cases: totalCases,
      active_cases: activeCases,
      fatalities,
      transmission_rodent: first.transmission_rodent,
      transmission_person: first.transmission_person,
      source_urls: sourceUrls,
      sources: uniqueSources,
      confidence,
      conflict_flag: conflictFlag(records),
      alert_level: alertLevel(activeCases),
      last_updated: new Date().toISOString(),
    };

    mergedCases.push(merged);
    await storage.upsertSnapshot(locationId, {
      total_cases: totalCases,
      active_cases: activeCases,
      fatalities,
      confidence,
      alert_level: merged.alert_level,
    });
  }

  // Full replace of cases.json — ensures stale locations from previous runs are removed
  await storage.writeCases({ cases: mergedCases, updated_at: new Date().toISOString() });

  // Update meta
  const meta = await storage.readMeta();
  meta.last_updated = new Date().toISOString();
  meta.source_status = { ...meta.source_status, ...sourceStatus };
  meta.stale = false;
  await storage.writeMeta(meta);

  console.log(`[aggregator] Done. Upserted ${Object.keys(groups).length} locations`);
}

export default { runAggregator };
