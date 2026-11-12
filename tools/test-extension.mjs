// Loads dist/ as an unpacked Chrome extension, clicks through to the game tab
// the way a user would, and asserts it boots under the extension CSP.
// Run after `npm run build`.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ext = resolve('dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'killhouse-')), {
  channel: 'chromium',
  viewport: { width: 1280, height: 720 },
  args: [
    `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
    ...(process.platform === 'darwin'
      ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle']
      : ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox']),
  ],
});
const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;

// Fire the toolbar-click handler and pick up the tab it opens.
const opened = ctx.waitForEvent('page');
await sw.evaluate(() => chrome.action.onClicked.dispatch({}));
const page = await opened;

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.waitForFunction(() => window.__READY__ === true, { timeout: 90000 });
// Home page is up with Deploy enabled, and the menu actually pauses the sim.
const home = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  while (window.__ENGINE__.frame < 3) await wait(50);   // warm-up frames run by design
  const f0 = window.__ENGINE__.frame;
  await wait(500);
  return {
    menu: document.getElementById('enter').classList.contains('show'),
    deployEnabled: !document.getElementById('deploy').disabled,
    binds: document.querySelectorAll('#binds button').length,
    paused: window.__ENGINE__.paused && window.__ENGINE__.frame === f0,
  };
});
const hits = await page.evaluate(() => {
  const { physics, player } = window.__ENGINE__.ctx;
  return physics.raycast(player.eyePosition.clone(), { x: 0, y: -1, z: 0 }, 50) ? 1 : 0;
});
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
await ctx.close();

console.log(JSON.stringify({ id, url: page.url(), home, physicsRaycast: hits, errors }, null, 2));
const ok = page.url() === `chrome-extension://${id}/index.html` && hits === 1 && errors.length === 0
  && home.menu && home.deployEnabled && home.binds > 0 && home.paused;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
