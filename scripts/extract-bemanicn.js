const fs = require('fs/promises');
const path = require('path');
const { parseBemanicnCityHtml } = require('../lib/bemanicn');
const { CITIES, cityBySlug } = require('../lib/cities');

async function extractCity(city) {
  const html = await fs.readFile(city.sourceHtml, 'utf8');
  const dataset = parseBemanicnCityHtml(html, {
    slug: city.slug,
    sourceUrl: `https://map.bemanicn.com/region/city/${city.code}`,
    center: city.center,
  });

  await fs.mkdir(path.dirname(city.dataFile), { recursive: true });
  await fs.writeFile(city.dataFile, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');

  console.log(`Extracted ${dataset.counts.shops} shops to ${city.dataFile}`);
  console.log(
    `Available: ${dataset.counts.available}, upcoming: ${dataset.counts.upcoming}, closed: ${dataset.counts.closed}`,
  );
}

async function main() {
  const slug = process.argv[2];
  if (!slug || slug === 'all') {
    for (const city of CITIES) {
      await extractCity(city);
    }
    return;
  }

  await extractCity(cityBySlug(slug));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
