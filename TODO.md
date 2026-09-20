# To finish later

## Deployed (2026-09-19)

Production (`timelefttolive`) has the functions, hosting, Firestore rules and indexes, and Storage rules from commit `b86b7dc`. Not yet checked with a signed-in browser: the email verification flow and paired-session edit and delete.

Production and staging hosting are at commit `d34dd44`, which draws each week's events as coloured wedges of its square and makes the squares about 6% bigger. Before it came `08c5069` (main calendar redesign) and `6e6b6c0` (Activity time wheel). Each went to staging first, then production.

Everything else (functions, Firestore and Storage rules, indexes) is from `b86b7dc` on both.

Firebase Hosting's CDN can serve the previous `index.html` for a minute or two after a deploy, so check the served asset names (or wait) before concluding a deploy did not take.

Not checked with real data yet: the calendar wedges, serif face and phone layout, and the Activity wheel's 8 degree minimum slice and icons. Firebase Storage has never been set up on staging, so `storage.rules` was not deployed there (set it up from the console, then `firebase deploy --only storage --project timelefttolive-stg-go`). Still to do on staging: sign in with an email/password account and check the verification notice and invite flow, and edit and delete a paired session in the Activity dashboard.

## Fixed and deployed

The two Activity dashboard bugs are fixed and tested (details in [docs/activity-dashboard.md](docs/activity-dashboard.md)):

- Editing an entry with no location now works, and `location: null` clears the location. The dialog leaves `location` out of the request when it is unchanged.
- Deleting a paired arrive/leave session now removes both events and writes both tombstones in one transaction. The dashboard passes the departure event as `linkedEventId`.

The `email_verified` rules change from the same day is deployed too. Email/password viewers who accepted an invite without verifying lose access until they verify; Google accounts are unaffected.

## Housekeeping

- Everything is pushed (`origin/main` is at the merge commit `7c43551`). `main` has no upstream configured, so `git push` needs `origin main` spelled out, or run `git push -u origin main` once.
- The staging plan (`docs/timelefttolive-life-event-ingestion-staging-plan.md`) ends with the owner-run smoke test still pending, and nothing records whether it was ever run. Confirm and record the outcome, or leave the note as is.
- Not covered by any doc: the `gridlineai` cross-project access setup (which service account needs which Firestore and Storage grants). It is only mentioned in `docs/activity-dashboard.md`.
- Optional, no behaviour change: `src/utils/lifeEventUtils.js` (about 2,000 lines) and `src/components/ActivityDashboard.jsx` (about 1,500 lines) are candidates for splitting.
- CI (`.github/workflows/ci.yml`) is pushed and its first run passed on commit `27ba39d`, both jobs, all suites. It has no deploy step; deploys are still manual.
- Storage rules still have no tests (needs the Storage emulator).

Delete this file once the items are done.
