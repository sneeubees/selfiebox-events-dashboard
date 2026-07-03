#!/usr/bin/env bash
# Deploy the STAGING Convex backend (:3210) FROM this git checkout.
# Source of truth: origin/staging. Run on the VPS from /root/selfiebox-staging.
#
#   ssh selfiebox-vps '/root/selfiebox-staging/deploy/staging-convex.sh'
#
# Requires (already on the VPS, NOT in git):
#   - /root/selfiebox-staging/.env.local  ->  CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY
#   - /opt/selfiebox-staging-deploy/node_modules  (has the convex CLI)
set -euo pipefail
REPO=/root/selfiebox-staging
cd "$REPO"

echo ">> syncing to origin/staging"
git pull --ff-only origin staging

echo ">> deploying Convex functions to STAGING (:3210)"
mkdir -p "$REPO/.tmp"
docker run --rm --network host \
  -e CONVEX_TMPDIR=/app/.tmp \
  -v "$REPO":/app \
  -v /opt/selfiebox-staging-deploy/node_modules:/app/node_modules \
  -w /app node:20 node node_modules/.bin/convex deploy --yes

echo ">> done. staging Convex now == git $(git rev-parse --short HEAD)"
