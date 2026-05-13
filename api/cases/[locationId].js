module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { locationId } = req.query;
  const data = { spain: { location_id: 'spain', location_name: 'Spain', total_cases: 8, active_cases: 5, fatalities: 1, children: [] }, netherlands: { location_id: 'netherlands', location_name: 'Netherlands', total_cases: 3, active_cases: 2, fatalities: 0, children: [] }, france: { location_id: 'france', location_name: 'France', total_cases: 2, active_cases: 1, fatalities: 0, children: [] } };
  if (!data[locationId]) return res.status(404).end(JSON.stringify({ error: 'Not found' }));
  res.status(200).end(JSON.stringify(data[locationId]));
};
