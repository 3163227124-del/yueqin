const fs = require('fs/promises');
const path = require('path');
const { parseBemanicnCityHtml } = require('../lib/bemanicn');

async function main() {
  const input = process.argv[2] || path.join('work', 'bemanicn-beijing.html');
  const output = process.argv[3] || path.join('data', 'shops.beijing.json');
  const html = await fs.readFile(input, 'utf8');
  const dataset = parseBemanicnCityHtml(html);

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');

  console.log(`Extracted ${dataset.counts.shops} shops to ${output}`);
  console.log(
    `Available: ${dataset.counts.available}, upcoming: ${dataset.counts.upcoming}, closed: ${dataset.counts.closed}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
