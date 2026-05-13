export default (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const url = new URL(req.url, 'http://' + req.headers.host);
  const pathname = url.pathname;
  
  // Route: /api/cases
  if (pathname === '/api/cases' && req.method === 'GET') {
    const cases = [
      { location_id: 'spain', location_name: 'Spain', total_cases: 8, active_cases: 5, fatalities: 1, lat: 40.46, lng: -3.75 },
      { location_id: 'netherlands', location_name: 'Netherlands', total_cases: 3, active_cases: 2, fatalities: 0, lat: 52.13, lng: 5.29 },
      { location_id: 'france', location_name: 'France', total_cases: 2, active_cases: 1, fatalities: 0, lat: 46.23, lng: 2.21 }
    ];
    return res.status(200).end(JSON.stringify(cases));
  }
  
  // Route: /api/news
  if (pathname === '/api/news' && req.method === 'GET') {
    const news = [
      { id: '1', title: 'Hantavirus cases in Europe', summary: 'New outbreak reported', source: 'WHO', url: 'https://who.int', published_at: '2026-05-13T15:00:00Z', is_disputed: 0, is_unverified_claim: 0 },
      { id: '2', title: 'Spain reports increase in hantavirus cases', summary: 'Health authorities confirm 8 cases in Tenerife', source: 'ECDC', url: 'https://ecdc.europa.eu', published_at: '2026-05-12T10:30:00Z', is_disputed: 0, is_unverified_claim: 0 },
      { id: '3', title: 'France detects hantavirus case', summary: 'First confirmed case in mainland France', source: 'CDC', url: 'https://cdc.gov', published_at: '2026-05-11T08:15:00Z', is_disputed: 0, is_unverified_claim: 0 },
      { id: '4', title: 'Hantavirus prevention guidelines updated', summary: 'WHO releases new safety recommendations', source: 'WHO', url: 'https://who.int', published_at: '2026-05-10T14:45:00Z', is_disputed: 0, is_unverified_claim: 0 },
      { id: '5', title: 'Netherlands confirms rodent-borne virus', summary: 'Health ministry urges caution in agricultural areas', source: 'News', url: 'https://example.com/news', published_at: '2026-05-09T09:20:00Z', is_disputed: 0, is_unverified_claim: 0 },
      { id: '6', title: 'Hantavirus: What you need to know', summary: 'Expert explains symptoms and prevention', source: 'Health', url: 'https://example.com/health', published_at: '2026-05-08T16:00:00Z', is_disputed: 0, is_unverified_claim: 0 }
    ];
    return res.status(200).end(JSON.stringify(news));
  }
  
  // Route: /api/meta
  if (pathname === '/api/meta' && req.method === 'GET') {
    return res.status(200).end(JSON.stringify({ last_updated: new Date().toISOString(), source_status: { who: true, ecdc: true, cdc: false, promed: false, healthmap: false, news: true }, stale: false, flagged_count: 0 }));
  }
  
  // Route: /api/guidelines
  if (pathname === '/api/guidelines' && req.method === 'GET') {
    const guidelines = { WHO: { source_url: 'https://who.int', PREVENTION: ['Avoid rodents', 'Seal cracks'], SYMPTOMS: ['Fever', 'Fatigue'] }, CDC: { source_url: 'https://cdc.gov', PREVENTION: ['Remove food sources'], SYMPTOMS: ['Fever', 'Cough'] } };
    return res.status(200).end(JSON.stringify(guidelines));
  }
  
  // Route: /api/alerts
  if (pathname === '/api/alerts' && req.method === 'GET') {
    const alerts = [{ location_id: 'spain', location_name: 'Spain', alert_level: 'WARNING', total_cases: 8, active_cases: 5 }];
    return res.status(200).end(JSON.stringify(alerts));
  }
  
  // Route: /api/health
  if (pathname === '/api/health' && req.method === 'GET') {
    return res.status(200).end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
  }
  
  // Route: /api/stream
  if (pathname === '/api/stream' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    return setTimeout(() => res.end(), 100);
  }

  // Route: /api/cases/:locationId
  const casesMatch = pathname.match(/^\/api\/cases\/([a-z0-9-]+)$/);
  if (casesMatch && req.method === 'GET') {
    const locationId = casesMatch[1];
    const allCases = [
      {
        location_id: 'spain',
        location_name: 'Spain',
        total_cases: 8,
        active_cases: 5,
        fatalities: 1,
        lat: 40.46,
        lng: -3.75,
        children: [],
        source_urls: ['https://www.who.int', 'https://www.ecdc.europa.eu', 'https://www.cdc.gov']
      },
      {
        location_id: 'netherlands',
        location_name: 'Netherlands',
        total_cases: 3,
        active_cases: 2,
        fatalities: 0,
        lat: 52.13,
        lng: 5.29,
        children: [],
        source_urls: ['https://www.who.int', 'https://www.ecdc.europa.eu']
      },
      {
        location_id: 'france',
        location_name: 'France',
        total_cases: 2,
        active_cases: 1,
        fatalities: 0,
        lat: 46.23,
        lng: 2.21,
        children: [],
        source_urls: ['https://www.who.int', 'https://www.cdc.gov']
      }
    ];
    const found = allCases.find(c => c.location_id === locationId);
    if (!found) return res.status(404).end(JSON.stringify({ error: 'Not found' }));
    return res.status(200).end(JSON.stringify(found));
  }

  // Route: /api/trend/:locationId
  const trendMatch = pathname.match(/^\/api\/trend\/([a-z0-9-]+)$/);
  if (trendMatch && req.method === 'GET') {
    return res.status(200).end(JSON.stringify([]));
  }

  // 404
  res.status(404).end(JSON.stringify({ error: 'Not found' }));
};
