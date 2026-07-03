# SelfieBox Events Dashboard — branches, environments & deploys

## Two branches, two environments

| Branch    | Environment                          | Frontend host | Convex backend                     | Data       |
|-----------|--------------------------------------|---------------|------------------------------------|------------|
| `main`    | **LIVE** `events.selfiebox.co.za`    | Vercel (auto) | self-hosted VPS `:3220` (`convex-live-backend-1`) | real       |
| `staging` | `staging.events.selfiebox.co.za`     | VPS nginx     | self-hosted VPS `:3210` (`convex-selfhost-backend-1`) | demo/fake  |

**Data never syncs** between them. Staging holds demo data that *looks* real but is not.

## `staging` = `main` + website integration (only)

The only code difference is the marketing-site integration for `selfiebox.co.za`:
- Backend: `websiteQuotes.js`, `websiteQuoteEmail.js`, `websiteContactEmail.js`,
  `websiteStats.js`, `http.js`, + website fields in `events.js`/`schema.js`.
- Frontend: the footer **"Website Stats"** popup in `App.js`.

Why staging-only: the live marketing site's quote/contact forms POST to the
**staging** Convex `:3210` (deliberate — see the website repo notes). The
website-stats popup is the piece that may later be promoted to `main`/live.

> ⚠️ "Staging" always means `staging.events.selfiebox.co.za`. There was once a
> stale orphan git `staging` branch (archived as tag `archive/staging-old-20260519`);
> ignore it. The current `staging` branch IS the live staging environment.

## Deploying

**LIVE frontend** — push to `main`; Vercel auto-builds & promotes to production.
  Rollback: Vercel dashboard → previous deployment → Promote to Production.

**LIVE Convex backend `:3220`** — NOT via git/Vercel. Deployed manually over an
  SSH tunnel (`npx convex deploy`). Treat as sacred; change only deliberately.

**STAGING** — canonical checkout on the VPS: `/root/selfiebox-staging` (tracks
  `origin/staging`). Convex deploy source: `/root/staging-sync`. Frontend build
  source: `/root/dash-build` → rsync `build/` to `/var/www/selfiebox-staging`.
  (Frontend build needs a temp swapfile — VPS RAM is tight.)

## Revert anchors (2026-07-03 alignment)
- Git: tag `pre-alignment-20260703` (= previous live commit `183eadd`).
- Vercel: deployment `78uuthiui...` (previous production build).
