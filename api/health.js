export default (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
};
