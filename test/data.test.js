const test = require('node:test');
const assert = require('node:assert/strict');
const dataset = require('../data/shops.beijing.json');

test('Beijing shop dataset is complete enough for shared use', () => {
  assert.equal(dataset.city.code, '110100000000');
  assert.equal(dataset.shops.length, dataset.counts.shops);
  assert.equal(dataset.counts.located, dataset.shops.length);

  for (const shop of dataset.shops) {
    assert.match(shop.sourceUrl, new RegExp(`/s/${shop.id}$`));
    assert.equal(typeof shop.location.lng, 'number');
    assert.equal(typeof shop.location.lat, 'number');
    assert.equal(String(shop.geocode.expectedAdcode || shop.countyCode).slice(0, 6), String(shop.geocode.adcode).slice(0, 6));
  }
});
