# Staging deploy (from git)

Staging (`staging.events.selfiebox.co.za`) is deployed **from git**, off the
`staging` branch, via a single canonical checkout on the VPS:

    /root/selfiebox-staging   (git clone, tracks origin/staging)

## Workflow going forward

1. Make the change on the `staging` branch (commit + push), **or** edit directly
   in `/root/selfiebox-staging` and commit/push from there.
2. Deploy the part you changed:

   ```bash
   # backend (Convex functions -> :3210)
   ssh selfiebox-vps '/root/selfiebox-staging/deploy/staging-convex.sh'

   # frontend (dashboard UI -> /var/www/selfiebox-staging)
   ssh selfiebox-vps '/root/selfiebox-staging/deploy/staging-frontend.sh'
   ```

   Each script does `git pull --ff-only origin staging` first, so it always
   deploys exactly what's on the branch.

## Not in git (live on the VPS only)
- `/root/selfiebox-staging/.env.local` — `CONVEX_SELF_HOSTED_URL` +
  `CONVEX_SELF_HOSTED_ADMIN_KEY` for the Convex deploy (gitignored).
- `/opt/selfiebox-staging-deploy/node_modules` — shared node_modules (convex CLI
  + react-scripts) mounted into the build container; no `npm install` needed.

## Relationship to LIVE
- `main` = live. `staging` = `main` + website integration (see `../DEPLOYMENT.md`).
- To ship a staging feature to live, merge/cherry-pick it into `main`; Vercel
  auto-deploys `main`. The live Convex backend (:3220) is deployed separately and
  deliberately — never as a side effect of a staging deploy.
- **Data never syncs.** Staging has demo data.
