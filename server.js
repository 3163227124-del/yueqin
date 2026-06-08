const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const { CITIES, cityBySlug } = require('./lib/cities');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CACHE_PATH = path.join(ROOT, 'work', 'amap-cache.json');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const AMAP_BASE = 'https://restapi.amap.com';
const AMAP_MIN_DELAY_MS = Number(process.env.AMAP_MIN_DELAY_MS || 120);
const ROUTE_CACHE_VERSION = 'route-v2';

let activeAmapKey = process.env.AMAP_KEY || '';
let cache = { geocode: {}, routes: {}, tips: {} };
let cacheLoaded = false;
let amapSlot = Promise.resolve(Date.now());

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details) {
  sendJson(res, status, { ok: false, message, details });
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1024 * 1024) {
      throw new Error('Request body is too large.');
    }
  }
  return raw ? JSON.parse(raw) : {};
}

async function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    cache = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
    cache.geocode ||= {};
    cache.routes ||= {};
    cache.tips ||= {};
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not read cache: ${error.message}`);
    }
  }
}

let saveTimer = null;
function scheduleCacheSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await fsp.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    await fsp.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  }, 250);
}

function requireAmapKey(res) {
  if (!activeAmapKey) {
    sendError(res, 400, 'AMap API key is not set.');
    return false;
  }
  return true;
}

function publicCity(city) {
  return {
    slug: city.slug,
    name: city.name,
    shortName: city.shortName,
    code: city.code,
    provinceCode: city.provinceCode,
    center: city.center,
  };
}

function cityFromRequest(reqUrl, body = {}) {
  return cityBySlug(body.city || reqUrl.searchParams.get('city') || 'beijing');
}

async function loadDataset(city) {
  const dataset = JSON.parse(await fsp.readFile(path.join(ROOT, city.dataFile), 'utf8'));
  await loadCache();

  const shops = dataset.shops.map((shop) => {
    const geocode = cache.geocode[geocodeKey(city.slug, shop.geocodeAddress)];
    return geocode?.ok ? { ...shop, location: geocode.location, geocode } : shop;
  });

  return { ...dataset, shops };
}

function geocodeKey(citySlug, query) {
  return `${citySlug}:${String(query || '').trim()}`;
}

function routeKey(citySlug, mode, origin, destination) {
  return [
    ROUTE_CACHE_VERSION,
    citySlug,
    mode,
    Number(origin.lng).toFixed(5),
    Number(origin.lat).toFixed(5),
    Number(destination.lng).toFixed(5),
    Number(destination.lat).toFixed(5),
  ].join(':');
}

function normalizeLocation(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const [lng, lat] = value.split(',').map(Number);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
    return null;
  }

  const lng = Number(value.lng);
  const lat = Number(value.lat);
  if (Number.isFinite(lng) && Number.isFinite(lat)) {
    return { lng, lat };
  }

  return null;
}

function formatLocation(point) {
  return `${Number(point.lng).toFixed(6)},${Number(point.lat).toFixed(6)}`;
}

function parsePolyline(polyline) {
  if (!polyline || typeof polyline !== 'string') return [];
  return polyline
    .split(';')
    .map((pair) => {
      const [lng, lat] = pair.split(',').map(Number);
      return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
    })
    .filter(Boolean);
}

function metersLabel(value) {
  const meters = Number(value || 0);
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters)}m`;
}

function compactInstruction(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAmapSlot() {
  let release;
  const previous = amapSlot;
  amapSlot = new Promise((resolve) => {
    release = resolve;
  });

  const availableAt = await previous;
  const delay = Math.max(0, availableAt - Date.now());
  if (delay) await sleep(delay);
  release(Date.now() + AMAP_MIN_DELAY_MS);
}

async function amapFetch(endpoint, params, timeoutMs = 18000) {
  const url = new URL(endpoint, AMAP_BASE);
  Object.entries({ ...params, key: activeAmapKey }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  await waitForAmapSlot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`AMap HTTP ${response.status}`);
    }
    if (data.status && data.status !== '1') {
      throw new Error(data.info || data.message || 'AMap request failed.');
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('AMap request timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDrivingOrWalking(mode, data) {
  const paths = Array.isArray(data.route?.paths) ? data.route.paths : [];
  const alternatives = paths.map((pathItem, index) => {
    const rawSteps = Array.isArray(pathItem.steps) ? pathItem.steps : [];
    const steps = rawSteps.map((step, stepIndex) => ({
      type: mode,
      index: stepIndex,
      text: compactInstruction(step.instruction || step.road || step.action),
      distance: Number(step.distance || 0),
      duration: Number(step.duration || 0),
      polyline: parsePolyline(step.polyline),
    }));

    return {
      index,
      duration: Number(pathItem.duration || 0),
      distance: Number(pathItem.distance || 0),
      cost: Number(pathItem.tolls || 0),
      summary: steps.map((step) => step.text).filter(Boolean).slice(0, 5),
      details: steps
        .filter((step) => step.text)
        .map((step) => ({
          type: step.type,
          text: step.text,
          distance: step.distance,
          duration: step.duration,
        })),
      hasTaxi: false,
      polyline: steps.flatMap((step) => step.polyline),
    };
  });

  alternatives.sort((a, b) => a.duration - b.duration);
  return {
    mode,
    provider: 'AMap Web Service',
    best: alternatives[0] || null,
    alternatives: alternatives.slice(0, 3),
  };
}

function summarizeTransitSegment(segment) {
  const parts = [];
  const walkingDistance = Number(segment.walking?.distance || 0);
  if (walkingDistance > 0) parts.push(`步行${metersLabel(walkingDistance)}`);

  const buslines = Array.isArray(segment.bus?.buslines) ? segment.bus.buslines : [];
  const busline = buslines[0];
  if (busline?.name) parts.push(busline.name);

  if (segment.railway?.name) parts.push(segment.railway.name);
  if (segment.taxi && Object.keys(segment.taxi).length) parts.push('打车');
  return parts.join(' -> ');
}

function transitPolyline(segment) {
  const points = [];
  const walkingSteps = Array.isArray(segment.walking?.steps) ? segment.walking.steps : [];
  for (const step of walkingSteps) {
    points.push(...parsePolyline(step.polyline));
  }
  const buslines = Array.isArray(segment.bus?.buslines) ? segment.bus.buslines : [];
  for (const busline of buslines) {
    points.push(...parsePolyline(busline.polyline));
  }
  if (Array.isArray(segment.railway?.spaces)) {
    for (const space of segment.railway.spaces) {
      points.push(...parsePolyline(space.polyline));
    }
  }
  return points;
}

function stopName(stop) {
  return stop?.name || stop?.stop_name || '';
}

function transitTaxiText(taxi) {
  const duration = Number(taxi.duration || 0);
  const distance = Number(taxi.distance || 0);
  const pieces = ['打车'];
  if (distance) pieces.push(metersLabel(distance));
  if (duration) pieces.push(`${Math.round(duration / 60)}分钟`);
  return pieces.join(' ');
}

function normalizeTransitDetails(segment, index) {
  const details = [];
  const walkingDistance = Number(segment.walking?.distance || 0);
  const walkingDuration = Number(segment.walking?.duration || 0);
  if (walkingDistance > 0) {
    details.push({
      type: 'walk',
      index,
      text: `步行 ${metersLabel(walkingDistance)}`,
      distance: walkingDistance,
      duration: walkingDuration,
    });
  }

  const buslines = Array.isArray(segment.bus?.buslines) ? segment.bus.buslines : [];
  for (const busline of buslines) {
    const departure = stopName(busline.departure_stop);
    const arrival = stopName(busline.arrival_stop);
    const via = Number(busline.via_num || 0);
    const viaText = via ? `，${via}站` : '';
    const stopText = departure || arrival ? `：${departure || '?'} -> ${arrival || '?'}` : '';
    details.push({
      type: /地铁|轨道|Subway/i.test(busline.type || busline.name || '') ? 'subway' : 'bus',
      index,
      text: `${busline.name || '公交'}${stopText}${viaText}`,
      distance: Number(busline.distance || 0),
      duration: Number(busline.duration || 0),
    });
  }

  const railway = segment.railway;
  if (railway?.name) {
    details.push({
      type: 'railway',
      index,
      text: `铁路 ${railway.name}`,
      distance: Number(railway.distance || 0),
      duration: Number(railway.time || railway.duration || 0),
    });
  }

  const taxi = segment.taxi;
  if (taxi && Object.keys(taxi).length) {
    details.push({
      type: 'taxi',
      index,
      text: transitTaxiText(taxi),
      distance: Number(taxi.distance || 0),
      duration: Number(taxi.duration || 0),
    });
  }

  return details;
}

function normalizeTransit(data) {
  const transits = Array.isArray(data.route?.transits) ? data.route.transits : [];
  const alternatives = transits.map((transit, index) => {
    const segments = Array.isArray(transit.segments) ? transit.segments : [];
    const details = segments.flatMap((segment, segmentIndex) => normalizeTransitDetails(segment, segmentIndex));
    return {
      index,
      duration: Number(transit.duration || 0),
      distance: Number(transit.distance || 0),
      walkingDistance: Number(transit.walking_distance || 0),
      cost: Number(transit.cost || 0),
      summary: segments.map(summarizeTransitSegment).filter(Boolean).slice(0, 8),
      details,
      hasTaxi: details.some((detail) => detail.type === 'taxi'),
      polyline: segments.flatMap(transitPolyline),
    };
  });

  alternatives.sort((a, b) => a.duration - b.duration);
  return {
    mode: 'transit',
    provider: 'AMap Web Service',
    best: alternatives[0] || null,
    alternatives: alternatives.slice(0, 3),
  };
}

async function handleTips(reqUrl, res) {
  if (!requireAmapKey(res)) return;
  const city = cityFromRequest(reqUrl);
  const keywords = reqUrl.searchParams.get('keywords') || reqUrl.searchParams.get('q') || '';
  if (!keywords.trim()) {
    sendJson(res, 200, { ok: true, tips: [] });
    return;
  }

  await loadCache();
  const key = `${city.slug}:${keywords.trim()}`;
  if (cache.tips[key]) {
    sendJson(res, 200, { ok: true, cached: true, tips: cache.tips[key] });
    return;
  }

  const data = await amapFetch('/v3/assistant/inputtips', {
    keywords,
    city: city.shortName,
    citylimit: true,
    datatype: 'all',
  });

  const tipsRaw = Array.isArray(data.tips) ? data.tips : [];
  const tips = tipsRaw
    .filter((tip) => tip.location && typeof tip.location === 'string')
    .slice(0, 8)
    .map((tip) => ({
      id: tip.id || `${tip.name}-${tip.location}`,
      name: tip.name,
      district: tip.district,
      address: Array.isArray(tip.address) ? tip.district : tip.address,
      location: normalizeLocation(tip.location),
    }))
    .filter((tip) => tip.location);

  cache.tips[key] = tips;
  scheduleCacheSave();
  sendJson(res, 200, { ok: true, tips });
}

async function handleGeocode(req, res) {
  if (!requireAmapKey(res)) return;
  const body = await readBody(req);
  const city = cityFromRequest(new URL(req.url, `http://${req.headers.host || 'localhost'}`), body);
  const dataset = await loadDataset(city);
  const shop = body.shopId ? dataset.shops.find((item) => item.id === Number(body.shopId)) : null;
  const query = String(body.query || shop?.geocodeAddress || '').trim();

  if (!query) {
    sendError(res, 400, 'Missing geocode query.');
    return;
  }

  await loadCache();
  const key = geocodeKey(city.slug, query);
  if (cache.geocode[key]) {
    sendJson(res, 200, { ok: true, cached: true, geocode: cache.geocode[key] });
    return;
  }

  const data = await amapFetch('/v3/geocode/geo', {
    address: query,
    city: city.shortName,
  }, 12000);

  const geocodes = Array.isArray(data.geocodes) ? data.geocodes : [];
  const candidate = geocodes[0];
  if (!candidate?.location) {
    const miss = { ok: false, query, message: 'No geocode result.' };
    cache.geocode[key] = miss;
    scheduleCacheSave();
    sendJson(res, 200, { ok: false, geocode: miss });
    return;
  }

  const geocode = {
    ok: true,
    query,
    formattedAddress: candidate.formatted_address,
    level: candidate.level,
    adcode: candidate.adcode,
    location: normalizeLocation(candidate.location),
    provider: 'AMap Geocode',
  };

  cache.geocode[key] = geocode;
  scheduleCacheSave();
  sendJson(res, 200, { ok: true, geocode });
}

async function handleRoute(req, res) {
  if (!requireAmapKey(res)) return;
  const body = await readBody(req);
  const city = cityBySlug(body.city || 'beijing');
  const mode = String(body.mode || 'transit');
  const origin = normalizeLocation(body.origin);
  const destination = normalizeLocation(body.destination);

  if (!['transit', 'driving', 'walking'].includes(mode)) {
    sendError(res, 400, 'Unsupported route mode.');
    return;
  }
  if (!origin || !destination) {
    sendError(res, 400, 'Origin and destination must include lng/lat.');
    return;
  }

  await loadCache();
  const key = routeKey(city.slug, mode, origin, destination);
  if (cache.routes[key]) {
    sendJson(res, 200, { ok: true, cached: true, route: cache.routes[key] });
    return;
  }

  const common = {
    origin: formatLocation(origin),
    destination: formatLocation(destination),
    extensions: 'all',
  };

  let data;
  let route;
  if (mode === 'transit') {
    data = await amapFetch('/v3/direction/transit/integrated', {
      ...common,
      city: city.shortName,
      cityd: city.shortName,
      strategy: body.strategy ?? 0,
      nightflag: 0,
    }, 26000);
    route = normalizeTransit(data);
  } else if (mode === 'driving') {
    data = await amapFetch('/v3/direction/driving', {
      ...common,
      strategy: body.strategy ?? 10,
    }, 22000);
    route = normalizeDrivingOrWalking(mode, data);
  } else {
    data = await amapFetch('/v3/direction/walking', common, 18000);
    route = normalizeDrivingOrWalking(mode, data);
  }

  route.origin = origin;
  route.destination = destination;
  route.fetchedAt = new Date().toISOString();
  cache.routes[key] = route;
  scheduleCacheSave();
  sendJson(res, 200, { ok: true, route });
}

async function handleShops(reqUrl, res) {
  const city = cityFromRequest(reqUrl);
  const dataset = await loadDataset(city);
  sendJson(res, 200, { ok: true, dataset });
}

async function handleApi(req, res, reqUrl) {
  try {
    if (req.method === 'GET' && reqUrl.pathname === '/api/config') {
      const city = cityFromRequest(reqUrl);
      const dataset = JSON.parse(await fsp.readFile(path.join(ROOT, city.dataFile), 'utf8'));
      sendJson(res, 200, {
        ok: true,
        city: dataset.city,
        cities: CITIES.map(publicCity),
        counts: dataset.counts,
        hasAmapKey: Boolean(activeAmapKey),
        keySource: activeAmapKey ? (process.env.AMAP_KEY ? 'env' : 'session') : null,
      });
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/api/key') {
      const body = await readBody(req);
      activeAmapKey = String(body.apiKey || '').trim();
      sendJson(res, 200, { ok: true, hasAmapKey: Boolean(activeAmapKey) });
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/api/shops') {
      await handleShops(reqUrl, res);
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/api/tips') {
      await handleTips(reqUrl, res);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/api/geocode') {
      await handleGeocode(req, res);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/api/route') {
      await handleRoute(req, res);
      return;
    }

    sendError(res, 404, 'API route not found.');
  } catch (error) {
    const status = /AMap API key|Missing|Unsupported|must include/.test(error.message) ? 400 : 502;
    sendError(res, status, error.message);
  }
}

function serveStatic(req, res, reqUrl) {
  let pathname = decodeURIComponent(reqUrl.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (reqUrl.pathname.startsWith('/api/')) {
    await handleApi(req, res, reqUrl);
    return;
  }
  serveStatic(req, res, reqUrl);
});

server.listen(PORT, HOST, () => {
  console.log(`Arcade commute finder running at http://${HOST}:${PORT}`);
  console.log('Set AMAP_KEY before start, or enter it in the app.');
});
