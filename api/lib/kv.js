const KV_PREFIX = 'hanta:';
const DEFAULT_TTL = 5 * 60; // 5 minutes in seconds

let kv = null;
let kvReady = false;

// Check if we're on Vercel
const isVercel = process.env.VERCEL === '1';

// Try to load KV module if on Vercel
if (isVercel) {
  try {
    const kvModule = require('@vercel/kv');
    kv = kvModule.kv || kvModule.default;
    kvReady = true;
    console.log('[KV] Vercel KV loaded');
  } catch (e) {
    console.log('[KV] KV module not available, using fallback');
  }
}

export async function getDataFromKV(key) {
  if (!kv || !kvReady) return null;

  try {
    const value = await kv.get(`${KV_PREFIX}${key}`);
    return value;
  } catch (err) {
    console.error(`[KV] Error reading ${key}:`, err.message);
    return null;
  }
}

export async function setDataWithTTL(key, value, ttlSeconds = DEFAULT_TTL) {
  if (!kv || !kvReady) return false;

  try {
    await kv.setex(`${KV_PREFIX}${key}`, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(`[KV] Error writing ${key}:`, err.message);
    return false;
  }
}

export async function deleteFromKV(key) {
  if (!kv || !kvReady) return false;

  try {
    await kv.del(`${KV_PREFIX}${key}`);
    return true;
  } catch (err) {
    console.error(`[KV] Error deleting ${key}:`, err.message);
    return false;
  }
}

export async function clearAllCache() {
  if (!kv || !kvReady) return false;

  try {
    const keys = ['cases', 'news', 'guidelines', 'meta'];
    await Promise.all(keys.map(k => deleteFromKV(k)));
    return true;
  } catch (err) {
    console.error('[KV] Error clearing cache:', err.message);
    return false;
  }
}
