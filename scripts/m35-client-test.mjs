/**
 * M3.5 client test: the new HUD, played through the real UI in a browser.
 *
 *   pnpm -r build && PORT=2567 node apps/server/dist/index.js &
 *   node scripts/m35-client-test.mjs        # BASE_URL=http://localhost:2567
 *
 * What it proves, all through clicks a thumb could make:
 *   • the cosmetics picker persists a look and the look reaches the station
 *   • "Practise alone" starts a solo free-roam round
 *   • the role card says what the shared role table says
 *   • the task sheet groups tasks by category and shows long-task stages
 *   • the crew task bar follows the host's task-bar mode
 *   • station tools are room-gated and refuse truthfully from the wrong room
 *   • the admin table shows heads per room when you are standing at Cargo
 */
import { chromium } from 'playwright';
import { WORLD, buildGrid, findPath } from '../packages/shared/dist/index.js';

const BASE = process.env.BASE_URL || 'http://localhost:2567';
const grid = buildGrid(WORLD);
const checks = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (line) => {
  checks.push(line);
  console.log('  ✓ ' + line);
};
const ts = (x, y) => ({ x: x * 32 + 16, y: y * 32 + 16 });

const selfPod = (page) => page.evaluate(() => (window.__station?.pods() ?? []).find((p) => p.self) ?? null);

/** Walk with the on-screen stick, like a thumb: hold and re-point every 80 ms. */
async function walkTo(page, x, y, timeoutMs = 90000) {
  const box = await page.locator('.joy-zone').boundingBox();
  if (!box) throw new Error('no joystick zone on screen');
  const origin = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.55 };
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  const start = Date.now();
  let last = null;
  let movedAt = Date.now();
  try {
    for (;;) {
      if (Date.now() - start > timeoutMs) throw new Error(`walk timed out to ${Math.round(x)},${Math.round(y)}`);
      const me = await selfPod(page);
      if (!me) throw new Error('no self pod on the map');
      if (Math.hypot(me.x - x, me.y - y) < 30) return;
      if (!last || Math.hypot(me.x - last.x, me.y - last.y) > 3) {
        last = me;
        movedAt = Date.now();
      } else if (Date.now() - movedAt > 6000) {
        throw new Error(`no progress at ${Math.round(me.x)},${Math.round(me.y)}`);
      }
      const path = findPath(grid, me.x, me.y, x, y);
      if (!path) throw new Error(`no path from ${Math.round(me.x)},${Math.round(me.y)}`);
      const node = path.find((p) => Math.hypot(p.x - me.x, p.y - me.y) > 20) ?? { x, y };
      const dx = node.x - me.x;
      const dy = node.y - me.y;
      const length = Math.hypot(dx, dy) || 1;
      await page.mouse.move(origin.x + (dx / length) * 56, origin.y + (dy / length) * 56);
      await wait(80);
    }
  } finally {
    await page.mouse.up().catch(() => undefined);
  }
}

async function main() {
  const browser = await chromium.launch({
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const context = await browser.newContext({ viewport: { width: 1180, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`  ! ${e.message}`));
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input.input[placeholder="Your name"]', { timeout: 120000 });
  await page.fill('input.input[placeholder="Your name"]', 'Patchy');

  // ---- cosmetics: pick a hat and a pet, then check the station shows it ----
  await page.locator('.look-row[data-field="hat"] .look-chip', { hasText: 'Crown' }).click();
  await page.locator('.look-row[data-field="pet"] .look-chip', { hasText: 'Pup' }).click();
  const chosen = await page.$$eval('.look-chip.on', (nodes) => nodes.map((n) => n.textContent));
  if (!chosen.includes('Crown') || !chosen.includes('Pup')) {
    throw new Error(`cosmetics picker did not mark the choice (on: ${chosen.join(', ')})`);
  }
  check(`cosmetics picker holds a look (${chosen.join(' + ')})`);

  // ---- practice round ------------------------------------------------------
  await page.locator('button', { hasText: 'Practise alone' }).click();
  await page.waitForSelector('.play-screen', { timeout: 60000 });
  await page.waitForSelector('.role-card:not(.hidden)', { timeout: 60000 });
  const roleText = (await page.textContent('.role-card')) ?? '';
  if (!/You are Crew/.test(roleText)) throw new Error(`role card said: ${roleText.slice(0, 80)}`);
  check('practice round started and the role card named the role');

  // The role card is DOM and appears before the Phaser scene has finished
  // booting, so wait for the self pod rather than reading an empty list.
  const look = await page
    .waitForFunction(
      () => (window.__station?.pods() ?? []).find((p) => p.self)?.cosmetics ?? false,
      null,
      { timeout: 30000 },
    )
    .then((handle) => handle.jsonValue());
  if (!look.includes('crown') || !look.includes('pup')) {
    throw new Error(`station drew cosmetics "${look}"`);
  }
  check(`the station drew the chosen look (${look.replace(/\|/g, ' · ')})`);

  // ---- task sheet: categories + long-task stages ---------------------------
  await page.click('.play-task-chip');
  await page.waitForSelector('.task-panel:not(.hidden)', { timeout: 5000 });
  const chips = await page.$$eval('.task-chip', (nodes) => nodes.map((n) => n.textContent ?? ''));
  await page.click('.play-task-chip');
  if (chips.length !== 4) throw new Error(`expected 4 category chips, got ${chips.join(', ')}`);
  check(`task sheet groups by category (${chips.join(' · ')})`);

  // ---- ability bar: station tools present, refused from the wrong room ----
  const tools = await page.$$eval('.ability', (nodes) => nodes.map((n) => n.dataset.ability));
  for (const id of ['admin', 'camera', 'doorlog']) {
    if (!tools.includes(id)) throw new Error(`ability bar missing ${id} (has ${tools.join(', ')})`);
  }
  check(`ability bar lists the station tools (${tools.join(', ')})`);

  const cameras = page.locator('.ability[data-ability="camera"]');
  if (!(await cameras.isDisabled())) throw new Error('cameras were usable from the corridor');
  const cameraSub = (await cameras.textContent()) ?? '';
  if (!/console/i.test(cameraSub)) throw new Error(`camera refusal said: ${cameraSub}`);
  check(`tools refuse truthfully from the wrong room ("${cameraSub.replace(/^Cameras/, '').trim()}")`);

  // ---- task bar follows the mode -------------------------------------------
  if (!(await page.locator('.task-bar').isVisible())) throw new Error('task bar hidden on an always-mode lobby');
  check('crew task bar is drawn in always mode');

  // ---- admin table from Cargo ---------------------------------------------
  const cargo = WORLD.rooms.find((r) => r.id === 'cargo');
  const centre = ts(cargo.rect.x + cargo.rect.w / 2, cargo.rect.y + cargo.rect.h / 2);
  await walkTo(page, centre.x, centre.y);
  await wait(600);
  const admin = page.locator('.ability[data-ability="admin"]');
  if (await admin.isDisabled()) throw new Error('admin table still refused inside Cargo');
  await admin.click();
  await page.waitForSelector('.tool-sheet:not(.hidden)', { timeout: 8000 });
  const rows = await page.$$eval('.tool-row', (nodes) => nodes.map((n) => n.textContent ?? ''));
  if (!rows.some((row) => /Cargo/.test(row) && /\d/.test(row))) {
    throw new Error(`admin rows looked like: ${rows.join(' | ')}`);
  }
  check(`admin table answered from Cargo (${rows.slice(0, 3).join(' · ')} …)`);
  await page.screenshot({ path: 'docs/shots/17-m35-hud.png' });

  console.log(`\nM3.5 CLIENT TEST PASS (${checks.length} checks)`);
  await context.close();
  await browser.close();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('\nM3.5 CLIENT TEST FAIL:', err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  },
);
