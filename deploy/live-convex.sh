#!/usr/bin/env bash
# Deploy the LIVE Convex backend (:3220) FROM git main. Run on the VPS:
#
#   ssh selfiebox-vps '/root/selfiebox-live/deploy/live-convex.sh'
#
# Live is sacred - only run this deliberately, after the change has been
# verified on staging. Requires (on the VPS, NOT in git):
#   - /root/selfiebox-live/.env.local -> CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY
#   - /opt/selfiebox-staging-deploy/node_modules (has the convex CLI)
set -euo pipefail
REPO=/root/selfiebox-live
cd "$REPO"

convex() {
  docker run --rm --network host -e CONVEX_TMPDIR=/app/.tmp \
    $(grep -v '^#' "$REPO/.env.local" | sed 's/^/-e /') \
    -v "$REPO":/app -v /opt/selfiebox-staging-deploy/node_modules:/app/node_modules \
    -w /app node:20 node node_modules/.bin/convex "$@"
}

echo ">> syncing to origin/main"
git checkout -- src/convex/_generated 2>/dev/null || true
git pull --ff-only origin main

echo ">> deploying Convex functions to LIVE (:3220)"
mkdir -p "$REPO/.tmp"
convex deploy --yes

# A deploy swaps the Node helper's code bundle; the next Node action has to
# unpack it. Two arriving at once on a cold helper wedged it on 2026-09-18
# (PDF quote/invoice numbers silently stopped), so warm it with single calls
# before staff hit it. The first call may fail while a stale helper is dropped.
echo ">> warming the Node action helper"
convex run documentNumbers:warmup '{}' >/dev/null 2>&1 || true
convex run documentNumbers:warmup '{}'

echo ">> done. live Convex now == git $(git rev-parse --short HEAD)"
