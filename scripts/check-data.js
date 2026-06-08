const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'shops.beijing.json');

function fail(message) {
  console.error(`Data check failed: ${message}`);
  process.exitCode = 1;
}

function isFiniteLocation(location) {
  return (
    location &&
    Number.isFinite(Number(location.lng)) &&
    Number.isFinite(Number(location.lat)) &&
    Number(location.lng) >= 115 &&
    Number(location.lng) <= 118 &&
    Number(location.lat) >= 39 &&
    Number(location.lat) <= 41
  );
}

const dataset = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const shops = Array.isArray(dataset.shops) ? dataset.shops : [];
const ids = new Set();

if (dataset.city?.code !== '110100000000') {
  fail('city code must be Beijing 110100000000');
}

if (shops.length !== dataset.counts?.shops) {
  fail(`counts.shops=${dataset.counts?.shops} but shops.length=${shops.length}`);
}

for (const shop of shops) {
  if (!Number.isInteger(shop.id)) fail(`shop id is invalid: ${shop.id}`);
  if (ids.has(shop.id)) fail(`duplicate shop id: ${shop.id}`);
  ids.add(shop.id);

  if (!shop.name || !shop.address) fail(`shop ${shop.id} is missing name or address`);
  if (shop.sourceUrl !== `https://map.bemanicn.com/s/${shop.id}`) {
    fail(`shop ${shop.id} has invalid sourceUrl`);
  }
  if (!isFiniteLocation(shop.location)) {
    fail(`shop ${shop.id} is missing a Beijing-like location`);
  }

  const expectedAdcode = String(shop.countyCode || '').slice(0, 6);
  const actualAdcode = String(shop.geocode?.adcode || '');
  if (expectedAdcode && actualAdcode && expectedAdcode !== actualAdcode) {
    fail(`shop ${shop.id} geocode adcode ${actualAdcode} does not match ${expectedAdcode}`);
  }
}

if (dataset.counts?.located !== shops.filter((shop) => shop.location).length) {
  fail('counts.located does not match located shop count');
}

if (!process.exitCode) {
  console.log(`Data check passed: ${shops.length} shops, ${dataset.counts?.located} located.`);
}
