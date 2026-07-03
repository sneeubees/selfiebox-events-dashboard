#!/usr/bin/env bash
# Build the STAGING dashboard frontend FROM this git checkout and publish it.
# Source of truth: origin/staging. Run on the VPS from /root/selfiebox-staging.
#
#   ssh selfiebox-vps '/root/selfiebox-staging/deploy/staging-frontend.sh'
#
# Reuses /opt/selfiebox-staging-deploy/node_modules (has react-scripts) so there
# is no npm install. CRA build needs ~2G+; a temp swapfile is added if RAM is low
# and always removed afterwards. REACT_APP_* vars below are build-time public
# values (Convex URL + Clerk publishable key) — safe to keep in git.
set -euo pipefail
REPO=/root/selfiebox-staging
DOCROOT=/var/www/selfiebox-staging
SWAP=/swapfile-stagingbuild
cd "$REPO"

echo ">> syncing to origin/staging"
git pull --ff-only origin staging

ADDED_SWAP=0
cleanup() { if [ "$ADDED_SWAP" = 1 ]; then swapoff "$SWAP" 2>/dev/null || true; rm -f "$SWAP"; echo ">> temp swap removed"; fi; }
trap cleanup EXIT
FREE=$(free -m | awk '/^Mem:/{print $7}')
if [ "${FREE:-0}" -lt 2200 ] && ! swapon --show=NAME --noheadings | grep -q "$SWAP"; then
  echo ">> low RAM (${FREE}M free) -> adding temp 3G swap"
  fallocate -l 3G "$SWAP" 2>/dev/null || dd if=/dev/zero of="$SWAP" bs=1M count=3072
  chmod 600 "$SWAP"; mkswap "$SWAP" >/dev/null; swapon "$SWAP"; ADDED_SWAP=1
fi

echo ">> building staging frontend"
docker run --rm \
  -e CI=false -e GENERATE_SOURCEMAP=false -e DISABLE_ESLINT_PLUGIN=true \
  -e REACT_APP_CONVEX_URL=https://staging.events.selfiebox.co.za/convex \
  -e REACT_APP_CLERK_PUBLISHABLE_KEY=pk_test_aG90LWJsdWVnaWxsLTE3LmNsZXJrLmFjY291bnRzLmRldiQ \
  -v "$REPO":/app \
  -v /opt/selfiebox-staging-deploy/node_modules:/app/node_modules \
  -w /app node:20 node node_modules/.bin/react-scripts build

echo ">> publishing to $DOCROOT"
rsync -a --delete "$REPO/build/" "$DOCROOT/"
echo ">> done. staging frontend now == git $(git rev-parse --short HEAD)"
