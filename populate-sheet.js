import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeCasesToSheet, writeNewsToSheet } from './api/sheets-integration.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');

async function populateSheet() {
  try {
    console.log('Reading local data files...');

    // Read cases data
    const casesData = JSON.parse(readFileSync(join(dataDir, 'cases.json'), 'utf-8'));
    const cases = casesData.cases || [];

    // Read news data
    const newsData = JSON.parse(readFileSync(join(dataDir, 'news_articles.json'), 'utf-8'));
    const articles = newsData.articles || [];

    console.log(`Found ${cases.length} cases and ${articles.length} articles`);

    // Write to Google Sheet
    console.log('\nWriting to Google Sheet...');
    await writeCasesToSheet(cases);
    await writeNewsToSheet(articles);

    console.log('\n✓ Google Sheet populated successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

populateSheet();
