// node brand/render-png.cjs : renders brand/logo.svg and brand/icon.svg to the
// PNG sizes phones and print need. Uses Playwright's Chromium.
const path = require('path');
const { chromium } = require('playwright');

const dir = __dirname;
const jobs = [
  ['logo.svg', 'logo-2400.png', 2400, true],
  ['logo.svg', 'logo-600.png', 600, true],
  ['icon.svg', '../icon-512.png', 512, false],
  ['icon.svg', '../icon-192.png', 192, false],
  ['icon.svg', '../apple-touch-icon.png', 180, false],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [src, out, width, transparent] of jobs) {
    await page.goto('file://' + path.join(dir, src));
    const height = await page.evaluate((w) => {
      const svg = document.querySelector('svg');
      const vb = svg.viewBox.baseVal;
      const h = Math.round((w * vb.height) / vb.width);
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      document.documentElement.style.background = 'transparent';
      return h;
    }, width);
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: path.join(dir, out), omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
    console.log('wrote', out, `${width}x${height}`);
  }
  await browser.close();
})();
