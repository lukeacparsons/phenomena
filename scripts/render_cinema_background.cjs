// Compile the supplied vector artwork once, instead of expanding its nested
// SVG uses and repainting them on every theme change. Run after editing the SVG.
// Requires Chrome, Playwright (or PLAYWRIGHT_MODULE) and the project's Pillow.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const source = fs.readFileSync(path.join(root, 'static/barcelona-cinema-background.svg'), 'utf8');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cinema-background-'));
  try {
    const page = await browser.newPage();
    const png = await page.evaluate(async svg => {
      const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      // Four device pixels per CSS pixel at the site's 480 px tile size.
      canvas.width = Math.round(parseFloat(root.getAttribute('width')) * 2);
      canvas.height = Math.round(parseFloat(root.getAttribute('height')) * 2);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png').split(',')[1];
    }, source);
    const input = path.join(temporary, 'background.png');
    const output = path.join(root, 'static/barcelona-cinema-background.webp');
    fs.writeFileSync(input, Buffer.from(png, 'base64'));
    execFileSync(path.join(root, '.venv/bin/python'), ['-c', `
from PIL import Image, ImageChops
import sys
image = Image.open(sys.argv[1]).convert('RGBA')
image.save(sys.argv[2], 'WEBP', lossless=True, method=6, exact=True)
assert ImageChops.difference(image, Image.open(sys.argv[2]).convert('RGBA')).getbbox(alpha_only=False) is None
`, input, output], { stdio: 'inherit' });
    console.log(JSON.stringify({ output, bytes: fs.statSync(output).size, pixels: 'verified lossless' }));
  } finally {
    await browser.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
