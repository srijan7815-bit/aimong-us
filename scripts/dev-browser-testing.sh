#!/usr/bin/env bash
# Sets up a headless Chromium for local UI testing in this sandbox.
#
# The sandbox runs as a non-root user on Debian 13 with no apt access, so we
# fetch the shared libraries Chromium needs straight out of the Debian pool and
# unpack them into /tmp/libs. Playwright is installed into /tmp/pw so it never
# pollutes the repo (and /tmp is disposable).
#
# Usage:  bash scripts/dev-browser-testing.sh
# Then:   cd /tmp/pw && LD_LIBRARY_PATH=$LIBS node <your-test>.mjs
set -euo pipefail

PW_DIR=/tmp/pw
LIBS=/tmp/libs
mkdir -p "$PW_DIR" "$LIBS"

if [ ! -d "$PW_DIR/node_modules/playwright" ]; then
  cd "$PW_DIR"
  npm init -y >/dev/null 2>&1 || true
  npm i playwright@latest --silent
  npx playwright install chromium
fi

if [ ! -f "$LIBS/.ready" ]; then
  WORK=$(mktemp -d)
  cd "$WORK"
  curl -s -o Packages.xz https://deb.debian.org/debian/dists/bookworm/main/binary-amd64/Packages.xz
  xz -dc Packages.xz > Packages
  python3 - <<'EOF'
import re, urllib.request, os
want = {
    "libnspr4", "libnss3", "libnss3-dev", "libatk1.0-0", "libatk-bridge2.0-0",
    "libatspi2.0-0", "libxdamage1", "libxkbcommon0", "libasound2", "libxcomposite1",
    "libxfixes3", "libxrandr2", "libdrm2", "libgbm1", "libcairo2", "libpango-1.0-0",
    "libxrender1", "libxi6", "libxtst6", "libx11-6", "libxext6", "libcups2",
    "libexpat1", "libdbus-1-3",
}
blocks = open("Packages").read().split("\n\n")
for b in blocks:
    name = re.search(r"^Package: (.+)$", b, re.M)
    if not name or name.group(1).strip() not in want:
        continue
    fn = re.search(r"^Filename: (.+)$", b, re.M).group(1).strip()
    out = fn.rsplit("/", 1)[1]
    if not os.path.exists(out):
        try:
            urllib.request.urlretrieve("https://deb.debian.org/debian/" + fn, out)
            print("fetched", out)
        except Exception as exc:  # noqa: BLE001
            print("skip", out, exc)
EOF
  for deb in *.deb; do dpkg-deb -x "$deb" "$LIBS" 2>/dev/null || true; done
  touch "$LIBS/.ready"
  cd /; rm -rf "$WORK"
fi

echo
echo "Ready. Use:"
echo "  export LD_LIBRARY_PATH=$LIBS/usr/lib/x86_64-linux-gnu:$LIBS/lib/x86_64-linux-gnu"
echo "  cd $PW_DIR && node <test>.mjs"
