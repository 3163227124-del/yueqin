const test = require('node:test');
const assert = require('node:assert/strict');
const { haversineMeters, scoreCommute } = require('../lib/scoring');

test('haversineMeters returns plausible Beijing distance', () => {
  const tiananmen = { lng: 116.3975, lat: 39.9087 };
  const wudaokou = { lng: 116.3371, lat: 39.9929 };
  const distance = haversineMeters(tiananmen, wudaokou);

  assert.ok(distance > 10000);
  assert.ok(distance < 13000);
});

test('scoreCommute rewards fair routes while penalizing imbalance', () => {
  const fair = scoreCommute(42, 45, 75);
  const unfair = scoreCommute(25, 85, 75);
  const long = scoreCommute(90, 95, 75);
  const balanced = scoreCommute(68, 70, 75);

  assert.ok(fair > unfair);
  assert.ok(fair > long);
  assert.ok(balanced > unfair);
  assert.ok(unfair > 0);
});
