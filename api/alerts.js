export default (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const alerts = [{ location_id: 'spain', location_name: 'Spain', alert_level: 'WARNING', total_cases: 8, active_cases: 5 }];
  res.status(200).end(JSON.stringify(alerts));
};
