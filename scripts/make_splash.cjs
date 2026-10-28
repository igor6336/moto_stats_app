// Renders iPhone launch screens (apple-touch-startup-image) from icons/icon.svg
// and prints the <link> tags for index.html: node scripts/make_splash.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'icons', 'icon.svg'), 'utf8');
// CSS points and pixel ratio of iPhones, portrait.
const DEVICES = [
  [440, 956, 3], [402, 874, 3], [420, 912, 3], [430, 932, 3], [393, 852, 3],
  [428, 926, 3], [390, 844, 3], [375, 812, 3], [414, 896, 3], [414, 896, 2], [375, 667, 2], [414, 736, 3],
];

(async () => {
  const browser = await chromium.launch();
  const links = [];
  for (const [w, h, dpr] of DEVICES) {
    const name = `splash-${w * dpr}x${h * dpr}.png`;
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    const icon = svg.replace('width="512" height="512"', `width="${Math.round(w * 0.42)}" height="${Math.round(w * 0.42)}"`);
    await page.setContent(`<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#07090c">
      <div style="border-radius:22%;overflow:hidden;line-height:0">${icon}</div></body></html>`);
    await page.screenshot({ path: path.join(root, 'icons', 'splash', name) });
    await page.close();
    links.push(`  <link rel="apple-touch-startup-image" href="icons/splash/${name}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)">`);
  }
  await browser.close();
  console.log(links.join('\n'));
})();
