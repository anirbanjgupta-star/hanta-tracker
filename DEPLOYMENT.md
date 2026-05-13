# Vercel Deployment Guide

## Quick Start

### Step 1: Push to GitHub
```bash
# In the hanta-tracker directory
git push origin claude/lucid-rosalind-5306f4
```

### Step 2: Deploy via Vercel Dashboard

1. Go to [vercel.com](https://vercel.com)
2. Sign in with GitHub account (connect if needed)
3. Click "Add New..." → "Project"
4. Select the `Claude-Work` repository
5. Set **Root Directory** to `hanta-tracker/`
6. Click "Deploy"

### Step 3: Configure Environment Variables

In Vercel Project Settings → Environment Variables, add:

```
STORAGE_PATH = ./data
REFRESH_INTERVAL_MS = 300000
WHO_RSS_URL = https://www.who.int/rss-feeds/news-english.xml
PROMED_RSS_URL = https://promedmail.org/feed/
HEALTHMAP_API_URL = https://healthmap.org/getAlerts.php
CONTACT_EMAIL = anirban.j.gupta@gmail.com
VITE_CONTACT_EMAIL = anirban.j.gupta@gmail.com
```

## Build Settings

- **Framework**: Other
- **Build Command**: `npm install && npm run build`
- **Output Directory**: `client/dist`
- **Install Command**: `npm install && npm run install:all`

## Project Structure

```
hanta-tracker/
├── server/          → Express API backend
├── client/          → Vite + React frontend  
├── data/            → JSON storage (auto-created)
├── vercel.json      → Deployment config
└── package.json     → Root dependencies
```

## API Routes

- `GET /api/cases` - All outbreak cases
- `GET /api/cases/:locationId` - Specific location
- `GET /api/trend/:locationId` - Historical trend data
- `GET /api/meta` - Metadata & source status
- `GET /api/news` - News articles
- `GET /api/guidelines` - WHO/CDC guidelines
- `GET /api/stream` - Server-Sent Events (live updates)

## Notes

- **Data Storage**: Uses ephemeral filesystem - data refreshes every 5 minutes via cronjobs
- **Scrapers**: Automatic 5-min refresh interval for all data sources
- **CORS**: Configured for Vercel domains
- **Client Proxy**: Development uses `localhost:3456` for API calls

## After Deployment

Test the deployment:
```bash
curl https://<your-deployment-url>/api/meta
```

You should see JSON with metadata, source status, and last update timestamp.

## Troubleshooting

**"Build failed"**: Ensure `npm install && npm run install:all` installs all dependencies
**"404 on routes"**: Check vercel.json routes are correct
**"CORS error"**: Add your Vercel domain to Express CORS whitelist in `server/index.js`
**"No data"**: First aggregation runs on deployment, may take 30 seconds

## Local Testing Before Deploy

```bash
npm run install:all
npm run dev
# Frontend: http://localhost:5174
# Backend: http://localhost:3456
```
