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

    // Trigger the /api/refresh endpoint to clear the in-memory cache and KV
    try {
      // Use VERCEL_URL for production, localhost for local development
      const protocol = process.env.VERCEL ? 'https' : 'http';
      const host = process.env.VERCEL_URL || `localhost:${process.env.PORT || 3000}`;
      const baseUrl = `${protocol}://${host}`;

      const response = await fetch(`${baseUrl}/api/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }).catch((err) => {
        console.warn('[cron] Fetch error:', err.message);
        return null;
      });

      if (response && response.ok) {
        console.log('[cron] Cache refresh triggered successfully');
      } else if (response) {
        console.warn('[cron] Cache refresh returned status:', response.status);
      }
    } catch (err) {
      console.warn('[cron] Could not trigger internal refresh:', err.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Cron refresh scheduled - API cache and KV will be refreshed',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[cron] Error during refresh:', err);
    return res.status(500).json({
      error: 'Refresh failed',
      details: err.message
    });
  }
};
