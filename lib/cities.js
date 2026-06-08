const CITIES = [
  {
    slug: 'beijing',
    name: '北京市',
    shortName: '北京',
    code: '110100000000',
    provinceCode: '110000000000',
    center: [116.397428, 39.90923],
    bounds: { lng: [115, 118], lat: [39, 41] },
    sourceHtml: 'work/bemanicn-beijing.html',
    dataFile: 'data/shops.beijing.json',
  },
  {
    slug: 'shanghai',
    name: '上海市',
    shortName: '上海',
    code: '310100000000',
    provinceCode: '310000000000',
    center: [121.473667, 31.230525],
    bounds: { lng: [120.5, 122.2], lat: [30.6, 31.9] },
    sourceHtml: 'work/bemanicn-shanghai.html',
    dataFile: 'data/shops.shanghai.json',
  },
  {
    slug: 'guangzhou',
    name: '广州市',
    shortName: '广州',
    code: '440100000000',
    provinceCode: '440000000000',
    center: [113.264385, 23.129112],
    bounds: { lng: [112.7, 114], lat: [22.5, 24] },
    sourceHtml: 'work/bemanicn-guangzhou.html',
    dataFile: 'data/shops.guangzhou.json',
  },
  {
    slug: 'shenzhen',
    name: '深圳市',
    shortName: '深圳',
    code: '440300000000',
    provinceCode: '440000000000',
    center: [114.057939, 22.543527],
    bounds: { lng: [113.7, 114.7], lat: [22.3, 22.9] },
    sourceHtml: 'work/bemanicn-shenzhen.html',
    dataFile: 'data/shops.shenzhen.json',
  },
];

function cityBySlug(slug) {
  return CITIES.find((city) => city.slug === slug) || CITIES[0];
}

function cityByCode(code) {
  return CITIES.find((city) => city.code === code) || null;
}

module.exports = {
  CITIES,
  cityByCode,
  cityBySlug,
};
