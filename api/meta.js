export default (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ last_updated: new Date().toISOString(), source_status: { who: true, ecdc: true, cdc: false, promed: false, healthmap: false, news: true }, stale: false, flagged_count: 0 });
};
