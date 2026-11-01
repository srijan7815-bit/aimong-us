# DEPLOY.md — getting AImong Us onto your phone as an app

Two things happen here: the game runs on **Render** (one always-on web service
that holds the game state and the WebSocket), and your phone runs it as an
**installed app** (home-screen icon, fullscreen, no address bar) that talks to
that Render URL.

---

## A. Deploy the server to Render (one time, ~5 minutes, no card)

**Option 1 — the blueprint (recommended).** Everything is already in
`render.yaml`.

1. Put this repo on GitHub (see §C if you want me to do it).
2. render.com → sign in with GitHub (free, no card) → **New +** → **Blueprint**.
3. Pick the repo. Render reads `render.yaml` and shows one web service,
   `aimong-us`. Tap **Apply**.
4. When it asks for `PUBLIC_URL`, paste the URL Render gives you
   (e.g. `https://aimong-us.onrender.com`) — or leave it blank, it is only used
   for logs; the app always talks to its own origin.
5. Wait for the first build (~2–4 min). Open `<your-url>/healthz` — you should
   see `{"ok":true,...,"rooms":0}`.

**Option 2 — manual.** New + → Web Service → repo → Runtime **Node** →
Build `npm i -g pnpm@12.16.1 && pnpm install --frozen-lockfile && pnpm -r build`
→ Start `node apps/server/dist/index.js` → Health check path `/healthz` →
Instance count **1** (never scale: game state is in memory) → Node version **22**.

### Keys (only when the AI brains land, M5)

Dashboard → your service → **Environment**:

| Key | What it is |
|-----|-----------|
| `OPENROUTER_API_KEY` | your OpenRouter key (paid model, ~$5 lasts a long time at the cost cap) |
| `NVIDIA_API_KEY` | optional free second provider |
| `ADMIN_TOKEN` | optional, protects `/admin` |

Never put keys in the repo. Nothing else is needed for what exists today.

### Free plan reality check

Free instances **sleep after ~15 minutes idle**. First open of the night takes
~30–60 s; the app shows "Waking up the station…" and retries by itself, so it
looks slow but never broken. Two ways to make it instant:

- Bump the service to **Starter** ($7/mo) on game night, or
- Keep it warm for free: create a free UptimeRobot monitor pinging
  `https://<your-url>/healthz` every 10 minutes.

---

## B. Put it on your phone as an app (once, ~20 seconds)

1. Open the Render URL in **Chrome on Android**.
2. Tap the **Install** button on the home screen of the game (or Chrome's ⋮ →
   *Add to Home screen* / *Install app*).
3. A pod-bot icon appears on your home screen. It opens fullscreen, keeps its
   own session, and reconnects to your lobby even if you switch apps.

Already works today: home-screen icon, splash, fullscreen, offline shell (the
app still opens with no signal and tells you why), 60-second seat recovery after
a phone lock or refresh.

iOS: Safari → Share → *Add to Home Screen*. Haptics do not exist on iOS; the
game hides them silently.

---

## C. If you want me to do the deploy

I need two secrets, pasted into this chat (they never touch the repo):

1. **GitHub fine-grained token** — Settings → Developer settings → Fine-grained
   tokens → *Generate new token*: Repository access = *All repositories* (or a
   single new `aimong-us` repo), Permissions = **Contents: Read and write**,
   **Administration: Read and write** (so I can create the repo).
2. **Render API key** — Account Settings → API Keys → *Create API Key*.

With those I will: create the private repo, push `main`, create the Render web
service from `render.yaml`, set `PUBLIC_URL`, wait for the health check, and send
you the clickable URL plus the install steps. You can revoke both keys right
afterwards.

---

## D. Updating the game later

Push to `main` → Render rebuilds and redeploys automatically (`autoDeploy: true`).
The installed app notices the new build on next launch and offers a one-tap
reload. Nothing to reinstall.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| "Cannot reach the station" on first open | Free instance asleep. Wait ~60 s; the screen keeps retrying. |
| Stuck on "Waking up the station…" for minutes | The service failed to boot. Check Render logs for `AImong Us M? listening`. |
| Phone shows a stale version | Close the installed app completely and reopen (service worker updates). |
| Lobby full / "station at capacity" | `MAX_ROOMS=3` by default; raise it in env. Each room can host 12 seats. |
| Connection drops mid-game | Phones on mobile data lose sockets; the app reconnects within 60 s and restores the seat. |

## Install the Android app (side-load, no Play Store)

1. Get the APK — easiest is the release link, open it on the phone:
   **https://github.com/srijan7815-bit/aimong-us/releases/download/v0.1.2-android/aimong-us-0.1.2.apk**
   (also in `docs/app/aimong-us-0.1.2.apk`, or as the `aimong-us-apk` artifact of any
   **android-apk** CI run).
2. Open the file on the phone. Android will ask to allow installs from that app —
   allow it, then tap Install.
3. Launch **AImong Us**. The app is a native shell around the bundled client and
   talks only to `https://aimong-us.onrender.com`; nothing needs configuring.
4. Cold start after the free Render plan has slept shows "Waking up the station…"
   for 30–60 s. That is the server waking, not the app hanging.

Building it yourself:

```bash
export JAVA_HOME=/path/to/jdk-21 ANDROID_HOME=/path/to/android-sdk
cd mobile && npm install
cd .. && SERVER_URL=https://aimong-us.onrender.com bash scripts/build-apk.sh
# -> docs/app/aimong-us-<version>.apk (+ .sha256)
```

## The owner console (the Commons)

Open `https://aimong-us.onrender.com/console` on any device.

1. **Message the house** — type, hit Broadcast. Delivered to every resident.
2. **Team code** — create a room in the app, copy its 5-letter code, paste it here,
   choose how many residents to send, add an optional note, hit Send. They take
   seats in that lobby, badged AI, and come home when the room closes.

To lock the console against strangers: Render → **aimong-us** → Environment →
add `CONSOLE_KEY` = a long random string → save (the service redeploys). The page
then asks for that key once and keeps it in your browser only. Without it the
console works but shows a red "this page is open to anyone" banner.
