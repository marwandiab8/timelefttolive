# To finish later

## Deployed (2026-11-02, evening)

Hosting deployed to production from `feat/still-ahead` at `400d2bc`, which is `feat/kids-info-schedule` plus `10bb7a8` (`fix/spotify-listening-time`) and the Still ahead feature. Merge in that order (`feat/dartconnect-source`, `feat/kids-info-schedule`, `fix/spotify-listening-time`, `feat/still-ahead`) to bring `main` level with production. Functions and rules are unchanged.

- Spotify minutes are counted as listening stretches (first start to last finish, a new stretch after a finish, 2-hour gap limit, location ignored). Before, a start could pair with a stray finish a day later (Oct 27 showed 18.7 h, the all-time total about 25,000 h) while drives counted seconds. Checked live: Oct 26 Music shows 1h 35m.
- Still ahead: weekends, summers, Christmases and birthdays before the target age under the summary, and per child before 18 with whose week the next birthday falls in. Checked live with the real profile: 1,999 / 38 / 39 / 39.

## Deployed (2026-11-02)

Hosting deployed to production from `feat/kids-info-schedule` at `aa5b829` (`feat/dartconnect-source` plus the kids panel), so merge both branches to bring `main` level with production. Functions and rules are unchanged. The "Time with my boys" panel now counts each child until his own 18th birthday (it used to count until the youngest's for all of them), reads the schedule's start date both ways, says who has them this week, and shows a card per child with grade (moves up each September), school and free-form details. Checked after the deploy, signed in with the real profile: this week (Nov 2 to 8) with him, other parent from Nov 9; David 44 weeks, Myles 65, Joseph 117, Keaton 129.

## Deployed (2026-10-25)

Every function and hosting deployed to production from `feat/dartconnect-source` at `8f9dd7d` (`main` at `f159521` plus that commit), so merge that branch to bring `main` level with production. It adds DartConnect as a source app, **Create token** / **Replace token** in Linked Sources, darts always counting as Darts, and `completed_darts_match` revisions. Checked after the deploy: the served bundle is the new build and `/api/v1/life-events` answers 401 without a token. DartConnect matches arrive from the DartConnect Inbox Apps Script (`~/Documents/dartconnect-inbox`) once its connection token is set up (its README).

## Deployed (2026-10-24)

Merged (#2, #3) and deployed from `main` at `dceb30c`: every function (the two calendar ones were already current) and hosting, so production matches `main`. Firestore rules are unchanged since `81a9190`, and the two `expiresAt` index overrides added later are already in production.

Production has the new `syncCalendarEventToLifeEvents` trigger (us-central1, given the same 30-day image cleanup policy as northamerica-northeast1) and hosting from `feat/calendar-daily-events`: main-calendar events as all-day Calendar entries in the Activity dashboard. The 12 existing events were added with `npm run sync:calendar-life-events -- --project=timelefttolive --apply` (27 day entries), and a test event confirmed the trigger adds and removes them live. The other functions were not redeployed; they don't need this change. Staging has neither yet.

Later the same day: ongoing events (fbbe19d). Production has the updated trigger, the new `carryOngoingCalendarEvents` (daily at 00:05 Toronto) and the hosting. "With Ashley" was set ongoing: 2,017 daily entries from 2021-04-17 to 2026-10-24, one more each night.

## Deployed (2026-09-19)

Production (`timelefttolive`) has the functions, hosting, Firestore rules and indexes, and Storage rules from commit `b86b7dc`. Not yet checked with a signed-in browser: the email verification flow and paired-session edit and delete.

Production and staging are both at the latest: hosting at `e04d6b2` (readable text in the light theme, with a stylesheet contrast test) and Firestore rules and indexes at `81a9190`, which fix the "Missing or insufficient permissions" error in the week, month and year views. That error came from a collection-group query on `externalItems` that the rules never allowed. The fix also adds the two `COLLECTION_GROUP` indexes it needs and one for the invite lookup on `viewers.email`. Before those came `55f5e7a` (week view showed the previous week), `d34dd44` (event wedges), `08c5069` (main calendar redesign) and `6e6b6c0` (Activity time wheel).

The indexes took about 3.5 minutes to build on staging and about 5 on production. Firestore reported them ready a moment before queries could use them, so verify with a real query (below) before relying on them.

Functions are from `b86b7dc` on both.

To check index state: `gcloud firestore indexes composite list --project=<id>` (look for `CREATING` or `READY`). The emulator does not enforce indexes, so also run the three collection-group queries with the Admin SDK, which skips rules but not index checks.

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
