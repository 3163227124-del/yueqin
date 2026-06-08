const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { inferStatus, parseBemanicnCityHtml } = require('../lib/bemanicn');

test('inferStatus marks unavailable shops from names', () => {
  assert.equal(inferStatus('【即将开业】E 享空间'), 'upcoming');
  assert.equal(inferStatus('（暂停营业）KT竞技现场'), 'closed');
  assert.equal(inferStatus('环游嘉年华'), 'open');
});

test('parseBemanicnCityHtml extracts Beijing shops from saved page', { skip: !fs.existsSync('work/bemanicn-beijing.html') }, () => {
  const html = fs.readFileSync('work/bemanicn-beijing.html', 'utf8');
  const dataset = parseBemanicnCityHtml(html);

  assert.equal(dataset.city.code, '110100000000');
  assert.ok(dataset.counts.shops > 100);
  assert.ok(dataset.shops.every((shop) => shop.sourceUrl.includes(String(shop.id))));
});
