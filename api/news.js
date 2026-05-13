export default (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const news = [
    { id: '1', title: 'Hantavirus cases in Europe', summary: 'New outbreak reported', source: 'WHO', url: 'https://who.int', published_at: '2026-05-13T15:00:00Z', is_disputed: 0, is_unverified_claim: 0 },
    { id: '2', title: 'Spain reports increase in hantavirus cases', summary: 'Health authorities confirm 8 cases in Tenerife', source: 'ECDC', url: 'https://ecdc.europa.eu', published_at: '2026-05-12T10:30:00Z', is_disputed: 0, is_unverified_claim: 0 },
    { id: '3', title: 'France detects hantavirus case', summary: 'First confirmed case in mainland France', source: 'CDC', url: 'https://cdc.gov', published_at: '2026-05-11T08:15:00Z', is_disputed: 0, is_unverified_claim: 0 },
    { id: '4', title: 'Hantavirus prevention guidelines updated', summary: 'WHO releases new safety recommendations', source: 'WHO', url: 'https://who.int', published_at: '2026-05-10T14:45:00Z', is_disputed: 0, is_unverified_claim: 0 },
    { id: '5', title: 'Netherlands confirms rodent-borne virus', summary: 'Health ministry urges caution in agricultural areas', source: 'News', url: 'https://example.com/news', published_at: '2026-05-09T09:20:00Z', is_disputed: 0, is_unverified_claim: 0 },
    { id: '6', title: 'Hantavirus: What you need to know', summary: 'Expert explains symptoms and prevention', source: 'Health', url: 'https://example.com/health', published_at: '2026-05-08T16:00:00Z', is_disputed: 0, is_unverified_claim: 0 }
  ];

  res.status(200).json(news);
};
