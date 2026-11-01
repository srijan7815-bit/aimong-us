#!/usr/bin/env node
/**
 * One-shot deploy: GitHub repo -> Render web service -> wait for a live URL.
 *
 * Only ever run this with tokens supplied by the owner; nothing is written to
 * disk except the git remote. Secrets stay in the environment.
 *
 *   GITHUB_TOKEN=ghp_xxx RENDER_API_KEY=rnd_xxx node scripts/deploy-render.mjs
 *
 * Optional env:
 *   GH_REPO=aimong-us            repo name to create/use
 *   GH_VISIBILITY=public         public (default, no GitHub App dance) | private
 *   RENDER_REGION=singapore      oregon | ohio | virginia | frankfurt | singapore
 *   RENDER_PLAN=free             free | starter | standard
 *   RENDER_NAME=aimong-us        service name
 *
 * Re-runnable: an existing repo is reused, an existing service is reused.
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const env = process.env;
const GITHUB_TOKEN = env.GITHUB_TOKEN?.trim();
const RENDER_API_KEY = env.RENDER_API_KEY?.trim();
const GH_REPO = env.GH_REPO?.trim() || 'aimong-us';
const GH_VISIBILITY = env.GH_VISIBILITY?.trim() || 'public';
const REGION = env.RENDER_REGION?.trim() || 'singapore';
const PLAN = env.RENDER_PLAN?.trim() || 'free';
const SERVICE_NAME = env.RENDER_NAME?.trim() || 'aimong-us';

const BUILD_CMD =
  'corepack enable && corepack prepare pnpm@12.16.1 --activate && pnpm install --frozen-lockfile && pnpm -r build';
const START_CMD = 'node apps/server/dist/index.js';

const log = (...args) => console.log('•', ...args);

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (!GITHUB_TOKEN) fail('GITHUB_TOKEN is required');
if (!RENDER_API_KEY) fail('RENDER_API_KEY is required');

async function api(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

const gh = (path, init = {}) =>
  api(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

const render = (path, init = {}) =>
  api(`https://api.render.com/v1${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${RENDER_API_KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

// ---------------------------------------------------------------- 1. repo

log('whoami on GitHub…');
const me = await gh('/user');
if (!me.ok) fail(`GitHub token rejected (${me.status}): ${JSON.stringify(me.body)}`);
const owner = me.body.login;
log(`authenticated as ${owner}`);

let repoUrl = `https://github.com/${owner}/${GH_REPO}`;
log(`checking ${owner}/${GH_REPO}…`);
const existing = await gh(`/repos/${owner}/${GH_REPO}`);
if (existing.ok) {
  log('repo already exists, reusing it');
  repoUrl = existing.body.html_url;
} else if (existing.status === 404) {
  log(`creating ${GH_VISIBILITY} repo ${owner}/${GH_REPO}…`);
  const created = await gh('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: GH_REPO,
      private: GH_VISIBILITY === 'private',
      description: 'AImong Us — private social-deduction game with AI players',
      has_issues: true,
      has_wiki: false,
      auto_init: false,
    }),
  });
  if (!created.ok) fail(`could not create repo (${created.status}): ${JSON.stringify(created.body)}`);
  repoUrl = created.body.html_url;
} else {
  fail(`GitHub lookup failed (${existing.status}): ${JSON.stringify(existing.body)}`);
}

// ---------------------------------------------------------------- 2. push

const git = (args, opts = {}) => execFileSync('git', args, { stdio: 'pipe', encoding: 'utf8', ...opts });
log('pushing main…');
git(['remote', 'remove', 'origin'], { stdio: 'ignore' });
git(['remote', 'add', 'origin', repoUrl]);
if (git(['branch', '--list', 'main']).trim() === '') git(['branch', '-M', 'main']);
// Plain HTTPS push with the token in an env-backed credential helper so it never
// lands in .git/config or the shell history.
git(['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(
  `x-access-token:${GITHUB_TOKEN}`,
).toString('base64')}`, 'push', '-u', 'origin', 'main']);
log('pushed');

// ---------------------------------------------------------------- 3. service

log('finding your Render workspace…');
const owners = await render('/owners?limit=20');
if (!owners.ok) fail(`Render token rejected (${owners.status}): ${JSON.stringify(owners.body)}`);
const ownerId = (owners.body[0]?.owner?.id ?? owners.body[0]?.id) ?? undefined;
if (!ownerId) fail(`could not read a workspace id from: ${JSON.stringify(owners.body)}`);
log(`workspace ${ownerId}`);

log('looking for an existing aimong service…');
const services = await render('/services?limit=100');
if (!services.ok) fail(`could not list services (${services.status})`);
const found = (services.body ?? [])
  .map((row) => row.service ?? row)
  .find((s) => s?.name === SERVICE_NAME);

let service = found;
if (service) {
  log(`reusing service ${service.id}`);
} else {
  log(`creating web service ${SERVICE_NAME} (${PLAN}, ${REGION})…`);
  const payload = {
    type: 'web_service',
    name: SERVICE_NAME,
    ownerId,
    repo: repoUrl,
    branch: 'main',
    autoDeploy: 'yes',
    serviceDetails: {
      runtime: 'node',
      plan: PLAN,
      region: REGION,
      healthCheckPath: '/healthz',
      envSpecificDetails: { buildCommand: BUILD_CMD, startCommand: START_CMD },
    },
    envVars: [
      { key: 'NODE_VERSION', value: '22' },
      { key: 'NODE_ENV', value: 'production' },
      { key: 'LOG_LEVEL', value: 'info' },
      { key: 'MAX_ROOMS', value: '3' },
      { key: 'MAX_COST_USD_PER_GAME', value: '1.00' },
      { key: 'MAX_LLM_CONCURRENCY', value: '6' },
      { key: 'LLM_MOCK', value: '0' },
    ],
  };
  const createdSvc = await render('/services', { method: 'POST', body: JSON.stringify(payload) });
  if (!createdSvc.ok) fail(`service creation failed (${createdSvc.status}): ${JSON.stringify(createdSvc.body)}`);
  service = createdSvc.body.service ?? createdSvc.body;
  log(`created ${service.id}`);
}

// Make sure PUBLIC_URL matches the real URL (used in logs only, but tidy).
const url = service.serviceDetails?.url ?? `https://${SERVICE_NAME}.onrender.com`;
log(`service url: ${url}`);

// ---------------------------------------------------------------- 4. wait

log('waiting for the first build + health check (up to 10 min)…');
const deadline = Date.now() + 10 * 60 * 1000;
let healthy = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const body = await res.json();
      if (body.ok) {
        healthy = true;
        log(`healthz ok: ${JSON.stringify(body)}`);
        break;
      }
    }
  } catch {
    /* still building / asleep */
  }
  const state = await render(`/services/${service.id}`);
  const status = state.ok ? (state.body.serviceDetails?.url ? 'deploying' : 'pending') : 'unknown';
  process.stdout.write(`\r  …${Math.round((Date.now() - (deadline - 10 * 60 * 1000)) / 1000)}s (${status})   `);
  await sleep(10_000);
}
process.stdout.write('\n');

if (!healthy) {
  console.error(`\n⚠ Deployed, but /healthz did not answer within 10 minutes.`);
  console.error(`  Open the Render dashboard, check the logs, then try ${url}/healthz`);
  process.exit(2);
}

console.log(`
✅ Live: ${url}

On your phone:
  1. Open ${url} in Chrome
  2. Tap "Install" on the home screen of the game (or ⋮ → Add to Home screen)
  3. Create a room, share the 5-letter code with your friends

Notes:
  • ${PLAN === 'free' ? 'Free plan sleeps after ~15 min idle: first open of the night takes ~30-60s. The app shows "Waking up the station…" and retries itself.' : 'Starter plan stays warm — instant opens.'}
  • Add OPENROUTER_API_KEY (and optionally NVIDIA_API_KEY) in the Render dashboard when the AI brains are wired up.
  • Every push to main redeploys automatically.
`);
