const fs = require('fs');
const path = require('path');
const { CITIES } = require('../lib/cities');

function fail(message) {
  console.error(`Data check failed: ${message}`);
  process.exitCode = 1;
}

function isFiniteLocation(location, city) {
  const lng = Number(location?.lng);
  const lat = Number(location?.lat);
  const bounds = city.bounds;

  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    bounds &&
    lng >= bounds.lng[0] &&
    lng <= bounds.lng[1] &&
    lat >= bounds.lat[0] &&
    lat <= bounds.lat[1]
  );
}

let total = 0;
for (const city of CITIES) {
  const dataPath = path.join(__dirname, '..', city.dataFile);
  const dataset = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const shops = Array.isArray(dataset.shops) ? dataset.shops : [];
  const ids = new Set();

  if (dataset.city?.code !== city.code) {
    fail(`${city.slug}: city code must be ${city.code}`);
  }

  if (shops.length !== dataset.counts?.shops) {
    fail(`${city.slug}: counts.shops=${dataset.counts?.shops} but shops.length=${shops.length}`);
  }

  for (const shop of shops) {
    if (!Number.isInteger(shop.id)) fail(`${city.slug}: shop id is invalid: ${shop.id}`);
    if (ids.has(shop.id)) fail(`${city.slug}: duplicate shop id: ${shop.id}`);
    ids.add(shop.id);

    if (!shop.name || !shop.address) fail(`${city.slug}: shop ${shop.id} is missing name or address`);
    if (shop.sourceUrl !== `https://map.bemanicn.com/s/${shop.id}`) {
      fail(`${city.slug}: shop ${shop.id} has invalid sourceUrl`);
    }
    if (!isFiniteLocation(shop.location, city)) {
      fail(`${city.slug}: shop ${shop.id} is missing a city-like location`);
    }

    const expectedAdcode = String(shop.countyCode || '').slice(0, 6);
    const actualAdcode = String(shop.geocode?.adcode || '');
    if (expectedAdcode && actualAdcode && expectedAdcode !== actualAdcode) {
      fail(`${city.slug}: shop ${shop.id} geocode adcode ${actualAdcode} does not match ${expectedAdcode}`);
    }
  }

  if (dataset.counts?.located !== shops.filter((shop) => shop.location).length) {
    fail(`${city.slug}: counts.located does not match located shop count`);
  }

  total += shops.length;
}

if (!process.exitCode) {
  console.log(`Data check passed: ${CITIES.length} cities, ${total} shops.`);
}
