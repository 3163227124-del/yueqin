(function () {
  const MODE_LABELS = {
    transit: '公交',
    driving: '驾车',
    walking: '步行',
  };

  const PERSON_COLORS = {
    a: '#c2415b',
    b: '#2b8a3e',
  };

  function readSessionAmapKey() {
    try {
      return window.sessionStorage.getItem('amapKey') || '';
    } catch {
      return '';
    }
  }

  function storeSessionAmapKey(apiKey) {
    try {
      window.sessionStorage.setItem('amapKey', apiKey);
    } catch {
      // Session storage is a convenience only; routing still works for the current request.
    }
  }

  const COUNTY_CENTERS = {
    '110101000000': { lng: 116.4164, lat: 39.9289 },
    '110102000000': { lng: 116.3659, lat: 39.9123 },
    '110105000000': { lng: 116.4864, lat: 39.9215 },
    '110106000000': { lng: 116.2869, lat: 39.8584 },
    '110107000000': { lng: 116.1954, lat: 39.9146 },
    '110108000000': { lng: 116.2981, lat: 39.9599 },
    '110109000000': { lng: 116.1018, lat: 39.9404 },
    '110111000000': { lng: 116.1433, lat: 39.7489 },
    '110112000000': { lng: 116.6564, lat: 39.9099 },
    '110113000000': { lng: 116.6542, lat: 40.1302 },
    '110114000000': { lng: 116.2312, lat: 40.2207 },
    '110115000000': { lng: 116.3413, lat: 39.7269 },
    '110116000000': { lng: 116.6318, lat: 40.316 },
    '110117000000': { lng: 117.1214, lat: 40.1406 },
    '110118000000': { lng: 116.8434, lat: 40.3774 },
    '110119000000': { lng: 115.9749, lat: 40.4569 },
  };

  const state = {
    config: null,
    cities: [],
    city: 'beijing',
    shops: [],
    origins: { a: null, b: null },
    map: null,
    AMap: null,
    markers: new Map(),
    originMarkers: {},
    routeLines: [],
    results: [],
    selectedShopId: null,
    amapKeyForBrowser: readSessionAmapKey(),
  };

  const el = {
    keyForm: document.getElementById('keyForm'),
    citySelect: document.getElementById('citySelect'),
    cityTabs: document.getElementById('cityTabs'),
    apiKey: document.getElementById('apiKey'),
    keyStatus: document.getElementById('keyStatus'),
    dataSummary: document.getElementById('dataSummary'),
    personA: document.getElementById('personA'),
    personB: document.getElementById('personB'),
    personASuggestions: document.getElementById('personASuggestions'),
    personBSuggestions: document.getElementById('personBSuggestions'),
    personAReadout: document.getElementById('personAReadout'),
    personBReadout: document.getElementById('personBReadout'),
    primaryMode: document.getElementById('primaryMode'),
    scanScope: document.getElementById('scanScope'),
    maxMinutes: document.getElementById('maxMinutes'),
    includeUnavailable: document.getElementById('includeUnavailable'),
    locateShops: document.getElementById('locateShops'),
    recommend: document.getElementById('recommend'),
    progressText: document.getElementById('progressText'),
    progressCount: document.getElementById('progressCount'),
    progressBar: document.getElementById('progressBar'),
    resultsList: document.getElementById('resultsList'),
    resultCount: document.getElementById('resultCount'),
    metricShops: document.getElementById('metricShops'),
    metricLocated: document.getElementById('metricLocated'),
  };

  function api(path, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data.message || `请求失败 ${response.status}`);
      }
      return data;
    }).catch((error) => {
      if (error.name === 'AbortError') {
        throw new Error('请求超时，已跳过');
      }
      throw error;
    }).finally(() => {
      clearTimeout(timer);
    });
  }

  function debounce(fn, delay = 220) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function setProgress(text, done = 0, total = 0) {
    el.progressText.textContent = text;
    el.progressCount.textContent = `${done}/${total}`;
    el.progressBar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0';
  }

  function formatMinutes(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '无结果';
    return `${Math.round(seconds / 60)} 分`;
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters) || meters <= 0) return '';
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
  }

  function statusLabel(status) {
    if (status === 'upcoming') return '未开业';
    if (status === 'closed') return '暂停';
    return '可约';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[char]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/\n/g, '&#10;');
  }

  function locationText(point) {
    if (!point) return '未选择';
    return `${point.label || point.name} · ${Number(point.lng).toFixed(5)}, ${Number(point.lat).toFixed(5)}`;
  }

  function routeTime(result, person, mode) {
    return result.routes?.[mode]?.[person]?.best?.duration;
  }

  function updateMetrics() {
    const located = state.shops.filter((shop) => shop.location).length;
    el.metricShops.textContent = state.shops.length;
    el.metricLocated.textContent = located;
  }

  function selectedModes() {
    const modes = Array.from(document.querySelectorAll('input[name="mode"]:checked')).map((item) => item.value);
    if (!modes.includes(el.primaryMode.value)) modes.unshift(el.primaryMode.value);
    return Array.from(new Set(modes));
  }

  function scanScopeValue() {
    const scope = Number(el.scanScope.value);
    return Number.isFinite(scope) ? scope : 36;
  }

  async function init() {
    wireEvents();
    await restoreSessionKey();
    await loadConfig();
    await loadShops();
    renderResults([]);
    setProgress('待开始', 0, 0);
    if (state.amapKeyForBrowser) {
      ensureMap().catch((error) => setProgress(error.message, 0, 0));
    }
  }

  async function restoreSessionKey() {
    if (!state.amapKeyForBrowser) return;
    el.apiKey.value = state.amapKeyForBrowser;
    await api('/api/key', {
      method: 'POST',
      body: JSON.stringify({ apiKey: state.amapKeyForBrowser }),
    }).catch(() => {});
  }

  async function loadConfig() {
    state.config = await api(`/api/config?city=${encodeURIComponent(state.city)}`);
    state.cities = state.config.cities || [state.config.city];
    renderCitySelect();
    if (state.config.hasAmapKey) {
      el.keyStatus.textContent = state.config.keySource === 'env' ? '服务端 key 已就绪' : '高德已连接';
      el.keyStatus.classList.add('ready');
    } else {
      el.keyStatus.textContent = '未连接高德';
      el.keyStatus.classList.remove('ready');
    }
  }

  async function loadShops() {
    const { dataset } = await api(`/api/shops?city=${encodeURIComponent(state.city)}`);
    state.shops = dataset.shops;
    state.config.city = dataset.city;
    el.dataSummary.textContent = `${dataset.city.name} · ${dataset.counts.shops} 家，默认推荐 ${dataset.counts.available} 家可约地点`;
    if (state.map) {
      state.map.setZoomAndCenter(10, dataset.city.center);
      clearRoutes();
      clearMarkers();
      renderShopMarkers();
    }
    updateMetrics();
  }

  function renderCitySelect() {
    el.citySelect.innerHTML = state.cities.map((city) => `
      <option value="${city.slug}" ${city.slug === state.city ? 'selected' : ''}>${escapeHtml(city.shortName || city.name)}</option>
    `).join('');
    el.cityTabs.innerHTML = state.cities.map((city) => `
      <button class="city-tab ${city.slug === state.city ? 'active' : ''}" type="button" data-city="${city.slug}" aria-pressed="${city.slug === state.city}">
        ${escapeHtml(city.shortName || city.name)}
      </button>
    `).join('');
  }

  function wireEvents() {
    el.keyForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const apiKey = el.apiKey.value.trim();
      if (!apiKey) return;
      await api('/api/key', {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
      });
      state.amapKeyForBrowser = apiKey;
      storeSessionAmapKey(apiKey);
      el.keyStatus.textContent = '高德已连接';
      el.keyStatus.classList.add('ready');
      await ensureMap();
    });

    setupSearch(el.personA, el.personASuggestions, 'a');
    setupSearch(el.personB, el.personBSuggestions, 'b');

    el.citySelect.addEventListener('change', async () => changeCity(el.citySelect.value));
    el.cityTabs.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-city]');
      if (!button) return;
      await changeCity(button.dataset.city);
    });

    el.locateShops.addEventListener('click', async () => {
      await ensureMap();
      await geocodeShops(getCandidateShops());
      renderShopMarkers();
    });

    el.recommend.addEventListener('click', runRecommendation);
  }

  async function changeCity(citySlug) {
    if (!citySlug || citySlug === state.city) return;
    state.city = citySlug;
    resetForCityChange();
    await loadConfig();
    await loadShops();
    renderResults([]);
    setProgress('待开始', 0, 0);
  }

  function setupSearch(input, container, person) {
    const run = debounce(async () => {
      const keywords = input.value.trim();
      if (!keywords) {
        container.style.display = 'none';
        return;
      }

      try {
        const { tips } = await api(`/api/tips?city=${encodeURIComponent(state.city)}&keywords=${encodeURIComponent(keywords)}`);
        renderSuggestions(container, tips, person);
      } catch (error) {
        container.innerHTML = `<button class="suggestion" type="button"><strong>${escapeHtml(error.message)}</strong></button>`;
        container.style.display = 'block';
      }
    });

    input.addEventListener('input', run);
    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        await geocodeFreeText(input.value, person);
      }
    });
  }

  function renderSuggestions(container, tips, person) {
    if (!tips.length) {
      container.style.display = 'none';
      return;
    }

    container.innerHTML = tips.map((tip, index) => `
      <button class="suggestion" type="button" data-index="${index}">
        <strong>${escapeHtml(tip.name)}</strong>
        <span>${escapeHtml([tip.district, tip.address].filter(Boolean).join(' '))}</span>
      </button>
    `).join('');

    container.querySelectorAll('.suggestion').forEach((button) => {
      button.addEventListener('click', async () => {
        const tip = tips[Number(button.dataset.index)];
        setOrigin(person, {
          label: tip.name,
          address: [tip.district, tip.address].filter(Boolean).join(' '),
          lng: tip.location.lng,
          lat: tip.location.lat,
        });
        container.style.display = 'none';
        await ensureMap();
      });
    });

    container.style.display = 'block';
  }

  async function geocodeFreeText(value, person) {
    const query = String(value || '').trim();
    if (!query) return;
    const { geocode } = await api('/api/geocode', {
      method: 'POST',
      body: JSON.stringify({ city: state.city, query: `${currentCityName()}${query}` }),
    }, 16000);
    if (!geocode?.ok) throw new Error('起点无法定位');
    setOrigin(person, {
      label: query,
      address: geocode.formattedAddress,
      lng: geocode.location.lng,
      lat: geocode.location.lat,
    });
    await ensureMap();
  }

  function setOrigin(person, point) {
    state.origins[person] = point;
    if (person === 'a') {
      el.personA.value = point.label;
      el.personAReadout.textContent = locationText(point);
    } else {
      el.personB.value = point.label;
      el.personBReadout.textContent = locationText(point);
    }
    renderOriginMarker(person);
  }

  async function ensureMap() {
    if (state.map) return;
    const key = state.amapKeyForBrowser || el.apiKey.value.trim();
    if (!key) {
      throw new Error('请先连接高德 API key');
    }

    await loadAmapScript(key);
    state.AMap = window.AMap;
    state.map = new state.AMap.Map('map', {
      center: state.config?.city?.center || [116.397428, 39.90923],
      zoom: 10,
      resizeEnable: true,
      viewMode: '2D',
      mapStyle: 'amap://styles/normal',
    });
    state.map.addControl(new state.AMap.Scale());
    state.map.addControl(new state.AMap.ToolBar({ position: { right: '16px', top: '16px' } }));
    renderShopMarkers();
    renderOriginMarker('a');
    renderOriginMarker('b');
  }

  function loadAmapScript(key) {
    if (window.AMap) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Scale,AMap.ToolBar`;
      script.onload = resolve;
      script.onerror = () => reject(new Error('高德地图脚本加载失败'));
      document.head.appendChild(script);
    });
  }

  function markerContent(label, className = '') {
    return `<div class="marker-dot ${className}">${escapeHtml(label)}</div>`;
  }

  function renderOriginMarker(person) {
    if (!state.map || !state.origins[person]) return;
    const point = state.origins[person];
    const label = person.toUpperCase();
    if (state.originMarkers[person]) {
      state.originMarkers[person].setPosition([point.lng, point.lat]);
      return;
    }

    state.originMarkers[person] = new state.AMap.Marker({
      position: [point.lng, point.lat],
      content: markerContent(label, `origin-${person}`),
      offset: new state.AMap.Pixel(-15, -15),
      zIndex: 200,
    });
    state.map.add(state.originMarkers[person]);
  }

  function renderShopMarkers() {
    if (!state.map) return;

    for (const [id, marker] of state.markers.entries()) {
      const shop = state.shops.find((item) => item.id === id);
      if (!shop?.location) {
        state.map.remove(marker);
        state.markers.delete(id);
      }
    }

    state.shops.filter((shop) => shop.location).forEach((shop) => {
      const rank = state.results.findIndex((result) => result.shop.id === shop.id);
      const label = rank >= 0 && rank < 9 ? String(rank + 1) : '厅';
      const className = shop.status === 'open' ? '' : 'closed';

      if (state.markers.has(shop.id)) {
        const marker = state.markers.get(shop.id);
        marker.setPosition([shop.location.lng, shop.location.lat]);
        marker.setContent(markerContent(label, className));
        return;
      }

      const marker = new state.AMap.Marker({
        position: [shop.location.lng, shop.location.lat],
        content: markerContent(label, className),
        offset: new state.AMap.Pixel(-15, -15),
        zIndex: shop.status === 'open' ? 80 : 60,
      });
      marker.on('click', () => selectShop(shop.id));
      state.map.add(marker);
      state.markers.set(shop.id, marker);
    });

    const points = [
      ...state.shops.filter((shop) => shop.location).map((shop) => [shop.location.lng, shop.location.lat]),
      ...Object.values(state.origins).filter(Boolean).map((point) => [point.lng, point.lat]),
    ];
    if (points.length) {
      state.map.setFitView(null, false, [70, 70, 70, 70]);
    }
    updateMetrics();
  }

  function clearMarkers() {
    if (!state.map) return;
    if (state.markers.size) {
      state.map.remove(Array.from(state.markers.values()));
      state.markers.clear();
    }
    for (const marker of Object.values(state.originMarkers)) {
      if (marker) state.map.remove(marker);
    }
    state.originMarkers = {};
  }

  function resetForCityChange() {
    state.shops = [];
    state.results = [];
    state.selectedShopId = null;
    state.origins = { a: null, b: null };
    el.personA.value = '';
    el.personB.value = '';
    el.personAReadout.textContent = '未选择';
    el.personBReadout.textContent = '未选择';
    el.personASuggestions.style.display = 'none';
    el.personBSuggestions.style.display = 'none';
    clearRoutes();
    clearMarkers();
  }

  function getCandidateShops() {
    return state.shops.filter((shop) => el.includeUnavailable.checked || shop.isAvailable);
  }

  async function geocodeShops(shops, options = {}) {
    const missing = orderShopsForGeocode(shops.filter((shop) => !shop.location));
    if (!missing.length) return { total: 0, located: shops.filter((shop) => shop.location).length, failed: 0 };
    const label = options.label || '定位店铺';
    const targetLocated = options.targetLocated || Infinity;
    setProgress(label, 0, missing.length);
    let done = 0;
    let located = shops.filter((shop) => shop.location).length;
    let failed = 0;
    await runPoolUntil(missing, 3, () => located >= targetLocated, async (shop) => {
      try {
        const { geocode } = await api('/api/geocode', {
          method: 'POST',
          body: JSON.stringify({ city: state.city, shopId: shop.id }),
        }, 18000);
        if (geocode?.ok) {
          shop.location = geocode.location;
          shop.geocode = geocode;
          located += 1;
        } else {
          failed += 1;
          shop.geocodeError = geocode?.message || '定位无结果';
        }
      } catch (error) {
        failed += 1;
        shop.geocodeError = error.message;
      } finally {
        done += 1;
        setProgress(`${label}（成功 ${located}，失败 ${failed}）`, done, missing.length);
        if (done % 8 === 0) renderShopMarkers();
      }
    });
    renderShopMarkers();
    return { total: missing.length, located, failed };
  }

  async function runRecommendation() {
    try {
      await ensureMap();
      await ensureOrigins();
      state.selectedShopId = null;
      const shops = getCandidateShops();
      const scope = scanScopeValue();
      const targetLocated = scope >= 999 ? shops.length : Math.min(shops.length, Math.ceil(scope * 1.4));
      const geocodeStats = await geocodeShops(shops, {
        label: '优先定位高可行候选',
        targetLocated,
      });

      const scoped = pickScanScope(shops.filter((shop) => shop.location));
      if (!scoped.length) {
        throw new Error('没有可用店铺坐标，请稍后重试定位');
      }
      const modes = selectedModes();
      const primary = el.primaryMode.value;
      const secondaryModes = modes.filter((mode) => mode !== primary);
      const routesByShop = new Map(scoped.map((shop) => [shop.id, { shop, routes: {} }]));

      await calculateRoutes(routesByShop, scoped, [primary], '计算主推荐路线', {
        publishEvery: 12,
        onPublish: () => publishResults(routesByShop),
      });
      publishResults(routesByShop);

      if (!state.results.length) {
        setProgress('主路线没有可用结果', 1, 1);
        return;
      }

      if (secondaryModes.length) {
        const secondaryShops = state.results.slice(0, Math.min(12, state.results.length)).map((result) => result.shop);
        await calculateRoutes(routesByShop, secondaryShops, secondaryModes, '补充高分备选路线', {
          publishEvery: 8,
          onPublish: () => publishResults(routesByShop),
        });
        publishResults(routesByShop);
      }

      const skipped = geocodeStats.failed ? `，${geocodeStats.failed} 家定位失败已跳过` : '';
      setProgress(`完成${skipped}`, 1, 1);
    } catch (error) {
      setProgress(error.message, 0, 0);
    }
  }

  async function calculateRoutes(routesByShop, shops, modes, label, options = {}) {
    const jobs = [];
    for (const shop of shops) {
      for (const mode of modes) {
        jobs.push({ shop, mode, person: 'a', origin: state.origins.a });
        jobs.push({ shop, mode, person: 'b', origin: state.origins.b });
      }
    }

    const total = jobs.length;
    let done = 0;
    setProgress(label, done, total);

    await runPool(jobs, 4, async (job) => {
      try {
        const { route } = await api('/api/route', {
          method: 'POST',
          body: JSON.stringify({
              mode: job.mode,
              city: state.city,
              origin: job.origin,
            destination: job.shop.location,
          }),
        }, job.mode === 'transit' ? 32000 : 26000);
        const item = routesByShop.get(job.shop.id);
        item.routes[job.mode] ||= {};
        item.routes[job.mode][job.person] = route;
      } catch (error) {
        const item = routesByShop.get(job.shop.id);
        item.routes[job.mode] ||= {};
        item.routes[job.mode][job.person] = { error: error.message };
      } finally {
        done += 1;
        setProgress(label, done, total);
        if (options.publishEvery && done % options.publishEvery === 0) {
          options.onPublish?.();
        }
      }
    });
  }

  function publishResults(routesByShop) {
    const results = Array.from(routesByShop.values()).map(scoreResult).filter((item) => item.score > 0);
    results.sort((a, b) => b.score - a.score);
    state.results = results;
    renderResults(results);
    renderShopMarkers();
    if (results[0] && !state.selectedShopId) {
      selectShop(results[0].shop.id);
    } else if (state.selectedShopId) {
      selectShop(state.selectedShopId);
    }
  }

  async function ensureOrigins() {
    if (!state.origins.a && el.personA.value.trim()) {
      await geocodeFreeText(el.personA.value, 'a');
    }
    if (!state.origins.b && el.personB.value.trim()) {
      await geocodeFreeText(el.personB.value, 'b');
    }
    if (!state.origins.a || !state.origins.b) {
      throw new Error('请先选择两个人的起点');
    }
  }

  function pickScanScope(shops) {
    const scope = scanScopeValue();
    const scored = shops.map((shop) => {
      const rank = candidateRank(shop, shop.location);
      shop.feasibilityScore = rank.feasibilityScore;
      return {
        shop,
        directScore: rank.directScore,
      };
    });
    scored.sort((a, b) => a.directScore - b.directScore);
    return scored.slice(0, Math.min(scope, scored.length)).map((item) => item.shop);
  }

  function orderShopsForGeocode(shops) {
    if (!state.origins.a || !state.origins.b) return shops;
    return [...shops].sort((a, b) => {
      const fallback = cityCenterPoint();
      const rankA = candidateRank(a, COUNTY_CENTERS[a.countyCode] || fallback);
      const rankB = candidateRank(b, COUNTY_CENTERS[b.countyCode] || fallback);
      return rankA.directScore - rankB.directScore;
    });
  }

  function candidateRank(shop, point) {
    if (!point || !state.origins.a || !state.origins.b) {
      return { directScore: Infinity, feasibilityScore: 0 };
    }

    const distanceA = haversine(state.origins.a, point);
    const distanceB = haversine(state.origins.b, point);
    const max = Math.max(distanceA, distanceB);
    const avg = (distanceA + distanceB) / 2;
    const diff = Math.abs(distanceA - distanceB);
    const mode = el.primaryMode.value;
    const walkingPenalty = mode === 'walking' && max > 8000 ? (max - 8000) * 0.7 : 0;
    const unavailablePenalty = shop.isAvailable ? 0 : 25000;
    const directScore = max * 0.55 + avg * 0.25 + diff * 0.2 + walkingPenalty + unavailablePenalty;
    const feasibilityScore = Math.max(0, Math.min(100, Math.round(
      100 - max / 1400 - avg / 4200 - diff / 1800 - walkingPenalty / 2500 - unavailablePenalty / 2000,
    )));

    return { directScore, feasibilityScore };
  }

  function currentCityName() {
    return state.config?.city?.name || state.cities.find((city) => city.slug === state.city)?.name || '';
  }

  function cityCenterPoint() {
    const center = state.config?.city?.center || state.cities.find((city) => city.slug === state.city)?.center;
    return Array.isArray(center) ? { lng: center[0], lat: center[1] } : null;
  }

  function scoreResult(item) {
    const primary = el.primaryMode.value;
    const routeA = item.routes[primary]?.a?.best;
    const routeB = item.routes[primary]?.b?.best;
    const minutesA = routeA ? routeA.duration / 60 : Infinity;
    const minutesB = routeB ? routeB.duration / 60 : Infinity;
    const maxMinutes = Number(el.maxMinutes.value || 75);
    const max = Math.max(minutesA, minutesB);
    const avg = (minutesA + minutesB) / 2;
    const diff = Math.abs(minutesA - minutesB);
    const overtime = Math.max(0, max - maxMinutes);
    const availabilityPenalty = item.shop.isAvailable ? 0 : 35;
    const score = Math.max(0, Math.min(100, Math.round(
      120 - max * 0.5 - avg * 0.2 - diff * 0.45 - overtime * 1.1 - availabilityPenalty,
    )));

    return {
      ...item,
      score,
      metrics: { minutesA, minutesB, max, avg, diff },
    };
  }

  function renderResults(results) {
    el.resultCount.textContent = `${results.length} 家`;
    if (!results.length) {
      el.resultsList.innerHTML = '<div class="empty-state">等待路线计算</div>';
      return;
    }

    el.resultsList.innerHTML = results.slice(0, 30).map((result) => resultCardHtml(result)).join('');
    el.resultsList.querySelectorAll('.result-card').forEach((card) => {
      card.addEventListener('click', () => selectShop(Number(card.dataset.shopId)));
    });
    el.resultsList.querySelectorAll('[data-route-mode]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const shopId = Number(button.closest('.result-card').dataset.shopId);
        selectShop(shopId, button.dataset.routeMode);
      });
    });
    el.resultsList.querySelectorAll('.source-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.stopPropagation();
      });
    });
  }

  function resultCardHtml(result) {
    const shop = result.shop;
    const modeHtml = ['transit', 'driving', 'walking'].map((mode) => routePillHtml(result, mode)).join('');
    return `
      <article class="result-card ${state.selectedShopId === shop.id ? 'selected' : ''}" data-shop-id="${shop.id}">
        <div class="result-top">
          <div class="score">${result.score}</div>
          <div>
            <div class="shop-title">${escapeHtml(shop.name)}</div>
            <div class="shop-address">${escapeHtml(shop.countyName)} · 预估可行 ${Math.round(shop.feasibilityScore || 0)} · ${escapeHtml(shop.address)}</div>
          </div>
          <span class="status-badge ${shop.status}">${statusLabel(shop.status)}</span>
        </div>
        <div class="route-grid">${modeHtml}</div>
        <div class="route-actions">
          <button type="button" data-route-mode="${el.primaryMode.value}">查看路线</button>
          <a class="source-link" href="${shop.sourceUrl}" target="_blank" rel="noreferrer">全国音游地图</a>
        </div>
      </article>
    `;
  }

  function routePillHtml(result, mode) {
    const a = result.routes[mode]?.a?.best;
    const b = result.routes[mode]?.b?.best;
    if (!a || !b) {
      return `
        <div class="route-pill missing">
          <strong>${MODE_LABELS[mode]}</strong>
          <span>无完整路线</span>
        </div>
      `;
    }

    return `
      <div class="route-pill">
        <strong>${MODE_LABELS[mode]}</strong>
        ${routePersonHtml('A', a, mode)}
        ${routePersonHtml('B', b, mode)}
      </div>
    `;
  }

  function routePersonHtml(label, route, mode) {
    const detail = routeDetailText(label, route, mode);
    const taxi = route?.hasTaxi ? '<em>含打车</em>' : '';
    return `
      <span class="route-person ${route?.hasTaxi ? 'has-taxi' : ''}" tabindex="0" data-detail="${escapeAttr(detail)}">
        ${label} ${formatMinutes(route.duration)} · ${formatDistance(route.distance)} ${taxi}
      </span>
    `;
  }

  function routeDetailText(label, route, mode) {
    const lines = [
      `${label} ${MODE_LABELS[mode]}：${formatMinutes(route.duration)} · ${formatDistance(route.distance)}`,
    ];

    if (route.hasTaxi) {
      lines.push('警告：高德返回的公交路径包含打车段，请人工确认。');
    }

    const details = Array.isArray(route.details) ? route.details : [];
    if (details.length) {
      details.slice(0, 12).forEach((detail, index) => {
        const extra = [
          detail.duration ? `${Math.round(detail.duration / 60)}分钟` : '',
          detail.distance ? formatDistance(detail.distance) : '',
        ].filter(Boolean).join(' · ');
        const suffix = extra ? `（${extra}）` : '';
        lines.push(`${index + 1}. ${detail.text}${suffix}`);
      });
      if (details.length > 12) {
        lines.push(`还有 ${details.length - 12} 段未显示`);
      }
    } else if (Array.isArray(route.summary) && route.summary.length) {
      route.summary.slice(0, 8).forEach((text, index) => {
        lines.push(`${index + 1}. ${text}`);
      });
    } else {
      lines.push('高德未返回可展示的分段明细。');
    }

    return lines.join('\n');
  }

  function selectShop(shopId, mode = el.primaryMode.value) {
    state.selectedShopId = shopId;
    document.querySelectorAll('.result-card').forEach((card) => {
      card.classList.toggle('selected', Number(card.dataset.shopId) === shopId);
    });

    const shop = state.shops.find((item) => item.id === shopId);
    if (shop?.location && state.map) {
      state.map.setZoomAndCenter(13, [shop.location.lng, shop.location.lat]);
    }

    const result = state.results.find((item) => item.shop.id === shopId);
    if (result) drawRoutes(result, mode);
  }

  function drawRoutes(result, mode) {
    if (!state.map || !state.AMap) return;
    clearRoutes();
    drawPersonRoute(result.routes[mode]?.a, PERSON_COLORS.a);
    drawPersonRoute(result.routes[mode]?.b, PERSON_COLORS.b);
    if (state.routeLines.length) {
      state.map.setFitView(state.routeLines, false, [90, 80, 90, 80]);
    }
  }

  function drawPersonRoute(route, color) {
    const path = route?.best?.polyline;
    if (!Array.isArray(path) || path.length < 2) return;
    const line = new state.AMap.Polyline({
      path,
      strokeColor: color,
      strokeOpacity: 0.86,
      strokeWeight: 6,
      showDir: true,
      lineJoin: 'round',
    });
    state.routeLines.push(line);
    state.map.add(line);
  }

  function clearRoutes() {
    if (!state.routeLines.length || !state.map) return;
    state.map.remove(state.routeLines);
    state.routeLines = [];
  }

  async function runPool(items, concurrency, worker) {
    let index = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        await worker(current);
      }
    });
    await Promise.all(runners);
  }

  async function runPoolUntil(items, concurrency, shouldStop, worker) {
    let index = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length && !shouldStop()) {
        const current = items[index];
        index += 1;
        await worker(current);
      }
    });
    await Promise.all(runners);
  }

  function haversine(a, b) {
    const radius = 6371008.8;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLng / 2);
    const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  init().catch((error) => {
    setProgress(error.message, 0, 0);
  });
})();
