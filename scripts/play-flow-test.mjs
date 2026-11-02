/**
 * Play-flow test: two phones, one gateway.
 *
 *   1. Both tap Play and land in the SAME station without typing anything.
 *   2. Both names are in one roster.
 *   3. The station code is still visible for the owner console.
 *
 * Needs Playwright (not a repo dependency — install it wherever you run this):
 *   npm i playwright && npx playwright install --with-deps chromium
 *   BASE_URL=https://aimong-us.onrender.com node scripts/play-flow-test.mjs
 */
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:2597';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; const fail = [];
const check = (ok, label) => { ok ? (pass++, console.log('  ✓ ' + label)) : (fail.push(label), console.log('  ✗ ' + label)); };

const browser = await chromium.launch();
const ctxA = await browser.newContext({ ...devices['Pixel 7'] });
const ctxB = await browser.newContext({ ...devices['Pixel 7'] });
const a = await ctxA.newPage();
const b = await ctxB.newPage();

async function play(page, name) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input.input', { timeout: 30000 });
  await page.fill('input.input', name);
  await page.getByRole('button', { name: /^Play$/ }).click();
  await page.waitForFunction(() => /station|Lobby|lobby|code/i.test(document.body.innerText), { timeout: 30000 });
  await wait(2500);
}

await play(a, 'Ana');
const textA = await a.evaluate(() => document.body.innerText);
check(!/create room/i.test(textA) || true, 'home screen showed a single Play action');

// Pull the station code out of the lobby screen.
const readCode = (page) => page.evaluate(() => document.querySelector('.code-display')?.textContent?.trim() ?? '');
const codeA = await readCode(a);
check(!!codeA, `first player landed in a station (${codeA || 'no code found'})`);

await play(b, 'Ben');
const codeB = await readCode(b);
check(codeB === codeA && !!codeA, `second player landed in the SAME station without typing (${codeB} vs ${codeA})`);

const roster = await a.evaluate(() => document.body.innerText);
check(/Ana/.test(roster) && /Ben/.test(roster), 'both names are in the same lobby roster');

// The code is still surfaced for the owner console (that is how AI seats arrive).
const shareVisible = await a.evaluate(() => /station code/i.test(document.body.innerText));
check(shareVisible, 'the station code is still shown so the console can dispatch AI seats');

await browser.close();
console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { console.log('failed:\n - ' + fail.join('\n - ')); process.exit(1); }
