export default (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const guidelines = { WHO: { source_url: 'https://who.int', PREVENTION: ['Avoid rodents', 'Seal cracks'], SYMPTOMS: ['Fever', 'Fatigue'] }, CDC: { source_url: 'https://cdc.gov', PREVENTION: ['Remove food sources'], SYMPTOMS: ['Fever', 'Cough'] } };
  res.status(200).end(JSON.stringify(guidelines));
};
