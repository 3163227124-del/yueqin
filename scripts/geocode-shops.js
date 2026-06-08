const fs = require('fs/promises');
const path = require('path');

const DATA_PATH = path.join('data', 'shops.beijing.json');
const OVERRIDES_PATH = path.join('data', 'geocode-overrides.json');
const CACHE_PATH = path.join('work', 'amap-cache.json');
const AMAP_BASE = 'https://restapi.amap.com';
const DEFAULT_CITY = '北京';
const REQUEST_DELAY_MS = Number(process.env.AMAP_GEOCODE_DELAY_MS || 180);
const MAX_RETRIES = Number(process.env.AMAP_GEOCODE_RETRIES || 2);

const LEVEL_SCORES = {
  门牌号: 36,
  门址: 36,
  兴趣点: 34,
  热点商圈: 26,
  交叉路口: 22,
  道路: 18,
  村庄: 12,
  区县: 8,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function geocodeKey(query) {
  return `beijing:${String(query || '').trim()}`;
}

function normalizeLocation(value) {
  if (!value) return null;
  const [lng, lat] = String(value).split(',').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function expectedAdcode(shop) {
  return String(shop.countyCode || '').slice(0, 6);
}

function compactAddress(value) {
  return String(value || '').replace(/[北京市区县()（）·\s]/g, '');
}

function scoreCandidate(shop, candidate) {
  const formatted = String(candidate.formatted_address || '');
  const countyName = String(shop.countyName || '');
  const countyShort = countyName.replace(/区|县$/, '');
  const adcode = String(candidate.adcode || '');
  const expected = expectedAdcode(shop);
  const level = String(candidate.level || '');
  const location = normalizeLocation(candidate.location);
  if (!location) return -Infinity;

  let score = LEVEL_SCORES[level] || 16;
  if (expected && adcode === expected) score += 80;
  if (countyName && formatted.includes(countyName)) score += 18;
  if (countyShort && formatted.includes(countyShort)) score += 8;

  const formattedCompact = compactAddress(formatted);
  const nameCompact = compactAddress(shop.name);
  const addressCompact = compactAddress(shop.address);
  if (nameCompact && formattedCompact.includes(nameCompact.slice(0, Math.min(6, nameCompact.length)))) {
    score += 10;
  }
  if (addressCompact && formattedCompact.includes(addressCompact.slice(0, Math.min(8, addressCompact.length)))) {
    score += 10;
  }

  return score;
}

function normalizeGeocode(shop, query, candidate) {
  const location = normalizeLocation(candidate.location);
  const expected = expectedAdcode(shop);
  const adcode = String(candidate.adcode || '');
  const matchQuality = expected && adcode === expected ? 'district-match' : 'district-mismatch';

  return {
    ok: Boolean(location),
    query,
    formattedAddress: candidate.formatted_address || '',
    level: candidate.level || '',
    adcode,
    expectedAdcode: expected,
    matchQuality,
    warning: matchQuality === 'district-mismatch' ? 'district_mismatch' : null,
    location,
    provider: 'AMap Geocode',
    geocodedAt: new Date().toISOString(),
  };
}

function hydrateCachedGeocode(shop, geocode) {
  const expected = expectedAdcode(shop);
  const adcode = String(geocode.adcode || '');
  const matchQuality = expected && adcode === expected ? 'district-match' : 'district-mismatch';

  return {
    ...geocode,
    expectedAdcode: geocode.expectedAdcode || expected,
    matchQuality: geocode.matchQuality || matchQuality,
    warning: geocode.warning || (matchQuality === 'district-mismatch' ? 'district_mismatch' : null),
    geocodedAt: geocode.geocodedAt || new Date().toISOString(),
  };
}

function normalizeOverride(shop, override) {
  const expected = expectedAdcode(shop);
  const adcode = String(override.adcode || '');
  const matchQuality = expected && adcode === expected ? 'poi-district-match' : 'poi-district-mismatch';

  return {
    ok: true,
    query: shop.geocodeAddress,
    formattedAddress: override.formattedAddress || override.address || '',
    level: override.level || '兴趣点',
    adcode,
    expectedAdcode: expected,
    matchQuality,
    warning: matchQuality === 'poi-district-mismatch' ? 'district_mismatch' : null,
    location: override.location,
    provider: override.provider || 'AMap Place Text',
    poiId: override.poiId,
    poiName: override.poiName,
    overrideReason: override.reason,
    geocodedAt: new Date().toISOString(),
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function amapGeocode(apiKey, query) {
  const url = new URL('/v3/geocode/geo', AMAP_BASE);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('address', query);
  url.searchParams.set('city', DEFAULT_CITY);
  url.searchParams.set('output', 'json');

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await sleep(REQUEST_DELAY_MS * (attempt + 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (data.status === '1') return Array.isArray(data.geocodes) ? data.geocodes : [];

      const message = data.info || data.message || 'AMap geocode failed';
      if (!/QPS|LIMIT|UNKNOWN_ERROR|OVER/.test(message) || attempt === MAX_RETRIES) {
        throw new Error(message);
      }
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw error.name === 'AbortError' ? new Error('AMap geocode timed out') : error;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return [];
}

async function geocodeShop(apiKey, shop, cache) {
  const query = shop.geocodeAddress;
  const key = geocodeKey(query);
  if (cache.geocode?.[key]?.ok) {
    return hydrateCachedGeocode(shop, cache.geocode[key]);
  }

  const candidates = await amapGeocode(apiKey, query);
  if (!candidates.length) {
    return {
      ok: false,
      query,
      message: 'No geocode result',
      provider: 'AMap Geocode',
      geocodedAt: new Date().toISOString(),
    };
  }

  const best = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(shop, candidate) }))
    .sort((a, b) => b.score - a.score)[0].candidate;

  return normalizeGeocode(shop, query, best);
}

async function main() {
  const apiKey = process.env.AMAP_KEY;
  if (!apiKey) {
    throw new Error('Set AMAP_KEY in the environment before running this script.');
  }

  const dataset = await readJson(DATA_PATH);
  const overrides = await readJson(OVERRIDES_PATH, {});
  const cache = await readJson(CACHE_PATH, { geocode: {}, routes: {}, tips: {} });
  cache.geocode ||= {};
  cache.routes ||= {};
  cache.tips ||= {};

  let ok = 0;
  let failed = 0;
  let warnings = 0;

  for (let index = 0; index < dataset.shops.length; index += 1) {
    const shop = dataset.shops[index];
    try {
      const geocode = overrides[String(shop.id)]
        ? normalizeOverride(shop, overrides[String(shop.id)])
        : await geocodeShop(apiKey, shop, cache);
      cache.geocode[geocodeKey(shop.geocodeAddress)] = geocode;
      shop.geocode = geocode;
      if (geocode.ok) {
        shop.location = geocode.location;
        ok += 1;
        if (geocode.warning) warnings += 1;
      } else {
        delete shop.location;
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      shop.geocode = {
        ok: false,
        query: shop.geocodeAddress,
        message: error.message,
        provider: 'AMap Geocode',
        geocodedAt: new Date().toISOString(),
      };
    }

    if ((index + 1) % 10 === 0 || index === dataset.shops.length - 1) {
      console.log(`${index + 1}/${dataset.shops.length} located=${ok} failed=${failed} warnings=${warnings}`);
    }
  }

  dataset.counts.located = dataset.shops.filter((shop) => shop.location).length;
  dataset.geocoding = {
    provider: 'AMap Geocode',
    generatedAt: new Date().toISOString(),
    located: ok,
    failed,
    warnings,
  };

  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  await fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');

  console.log(`Done. Located ${ok}, failed ${failed}, warnings ${warnings}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
