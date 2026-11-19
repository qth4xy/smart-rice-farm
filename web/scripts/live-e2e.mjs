// End-to-end check against the REAL device through the public broker.
//   SRF_ROOT=<topic root from the OLED> node scripts/live-e2e.mjs
// Opens presentation.html from disk, switches to Live, waits for real data, sends a harmless
// setMode command (the device's current mode) through the confirm dialog and waits for its ack.
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.SRF_ROOT;
const device = process.env.SRF_DEVICE ?? 'srf-cc2468';
if (!root) {
  console.error('Set SRF_ROOT to the topic root shown on the device OLED.');
  process.exit(2);
}
const file = pathToFileURL(resolve('dist-single/presentation.html')).href;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(
  ([r, d]) =>
    localStorage.setItem('srf.live', JSON.stringify({ url: 'wss://broker.hivemq.com:8884/mqtt', root: r, deviceId: d, remember: false })),
  [root, device],
);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(file);
await page.getByRole('button', { name: 'Live', exact: true }).click();

const badge = await page.locator('.badge').innerText();
await page.waitForSelector('.strip', { timeout: 20_000 });
const mode = (await page.locator('.tile.mode .tile-v').innerText()).trim();
const zone = (await page.locator('.tile.zone .tile-v').innerText()).trim();
const soil = (await page.locator('.sensor-v').first().innerText()).trim();
console.log(`badge="${badge}" mode=${mode} zone="${zone}" soil=${soil.replace(/\s+/g, '')}`);
await page.screenshot({ path: 'screenshots/live-1920x1080.png' });

// Harmless command: set the mode it already has. Must ask for confirmation first.
await page.getByRole('button', { name: mode, exact: true }).click();
await page.waitForSelector('dialog.confirm', { timeout: 3000 });
const title = await page.locator('dialog.confirm h2').innerText();
await page.getByRole('button', { name: `Set ${mode}` }).click();
const toast = await page.waitForSelector('.toast', { timeout: 10_000 }).then((t) => t.innerText());
console.log(`confirm="${title.trim()}" toast="${toast.trim()}"`);
await page.screenshot({ path: 'screenshots/live-ack-1920x1080.png' });
await browser.close();

const ok = badge.includes(`LIVE · ${device}`) && toast.includes('setMode done') && errors.length === 0;
if (errors.length) console.error('page errors:', errors);
console.log(ok ? 'LIVE E2E OK' : 'LIVE E2E FAILED');
process.exit(ok ? 0 : 1);
