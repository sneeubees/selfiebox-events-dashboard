# Google Reviews connection

Open Information & Reporting > Website > Google Reviews in the events dashboard.
The integration reads managed profiles, average ratings, counts, review text,
review dates and existing replies. Reviews load 50 at a time, newest updated first.
Review content remains in the browser session; it is not persisted to the database,
localStorage, static site files, or logs. No reviews are posted or replied to.

## Google Cloud setup

1. Use the existing Google Cloud project approved for SelfieBox's own Business
   Profile API use, or request approval:
   https://developers.google.com/my-business/content/prereqs
2. Enable My Business Account Management API, My Business Business Information
   API and Google My Business API (reviews v4). Check approved, nonzero quotas.
3. Reuse the existing web OAuth client for Analytics, or configure a separate
   GBP_OAUTH_CLIENT_ID and GBP_OAUTH_CLIENT_SECRET in the Convex backend.
4. Add this exact authorised redirect URI to that OAuth client:
   https://api.events.selfiebox.co.za/convex-site/oauth/google-reviews/callback
5. Configure the consent screen for business.manage. For an external app still in
   testing, add the business owner as a test user and account for token expiry.
6. Set GBP_REDIRECT_URI to the callback above in the live Convex backend.
7. An approved dashboard admin clicks Connect Google and personally approves
   access using the Google account managing the four SelfieBox profiles.
8. Load profiles, select each branch, verify its rating/count against Google and
   use Load more reviews to check pagination. The source links belong to the
   selected profile; nothing infers a branch from review wording.

Google exposes the broad business.manage scope, not a dedicated review-read-only
scope. This implementation only makes GET requests to Business Profile APIs.
OAuth codes use PKCE and ten-minute single-use state. Refresh tokens stay in the
existing server-side integrations table and are never returned to the browser.
Disconnect removes this integration's token and pending OAuth states. It does not
revoke the shared Google client grant because that could interrupt Analytics;
the owner can separately revoke consent in their Google account.

## Deployment and verification

Backend: existing Convex self-hosted live deployment. Frontend: existing main
branch Vercel build. No website HTML or review schema changes are required.
Run `node --test google-reviews.test.mjs` and the dashboard production build.
Without Google approval/consent, mock tests validate pagination/error/auth/state
handling, but cannot establish that the owner's profiles or reviews are accessible.

The public website's existing testimonials remain unchanged. Public display or
scheduled caching should be a separate reviewed change with attribution, expiry
and deletion handling under Google's API content policies.
