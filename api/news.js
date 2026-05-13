export default (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const news = [{ id: '1', title: 'Hantavirus cases in Europe', summary: 'New outbreak', source: 'WHO', url: 'https://who.int', published_at: new Date().toISOString(), is_disputed: 0 }];
  res.status(200).end(JSON.stringify(news));
};
