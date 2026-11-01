/**
 * M3 multi-client UI test: two humans plus four AI residents play a real round in
 * a browser, through the actual UI.
 *
 *   pnpm -r build && node apps/server/dist/index.js &
 *   node scripts/m3-client-test.mjs                 # BASE_URL=http://localhost:2567
 *
 * Checks: residents get seated from the owner console, roles arrive privately,
 * the task list is real, all twelve minigames render, one task is really
 * completed by playing its minigame, the Galley emergency button starts a
 * meeting, meeting chat crosses browsers, and a vote lands.
 */
import { chromium } from 'playwright';
import { WORLD, buildGrid, findPath, minigameForSpot, MINIGAME_LABELS } from '../packages/shared/dist/index.js';

const BASE = process.env.BASE_URL || 'http://localhost:2567';
const grid = buildGrid(WORLD);
const checks = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (line) => {
  checks.push(line);
  console.log('  ✓ ' + line);
};
const ts = (x, y) => ({ x: x * 32 + 16, y: y * 32 + 16 });
const roomName = (id) => WORLD.rooms.find((r) => r.id === id)?.name ?? id;

async function launch() {
  return chromium.launch({
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion',
    ],
  });
}

async function openClient(browser, name) {
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 720 } })).newPage();
  page.on('pageerror', (e) => console.log(`  ! ${name}: ${e.message}`));
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input.input[placeholder="Your name"]', { timeout: 120000 });
  await page.fill('input.input[placeholder="Your name"]', name);
  return page;
}

const selfPod = (page) =>
  page.evaluate(() => (window.__station?.pods() ?? []).find((p) => p.self) ?? null);

/**
 * Walk using the on-screen stick, exactly like a thumb: hold the stick down and
 * re-point it every 80 ms along an A* path. Diagonal, continuous, and it is the
 * control the product actually ships.
 */
async function walkTo(page, x, y, timeoutMs = 90000) {
  const box = await page.locator('.joy-zone').boundingBox();
  if (!box) throw new Error('no joystick zone on screen');
  const origin = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.55 };
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  const start = Date.now();
  let lastPos = null;
  let movedAt = Date.now();
  try {
    for (;;) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`walk timed out heading to ${Math.round(x)},${Math.round(y)}`);
      }
      const me = await selfPod(page);
      if (!me) throw new Error('no self pod on the map');
      const remaining = Math.hypot(me.x - x, me.y - y);
      if (remaining < 26) return;
      if (!lastPos || Math.hypot(me.x - lastPos.x, me.y - lastPos.y) > 3) {
        lastPos = me;
        movedAt = Date.now();
      } else if (Date.now() - movedAt > 5000) {
        throw new Error(
          `no progress at ${Math.round(me.x)},${Math.round(me.y)} heading to ${Math.round(x)},${Math.round(y)}`,
        );
      }
      const path = findPath(grid, me.x, me.y, x, y);
      if (!path) {
        throw new Error(`no path from ${Math.round(me.x)},${Math.round(me.y)} to ${Math.round(x)},${Math.round(y)}`);
      }
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

/** Walkable tile closest to a pixel position (room centres are often furniture). */
function nearestWalkable(x, y) {
  const col = Math.floor(x / 32);
  const row = Math.floor(y / 32);
  let best = null;
  for (let r = 0; r < WORLD.rows; r++) {
    for (let c = 0; c < WORLD.cols; c++) {
      if ((WORLD.ascii[r]?.[c] ?? '#') === '#' || (WORLD.ascii[r]?.[c] ?? ' ') === ' ') continue;
      const d = Math.hypot(c - col, r - row);
      if (!best || d < best.d) best = { c, r, d };
    }
  }
  return best ? ts(best.c, best.r) : null;
}

const actions = (page) => page.evaluate(() => window.__debugActions?.() ?? []);
const clickAction = (page, label) => page.locator('.play-actions button', { hasText: label }).first().click();
const actionLabels = (page) =>
  page.$$eval('.play-actions button', (nodes) => nodes.map((n) => n.textContent?.trim() ?? ''));

async function openTasks(page) {
  await page.click('.play-task-chip');
  await page.waitForSelector('.task-panel:not(.hidden)', { timeout: 5000 });
  const rows = await page.$$eval('.task-row', (nodes) =>
    nodes.map((n) => ({
      room: n.querySelector('.task-room')?.textContent ?? '',
      name: n.querySelector('.task-name')?.textContent ?? '',
      done: n.classList.contains('done'),
    })),
  );
  await page.click('.play-task-chip');
  return rows;
}

/**
 * Play a minigame to a win through its real controls. Returns false for the
 * three games a script cannot reasonably drive (morse, valve, connect); those
 * are still rendered and closed by the check above.
 */
async function solveMinigame(page, kind) {
  if (kind === 'sequence') {
    for (const value of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      if (!(await page.$('.mg-card'))) return true;
      await page.locator('.mg-cell').filter({ hasText: new RegExp(`^${value}$`) }).first().click();
      await wait(40);
    }
    return true;
  }
  if (kind === 'press') {
    for (let i = 0; i < 150; i++) {
      if (!(await page.$('.mg-card'))) return true;
      await page.click('.mg-big').catch(() => undefined);
      await wait(15);
    }
    return false;
  }
  if (kind === 'sort') {
    const values = await page.$$eval('.mg-chip', (n) => n.map((c) => c.textContent ?? ''));
    for (const value of [...values].sort((a, b) => Number(a) - Number(b))) {
      if (!(await page.$('.mg-card'))) return true;
      await page.locator('.mg-chip', { hasText: value }).first().click();
      await wait(120);
    }
    return true;
  }
  if (kind === 'hold') {
    const box = await page.locator('.mg-big').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await wait(3200);
    await page.mouse.up();
    return true;
  }
  if (kind === 'wires') {
    const columns = await page.$$eval('.mg-col', (cols) =>
      cols.map((col) => [...col.children].map((c) => c.style.getPropertyValue('--w'))),
    );
    const [left, right] = columns;
    for (let i = 0; i < left.length; i++) {
      if (!(await page.$('.mg-card'))) return true;
      const match = right.indexOf(left[i]);
      await page.locator('.mg-col').nth(0).locator('.mg-wire').nth(i).click();
      await wait(60);
      await page.locator('.mg-col').nth(1).locator('.mg-wire').nth(match).click();
      await wait(120);
    }
    return true;
  }
  if (kind === 'memory') {
    await page
      .waitForFunction(() => (window.__mgSeq ?? []).length >= 4, null, { timeout: 9000 })
      .catch(() => undefined);
    const sequence = await page.evaluate(() => (window.__mgSeq ?? []).slice(0, 4));
    if (sequence.length < 4) return false;
    await wait(500);
    for (const index of sequence) {
      if (!(await page.$('.mg-card'))) return true;
      await page.locator('.mg-pad').nth(index).click();
      await wait(140);
    }
    return true;
  }
  if (kind === 'swipe') {
    const card = await page.locator('.mg-card-swipe').boundingBox();
    const track = await page.locator('.mg-track').boundingBox();
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      const x = card.x + card.width / 2 + ((track.x + track.width - card.x - card.width / 2) * step) / 12;
      await page.mouse.move(x, card.y + card.height / 2);
      await wait(30);
    }
    await page.mouse.up();
    return true;
  }
  if (kind === 'slider') {
    const left = await page.$eval('.mg-zone', (zone) => zone.style.left);
    await page.locator('.mg-slider').fill(String(Math.round(parseFloat(left) + 5)));
    return true;
  }
  if (kind === 'scan') {
    for (let i = 0; i < 300; i++) {
      if (!(await page.$('.mg-card'))) return true;
      await page.click('.mg-big').catch(() => undefined);
      await wait(50);
    }
    return false;
  }
  return false;
}

/** Walk until the authoritative distance to a task spot is close enough to act. */
async function approach(page, task, tolerance = 45) {
  const target = ts(task.tile.x, task.tile.y);
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await walkTo(page, target.x, target.y, 70000);
    } catch (err) {
      console.log(`    · walk retry (${attempt + 1}): ${err instanceof Error ? err.message : err}`);
      await wait(300);
    }
    await wait(300);
    const live = await page.evaluate(
      (id) => (window.__debugTasks?.() ?? []).find((t) => t && t.id === id),
      task.id,
    );
    if (live && typeof live.dist === 'number' && live.dist <= tolerance) return live.dist;
  }
  return null;
}

async function main() {
  let pageA;
  let pageB;
  let bA;
  let bB;
  let bC;
  let crewPage;
  let crewTasks = [];

  // Roles are dealt at random, so on a rare deal both humans are impostors and
  // there is no crew task to play. Re-deal in that case instead of pretending.
  for (let attempt = 1; attempt <= 3 && crewTasks.length === 0; attempt++) {
    bA = await launch();
    bB = await launch();
    pageA = await openClient(bA, 'Ava');
    pageB = await openClient(bB, 'Bilal');

    // ---- room ----------------------------------------------------------
    await pageA.getByRole('button', { name: 'Create room' }).click();
    await pageA.waitForSelector('.code-display', { timeout: 90000 });
    const code = (await pageA.textContent('.code-display')).trim().replace(/\s/g, '');
    if (code.length !== 5) throw new Error(`bad room code "${code}"`);

    await pageB.locator('.code-box').first().click();
    await pageB.keyboard.type(code, { delay: 60 });
    await pageB.getByRole('button', { name: 'Join with code' }).click();
    await pageB.waitForSelector('.code-display', { timeout: 90000 });
    await pageB.waitForFunction(() => document.body.textContent.includes('Bilal'), null, { timeout: 20000 });
    check(`two humans joined room ${code}`);

    // ---- residents via the owner console -------------------------------
    bC = await launch();
    const con = await (await bC.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
    await con.goto(`${BASE}/console`, { waitUntil: 'networkidle' });
    await con.waitForSelector('#people .person', { timeout: 30000 });
    const residentCount = await con.$$eval('#people .person', (n) => n.length);
    await con.fill('#code', code);
    await con.fill('#seats', '4');
    await con.click('#dispatch');
    await con.waitForSelector('#flash .ok, .flash.ok, #flash:not(:empty)', { timeout: 30000 });
    await pageA.waitForFunction(
      () => document.querySelectorAll('.players .player:not(.offline)').length >= 6,
      null,
      { timeout: 30000 },
    );
    const seats = await pageA.$$eval('.players .player:not(.offline) .pname', (n) => n.map((x) => x.textContent?.trim()));
    const aiSeats = await pageA.$$eval('.players .player .chip-ai', (n) => n.length);
    check(`console seated ${aiSeats} residents from ${residentCount} in the Commons (${seats.join(', ')})`);

    // ---- launch --------------------------------------------------------
    await pageA.getByRole('button', { name: 'Start game' }).click();
    for (const page of [pageA, pageB]) await page.waitForSelector('.play-canvas canvas', { timeout: 90000 });
    for (const page of [pageA, pageB]) {
      await page.waitForFunction(
        () => /^(Crew|Impostor)$/.test(document.querySelector('.play-role')?.textContent?.trim() ?? ''),
        null,
        { timeout: 30000 },
      );
    }
    const roleA = (await pageA.textContent('.play-role')).trim();
    const roleB = (await pageB.textContent('.play-role')).trim();
    check(`both browsers are in the station with private roles (A: ${roleA}, B: ${roleB})`);

    const pods = await pageA.evaluate(() => window.__station.pods());
    const impostorsShown = await pageA.$$eval('.play-role.impostor', (n) => n.length);
    check(`${pods.length} pods walk the map; only an impostor's own chip is red (${impostorsShown} red chip on screen)`);

    // ---- task list -----------------------------------------------------
    const tasksA = await openTasks(pageA);
    const tasksB = await openTasks(pageB);
    const crewIsA = tasksA.length >= tasksB.length;
    crewPage = crewIsA ? pageA : pageB;
    crewTasks = (crewIsA ? tasksA : tasksB).filter((t) => t.room && t.name);
    if (crewTasks.length === 0) {
      console.log('    · both humans were impostors — re-dealing the round');
      await bA.close();
      await bB.close();
      await bC.close();
    }
  }
  if (crewTasks.length === 0) throw new Error('three deals in a row gave both humans the impostor role');
  check(`task list shows real work (${crewTasks.length} tasks, e.g. ${crewTasks[0].room}: ${crewTasks[0].name})`);

  const crewTasksDebug = await crewPage.evaluate(() => window.__debugTasks?.() ?? []);
  const taskSpots = crewTasksDebug.filter((t) => t && t.tile);
  if (taskSpots.length === 0) throw new Error('no task has a real spot on the map');

  // ---- all twelve minigames render ------------------------------------
  const kinds = ['wires', 'hold', 'memory', 'swipe', 'slider', 'sort', 'morse', 'sequence', 'valve', 'press', 'scan', 'connect'];
  const titles = [];
  for (const kind of kinds) {
    await pageA.evaluate((k) => window.__debugMinigame(k), kind);
    await pageA.waitForSelector('.mg-card', { timeout: 6000 });
    titles.push((await pageA.textContent('.mg-card strong'))?.trim());
    await pageA.click('.mg-close');
    await pageA.waitForSelector('.mg-card', { state: 'detached', timeout: 6000 });
  }
  const unique = new Set(titles);
  if (unique.size !== 12) throw new Error(`only ${unique.size} distinct minigames rendered: ${titles.join(', ')}`);
  check(`all 12 minigames render and close: ${titles.join(', ')}`);

  // ---- complete a task by really playing it ---------------------------
  let completedLine = null;
  const playable = ['sequence', 'press', 'sort', 'hold', 'wires', 'memory', 'swipe', 'slider', 'scan'];
  outer: for (const task of taskSpots) {
    if (task.done || !playable.includes(task.minigame)) continue;
    const stand = await approach(crewPage, task);
    const labels = await actionLabels(crewPage);
    const where = await selfPod(crewPage);
    console.log(
      `    · ${task.id} @ ${task.spotId}: pod ${Math.round(where.x)},${Math.round(where.y)} · server says ${stand}px · actions=[${labels.join('|')}]`,
    );
    if (!labels.includes('Use')) continue;
    const watchPads = crewPage.evaluate(() => {
      window.__mgSeq = [];
      new MutationObserver((muts) => {
        for (const m of muts) {
          const node = m.target;
          if (!(node instanceof HTMLElement) || !node.classList.contains('mg-pad')) continue;
          if (!node.classList.contains('lit')) continue;
          const index = [...(node.parentElement?.children ?? [])].indexOf(node);
          if (window.__mgSeq[window.__mgSeq.length - 1] !== index) window.__mgSeq.push(index);
        }
      }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
    });
    await watchPads.catch(() => undefined);
    await clickAction(crewPage, 'Use');
    await crewPage.waitForSelector('.mg-card', { timeout: 8000 });
    const title = (await crewPage.textContent('.mg-card strong'))?.trim();
    console.log(
      `      card ${JSON.stringify(await crewPage.evaluate(() => ({
        host: document.querySelector('.mg-host')?.className,
        title: document.querySelector('.mg-card strong')?.textContent,
        phase: document.querySelector('.end-host')?.className,
      })))}`,
    );
    const played = await solveMinigame(crewPage, task.minigame);
    const closed = await crewPage
      .waitForSelector('.mg-card', { state: 'detached', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    const solved = played && closed;
    if (!solved) {
      await crewPage.click('.mg-close').catch(() => undefined);
      continue;
    }
    await wait(1200);
    const chip = ((await crewPage.textContent('.play-task-chip')) ?? '').trim();
    let after = await crewPage.evaluate(
      (id) => (window.__debugTasks?.() ?? []).find((t) => t && t.id === id),
      task.id,
    );
    for (let i = 0; i < 10 && !after?.done; i++) {
      await wait(300);
      after = await crewPage.evaluate(
        (id) => (window.__debugTasks?.() ?? []).find((t) => t && t.id === id),
        task.id,
      );
    }
    if (after?.done) {
      completedLine = `played "${title}" at the ${task.room} spot — the task list ticks it and the HUD reads "${chip}"`;
      break outer;
    }
    const sent = await crewPage.evaluate(() => ({
      packets: (window.__debugSent ?? []).slice(-6),
      minigames: (window.__mgLog ?? []).slice(-6),
    }));
    console.log(
      `      after: ${JSON.stringify(await crewPage.evaluate(() => ({
        host: document.querySelector('.mg-host')?.className,
        end: document.querySelector('.end-host')?.className,
        meeting: document.querySelector('.meeting-host')?.className,
        chip: document.querySelector('.play-task-chip')?.textContent,
        note: document.querySelector('.play-banner')?.textContent,
      })))}`,
    );
    console.log(
      `    · ${title} closed without the server ticking it; last packets sent: ${JSON.stringify(sent)}`,
    );
  }
  if (!completedLine) throw new Error('could not complete a task through the minigame UI');
  check(completedLine);

  // ---- emergency meeting ----------------------------------------------
  const galley = WORLD.rooms.find((r) => r.id === 'galley');
  const centre = {
    x: (galley.rect.x + galley.rect.w / 2) * 32,
    y: (galley.rect.y + galley.rect.h / 2) * 32,
  };
  await walkTo(pageA, centre.x, centre.y);
  await wait(400);
  if (!(await actionLabels(pageA)).includes('Emergency')) {
    const fallback = nearestWalkable(centre.x, centre.y);
    await walkTo(pageA, fallback.x, fallback.y);
    await wait(400);
  }
  const galleyLabels = await actionLabels(pageA);
  if (!galleyLabels.includes('Emergency')) throw new Error(`no Emergency button in the Galley (actions: ${galleyLabels.join(', ')})`);
  await clickAction(pageA, 'Emergency');

  for (const page of [pageA, pageB]) await page.waitForSelector('.meeting-card', { timeout: 20000 });
  check('the Galley emergency button called a meeting in both browsers');
  await pageA.screenshot({ path: 'docs/shots/15-meeting.png' });

  await pageA.fill('.meet-input', 'where was everyone?');
  await pageA.click('.meet-send');
  await pageB.waitForFunction(
    () => (document.querySelector('.meet-chat')?.textContent ?? '').includes('where was everyone'),
    null,
    { timeout: 20000 },
  );
  check('meeting chat crossed browsers');

  // ---- voting ----------------------------------------------------------
  await pageB.waitForFunction(
    () => /voting/i.test(document.querySelector('.meet-timer')?.textContent ?? ''),
    null,
    { timeout: 150000 },
  );
  const voteRows = await pageB.$$('.vote-row:not(.self)');
  if (voteRows.length < 2) throw new Error(`only ${voteRows.length} vote targets rendered`);
  await voteRows[0].click();
  await pageB.waitForSelector('.vote-row.chosen', { timeout: 6000 });
  const counted = await pageB.waitForFunction(
    () => /\d\/\d+ votes in/.test(document.querySelector('.meet-sub')?.textContent ?? ''),
    null,
    { timeout: 20000 },
  );
  void counted;
  check(`voting works in the UI (${voteRows.length} targets, chosen row highlighted, counter shows votes in)`);
  await pageB.screenshot({ path: 'docs/shots/16-vote.png' });

  // ---- meeting resolves and play resumes -------------------------------
  // The card is reused between meetings and only hidden, so wait on the host.
  await pageA.waitForFunction(
    () => document.querySelector('.meeting-host')?.classList.contains('hidden') === true,
    null,
    { timeout: 150000 },
  );
  const resumed = await actionLabels(pageA);
  const phaseChip = ((await pageA.textContent('.play-role')) ?? '').trim();
  check(`meeting closed and play resumed (role chip still "${phaseChip}", action bar: ${resumed.length === 0 ? 'idle' : resumed.join(', ')})`);

  console.log(`\nM3 CLIENT TEST PASS (${checks.length} checks)`);
  await bA.close();
  await bB.close();
  await bC.close();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('\nM3 CLIENT TEST FAIL:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  },
);
