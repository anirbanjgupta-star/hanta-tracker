import cron from 'node-cron';
import { writeCasesToSheet, writeNewsToSheet } from './api/sheets-integration.js';
import { fetchAllData } from './scrapers.js';

// Run every 12 hours: at midnight (0:00) and noon (12:00)
const SCHEDULE = '0 0,12 * * *';

async function refreshData() {
  try {
    console.log(`\n[REFRESH] Starting data refresh at ${new Date().toISOString()}`);

    const { cases, articles } = await fetchAllData();

    if (cases && cases.length > 0) {
      console.log(`[REFRESH] Writing ${cases.length} cases to Google Sheets...`);
      await writeCasesToSheet(cases);
    }

    if (articles && articles.length > 0) {
      console.log(`[REFRESH] Writing ${articles.length} articles to Google Sheets...`);
      await writeNewsToSheet(articles);
    }

    console.log(`[REFRESH] ✓ Data refresh complete at ${new Date().toISOString()}\n`);
  } catch (err) {
    console.error(`[REFRESH] ✗ Data refresh failed:`, err.message);
  }
}

export function startScheduler() {
  console.log(`[SCHEDULER] Scheduled data refresh every 12 hours (${SCHEDULE})`);

  // Run immediately on startup
  console.log('[SCHEDULER] Running initial refresh...');
  refreshData();

  // Schedule for every 12 hours
  cron.schedule(SCHEDULE, () => {
    console.log('[SCHEDULER] Cron job triggered, refreshing data...');
    refreshData();
  });
}
