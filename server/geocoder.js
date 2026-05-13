import axios from 'axios';

const cache = new Map();
const RATE_LIMIT_MS = 1100;

let queue = Promise.resolve();

function enqueue(fn) {
  queue = queue.then(() => new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS))).then(fn);
  return queue;
}

function deriveLocationId(displayName, addressType, address) {
  const countryCode = address?.country_code?.toUpperCase();
  const state = address?.state;
  const city = address?.city || address?.town || address?.village;

  if (!countryCode) return null;

  if (addressType === 'country') return countryCode;
  if (state && !city) return `${countryCode}-${state.slice(0, 3).toUpperCase()}`;
  if (city) return `${countryCode}-${city.slice(0, 4).toUpperCase()}`;
  return countryCode;
}

function deriveLevel(addressType, address) {
  if (addressType === 'country') return 'country';
  const city = address?.city || address?.town || address?.village;
  if (city) return 'city';
  return 'region';
}

function deriveParentId(level, address) {
  const countryCode = address?.country_code?.toUpperCase();
  const state = address?.state;
  if (!countryCode) return null;
  if (level === 'country') return null;
  if (level === 'city' && state) return `${countryCode}-${state.slice(0, 3).toUpperCase()}`;
  return countryCode;
}

export async function geocode(locationName) {
  if (!locationName || locationName === 'Unknown') return null;

  const key = locationName.toLowerCase().trim();
  if (cache.has(key)) return cache.get(key);

  return enqueue(async () => {
    try {
      const response = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: {
          q: locationName,
          format: 'json',
          limit: 1,
          addressdetails: 1,
        },
        headers: {
          'User-Agent': 'HantaTracker/1.0 (anirban.j.gupta@gmail.com)',
        },
        timeout: 10000,
      });

      const results = response.data;
      if (!results || results.length === 0) {
        cache.set(key, null);
        return null;
      }

      const hit = results[0];
      const address = hit.address || {};
      const addressType = hit.addresstype || hit.type || '';
      const lat = parseFloat(hit.lat);
      const lng = parseFloat(hit.lon);

      const location_id = deriveLocationId(hit.display_name, addressType, address);
      if (!location_id) {
        cache.set(key, null);
        return null;
      }

      const level = deriveLevel(addressType, address);
      const parent_id = deriveParentId(level, address);

      const result = { lat, lng, location_id, level, parent_id };
      cache.set(key, result);
      return result;
    } catch (err) {
      console.warn(`[geocoder] Failed to geocode "${locationName}":`, err.message);
      cache.set(key, null);
      return null;
    }
  });
}

export default { geocode };
