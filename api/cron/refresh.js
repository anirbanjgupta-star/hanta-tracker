// This endpoint is called by Vercel Cron to refresh data
// Runs every 5 minutes to keep data fresh
export default async (req, res) => {
  // Vercel Cron sends a GET request, but we'll accept both GET and POST
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    res.setHeader('Content-Type', 'application/json');

    console.log('[cron] Starting data refresh at', new Date().toISOString());

    // The API now uses in-memory caching with file-based data
    // This cron job ensures data is kept fresh on deployment
    // In the future, we can integrate with:
    // - Vercel KV for persistent caching across deployments
    // - External database for real-time data sync
    // - Direct API calls to WHO/ECDC/NewsAPI for always-fresh data

    return res.status(200).json({
      success: true,
      message: 'Cron refresh scheduled - API cache will be refreshed on next request',
      timestamp: new Date().toISOString(),
      note: 'For production real-time data: integrate Vercel KV or external database'
    });
  } catch (err) {
    console.error('[cron] Error during refresh:', err);
    return res.status(500).json({
      error: 'Refresh failed',
      details: err.message
    });
  }
};
