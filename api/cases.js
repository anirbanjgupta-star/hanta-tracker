export default (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const cases = [
    { location_id: 'spain', location_name: 'Spain', total_cases: 8, active_cases: 5, fatalities: 1, lat: 40.46, lng: -3.75 },
    { location_id: 'netherlands', location_name: 'Netherlands', total_cases: 3, active_cases: 2, fatalities: 0, lat: 52.13, lng: 5.29 },
    { location_id: 'france', location_name: 'France', total_cases: 2, active_cases: 1, fatalities: 0, lat: 46.23, lng: 2.21 }
  ];

  res.status(200).json(cases);
};
