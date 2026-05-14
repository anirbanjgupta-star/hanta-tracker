import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const sheets = google.sheets('v4');

// Parse private key properly
const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n');

// Initialize auth using JWT
const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
  key: privateKey,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

export async function readCasesFromSheet() {
  try {
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId: SHEET_ID,
      range: 'Cases!A2:L',
    });

    const rows = response.data.values || [];
    const cases = rows.map(row => ({
      location_id: row[0] || '',
      location_name: row[1] || '',
      lat: parseFloat(row[2]) || 0,
      lng: parseFloat(row[3]) || 0,
      total_cases: parseInt(row[4]) || 0,
      active_cases: parseInt(row[5]) || 0,
      fatalities: parseInt(row[6]) || 0,
      transmission_rodent: parseFloat(row[7]) || 0,
      transmission_person: parseFloat(row[8]) || 0,
      sources: row[9] ? row[9].split(',').map(s => s.trim()) : [],
      confidence: row[10] || 'medium',
      alert_level: row[11] || 'WATCH',
      last_updated: new Date().toISOString(),
    }));

    return cases;
  } catch (err) {
    console.error('Error reading cases from sheet:', err.message);
    return [];
  }
}

export async function readNewsFromSheet() {
  try {
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId: SHEET_ID,
      range: 'News!A2:F',
    });

    const rows = response.data.values || [];
    const articles = rows.map(row => ({
      id: row[0] || '',
      title: row[1] || '',
      summary: row[2] || '',
      source_name: row[3] || '',
      source_url: row[4] || '',
      published_at: row[5] || new Date().toISOString(),
      is_disputed: 0,
      is_unverified_claim: 0,
    }));

    return articles;
  } catch (err) {
    console.error('Error reading news from sheet:', err.message);
    return [];
  }
}

export async function writeCasesToSheet(cases) {
  try {
    const values = cases.map(c => [
      c.location_id,
      c.location_name,
      c.lat,
      c.lng,
      c.total_cases,
      c.active_cases,
      c.fatalities,
      c.transmission_rodent,
      c.transmission_person,
      Array.isArray(c.sources) ? c.sources.join(',') : c.sources || '',
      c.confidence,
      c.alert_level,
    ]);

    // Clear existing data
    await sheets.spreadsheets.values.clear({
      auth,
      spreadsheetId: SHEET_ID,
      range: 'Cases!A2:L',
    });

    // Write new data
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId: SHEET_ID,
      range: 'Cases!A2',
      valueInputOption: 'RAW',
      resource: {
        values: values,
      },
    });

    console.log(`✓ Wrote ${cases.length} cases to Google Sheet`);
    return true;
  } catch (err) {
    console.error('Error writing cases to sheet:', err.message);
    return false;
  }
}

export async function writeNewsToSheet(articles) {
  try {
    const values = articles.map(a => [
      a.id,
      a.title,
      a.summary,
      a.source_name,
      a.source_url,
      a.published_at,
    ]);

    // Clear existing data
    await sheets.spreadsheets.values.clear({
      auth,
      spreadsheetId: SHEET_ID,
      range: 'News!A2:F',
    });

    // Write new data
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId: SHEET_ID,
      range: 'News!A2',
      valueInputOption: 'RAW',
      resource: {
        values: values,
      },
    });

    console.log(`✓ Wrote ${articles.length} news articles to Google Sheet`);
    return true;
  } catch (err) {
    console.error('Error writing news to sheet:', err.message);
    return false;
  }
}
