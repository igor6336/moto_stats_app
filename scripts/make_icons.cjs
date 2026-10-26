// Renders icons/icon.svg into the PNG sizes iOS and Android need.
// Requires Playwright with Chromium: node scripts/make_icons.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const sizes = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180 };

(async () => {
  const browser = await chromium.launch();
  for (const [name, size] of Object.entries(sizes)) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const sized = svg.replace('width="512" height="512"', `width="${size}" height="${size}"`);
    await page.setContent(`<html><body style="margin:0">${sized}</body></html>`);
    await page.screenshot({ path: path.join(dir, name) });
    await page.close();
  }
  await browser.close();
})();
