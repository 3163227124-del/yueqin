const HTML_ENTITIES = {
  '&quot;': '"',
  '&#039;': "'",
  '&apos;': "'",
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
};

function decodeHtml(value) {
  return value.replace(/&(quot|#039|apos|amp|lt|gt);/g, (entity) => HTML_ENTITIES[entity] || entity);
}

function inferStatus(name) {
  if (/即将开业|即將開業|未开业|未開業|试营业前|準備中|准备中/.test(name)) {
    return 'upcoming';
  }

  if (/暂停营业|暫停營業|停业|停業|闭店|閉店|搬迁|搬遷|歇业|歇業/.test(name)) {
    return 'closed';
  }

  return 'open';
}

function inferTags(shop) {
  const text = `${shop.name} ${shop.address}`;
  const tags = new Set();

  if (/音游|音遊|maimai|舞萌|中二节奏|CHUNITHM|jubeat|IIDX|SDVX|太鼓|BEMANI/i.test(text)) {
    tags.add('音游');
  }

  if (/电玩|電玩|游艺|遊藝|游戏|遊戲|街机|街機|竞技|競技|Playstation|PS/i.test(text)) {
    tags.add('街机/电玩');
  }

  if (/麻将|麻將/.test(text)) {
    tags.add('麻将');
  }

  return Array.from(tags);
}

function buildGeocodeAddress(shop, countyName, cityName) {
  const address = String(shop.address || '').trim();
  if (address.startsWith(cityName)) {
    return address;
  }

  const parts = [cityName];

  if (countyName && !address.includes(countyName)) {
    parts.push(countyName);
  }

  parts.push(address);
  return parts.join('');
}

function normalizeShop(shop, countyMap, cityName) {
  const countyName = countyMap.get(shop.county_code) || '';
  const status = inferStatus(shop.name);

  return {
    id: Number(shop.id),
    name: String(shop.name || '').trim(),
    address: String(shop.address || '').trim(),
    geocodeAddress: buildGeocodeAddress(shop, countyName, cityName),
    provinceCode: shop.province_code,
    cityCode: shop.city_code,
    countyCode: shop.county_code,
    countyName,
    status,
    isAvailable: status === 'open',
    tags: inferTags(shop),
    sourceName: 'BEMANICN 街机地图',
    sourceUrl: `https://map.bemanicn.com/s/${shop.id}`,
  };
}

function parseBemanicnCityHtml(html, options = {}) {
  const match = html.match(/<div id="app" data-page="([\s\S]*?)"><\/div>/);
  if (!match) {
    throw new Error('BEMANICN data-page payload was not found.');
  }

  const page = JSON.parse(decodeHtml(match[1]));
  const city = page?.props?.city;
  if (!city || !Array.isArray(city.shops)) {
    throw new Error('BEMANICN city payload does not contain a shop list.');
  }

  const countyMap = new Map(
    (city.counties || []).map((county) => [county.county_code, county.name]),
  );
  const configuredCity = cityByCode(city.city_code);
  const cityName = configuredCity?.name || city.name;

  const shops = city.shops
    .map((shop) => normalizeShop(shop, countyMap, cityName))
    .sort((a, b) => a.id - b.id);

  return {
    generatedAt: new Date().toISOString(),
    source: {
      name: 'BEMANICN 街机地图',
      url: options.sourceUrl || `https://map.bemanicn.com/region/city/${city.city_code}`,
      fetchedAt: new Date().toISOString(),
    },
    city: {
      id: city.id,
      name: city.name,
      slug: configuredCity?.slug || options.slug || city.name_pinyin,
      shortName: configuredCity?.shortName || city.name,
      code: city.city_code,
      provinceCode: city.province_code,
      center: configuredCity?.center || options.center || [116.397428, 39.90923],
    },
    counts: {
      shops: shops.length,
      available: shops.filter((shop) => shop.status === 'open').length,
      upcoming: shops.filter((shop) => shop.status === 'upcoming').length,
      closed: shops.filter((shop) => shop.status === 'closed').length,
    },
    shops,
  };
}

module.exports = {
  decodeHtml,
  inferStatus,
  inferTags,
  parseBemanicnCityHtml,
};
const { cityByCode } = require('./cities');
