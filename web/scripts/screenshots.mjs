// Opens the single-file build straight from disk (file://, no server, network blocked) and takes
// screenshots at the three projector sizes. Fails on page errors, network requests, or on
// scrolling at 1920x1080 / 1280x720.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const file = pathToFileURL(resolve('dist-single/presentation.html')).href;
const out = resolve('screenshots');
mkdirSync(out, { recursive: true });

const sizes = [
  { w: 1920, h: 1080, noScroll: true },
  { w: 1280, h: 720, noScroll: true },
  { w: 1024, h: 768, noScroll: false },
];
const shots = [
  { name: 'normal', keys: [], wait: 2500 },
  { name: 'fault', keys: ['ArrowRight', 'ArrowRight'], wait: 9000 },
  { name: 'present-light', keys: ['p'], wait: 2500, light: true },
];

const browser = await chromium.launch();
let failed = false;
for (const s of sizes) {
  for (const shot of shots) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h } });
    await ctx.route(/^https?:/, (r) => {
      console.error(`  NETWORK REQUEST blocked: ${r.request().url()}`);
      failed = true;
      return r.abort();
    });
    if (shot.light) await ctx.addInitScript(() => localStorage.setItem('srf.theme', 'light'));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => {
      console.error(`  PAGE ERROR: ${e.message}`);
      failed = true;
    });
    await page.goto(file);
    await page.waitForSelector('.strip');
    for (const k of shot.keys) await page.keyboard.press(k);
    await page.waitForTimeout(shot.wait);
    const dims = await page.evaluate(() => ({
      sh: document.documentElement.scrollHeight,
      sw: document.documentElement.scrollWidth,
      ih: innerHeight,
      iw: innerWidth,
    }));
    const vScroll = dims.sh > dims.ih + 1;
    const hScroll = dims.sw > dims.iw + 1;
    const bad = hScroll || (s.noScroll && vScroll);
    if (bad) failed = true;
    const path = `${out}/${s.w}x${s.h}-${shot.name}.png`;
    await page.screenshot({ path });
    console.log(`${bad ? 'FAIL' : 'ok  '} ${s.w}x${s.h} ${shot.name}: scroll ${dims.sw}x${dims.sh} in ${dims.iw}x${dims.ih} -> ${path}`);
    await ctx.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
