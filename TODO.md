# To finish later

**2026-11-15, evening: PR #7 merged. `main` (c08d80b) is level with production.** Hosting, the activity-entry functions, the Firestore rules and the index overrides were redeployed from `main` right after the merge; PR #6 and the earlier branches are all contained in it. The "merge that PR" notes in the sections below are done.

## Deployed (2026-11-15, evening)

Hosting, the functions `deleteActivityEntry`, `restoreActivityEntry` and `cleanupLifeEventIngestionArtifacts`, the Firestore rules and the index overrides deployed to production from `feat/crystal-wheel` at `141a646` (PR #7). Served bundle `index-CllxvMUW.js`.

- A delete keeps a copy in `lifeEventRecycleBin` for 90 days; `restoreActivityEntry` brings it back and lifts the tombstone; the dashboard's "Recently deleted" panel (under Tracking status) restores with one tap; the delete dialog warns before an arrival or departure goes. `npm run test:functions` 135 pass, `npm run test:frontend` 383 pass.
- Not yet checked signed in: open the Recently deleted panel (the Nov 15 arrival is not in it, it was restored by hand before the bin existed; it will list future deletes), and restore something deleted on purpose.
- The matching GridlineAI work (visits logged from drives, the tracking health check, the stale-trigger redeploy) is PR #15 in that repo; `docs/tracking-reliability.md` there describes the whole chain.

## Deployed (2026-11-15)

Hosting deployed to production from `feat/crystal-wheel` at `42789ee` (PR #7, on top of the crystal wheel below), so merge that PR to bring `main` level with production. Functions, rules and indexes are unchanged.

- An open Home stay now keeps running for up to 7 days (other categories still 36 hours), and an open stretch is shown on every day it covers: `open` on the days before today, `active` (in progress) today. Before, a quiet weekend at home showed no Home at all until the next departure arrived, and the Friday arrival sat there as "incomplete", which is what led to it being deleted on Nov 15. Checked with the app's own session builder on the real events: Fri Nov 13 Home from 10:17 pm, Sat Nov 14 Home all day, Sun Nov 15 Home to now, matching the Life Cycle app's 41-hour Home stretch. `npm run test:frontend` 381 tests pass; the served bundle matches the build (`index-Cr-4o7D1.js`).
- Data repair the same day (no code): the deleted Fri Nov 13 10:17 pm `arrive_home` was restored and the Raging Bull darts visit (7:34 to 9:57 pm) added, by `~/Documents/ChatBot/scripts/repair-home-2026-11-15.cjs`; a dashboard delete writes a tombstone that blocks the source from re-creating the event (`docs/activity-dashboard.md`, "Callable functions"). GridlineAI's two Shortcut delivery triggers run an Oct 8 mapper and conflict with the inline delivery on every place visit; that is documented in the GridlineAI repo (`docs/time-left-gridlineai-sync.md`) and needs a redeploy there.
- Not yet checked signed in with the real profile: Saturday and Sunday showing Home on the wheel and in the day list, and that the "open" day sessions read naturally in the hub (they show the clipped end, e.g. 12:00 AM).

## Deployed (2026-11-14)

Hosting deployed to production from `feat/crystal-wheel` at `f5c010d` (PR #7; first at `e46f9e3` with the Jewel material, then `7288ff6` Clear crystal, `8292f46` the hub click, `71bc080` the phone tooltip, and `f5c010d` no tooltip at all plus the shinier glass), so merge that PR to bring `main` level with production. Functions, rules and indexes are unchanged.

- The Activity time wheel is drawn as lit crystal (the "Clear crystal" material from the study in `scripts/wheel-study/`; Jewel went live first and Marwan asked for crystal the same day), with one stroke icon set replacing the emoji, label ink by slice luminance, a dashed edge on boosted slices, and a lens hub with the K2 logo etched.
- Clicking the hub while a category is selected shows every activity again (all wedges fully lit). There is no tooltip: pointing at or focusing a slice or bead, and the selection, all speak through the hub (two lines on a phone).
- New on the wheel: tooltips, Share | Clock layout for a day, a comparison ring (previous period or recent normal), untracked time as a frosted segment, moments as beads on the rim, target marks and a target editor (profile field `activityTargets`, written by `saveActivityTargets`), worth-noting facts, small multiples for a week or a month, keyboard shortcuts, and Save as image (2048 px PNG).
- Checked before the deploy in the interactive preview (desktop and 390 px, dark and light): entrance, morph, selection lift, tooltips, clock layout, comparison ring, beads, export. Not yet checked signed in with the real profile: the target editor writing to Firestore, the real data in Clock layout, and the Normal comparison with real history. `npm run test:frontend` 376 tests pass; the served bundle matches the build (`index-DRyfW9sr.js`).

## Deployed (2026-11-03)

Hosting deployed to production from `fix/sleep-night-on-day-chart` at `615db0b` (PR #6), so merge that PR to bring `main` level with production. Functions and rules are unchanged.

- The day's 24-hour timeline draws the night that ended that morning from its bedtime. The chart then starts in 6-hour steps before midnight (6 PM for a usual night, noon at the earliest), with the evening before shaded and a line at midnight; the night's time and range in the list start at bedtime too. Anything else carried over from the day before still starts at midnight. Axis labels and hour lines are placed by the clock (right on the 25-hour day the clocks go back).
- The chart legend had no spacing (`.cycle-activity-stream p` outranked it); fixed.
- The wheel's centre and the Sleep analysis rows show the night from its bedtime too (they said 12:00 AM – 3:37 AM); sleep sessions keep the real bedtime as `nightStartAt`.
- Checked live, desktop and phone width: Nov 3 shows Sleep from 10:51 PM to 3:37 AM, 3h 58m.

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

## Usefulness plan

`docs/usefulness-plan.md` is the ranked plan for making the app useful week to week (from `docs/prompts/make-it-useful-prompt.md`), approved 2026-11-26 in its ranked order, with measurements and new journal entries private by default. Item 0 (the Surface can build, test and run the emulators; `npm run seed:emulators` makes a demo calendar) is on `feat/windows-dev-setup`. Item 1 (weekly review) is on `feat/weekly-review`, stacked on item 0: it adds `weeklyReviews` and its rules, so it needs a rules deploy as well as hosting when it ships. Item 2 (lived weeks) is on `feat/lived-weeks`, stacked on item 1; hosting only, plus setting "This schedule began on" in Edit kids and schedule for the With the boys view. Item 3 (kids' milestones and heights) is on `feat/kids-milestones-measurements`, stacked on item 2; it adds `childMeasurements` and its rules (rules deploy plus hosting). Items 0 to 3 merged and deployed 2026-11-26 (hosting and Firestore rules, `main` at 32fc811). The Surface has no gcloud credentials for the migration script, so the heights move in the app instead (`feat/move-height-notes`): Move height notes, Copy them in, then Take them off the profile, per child. Item 4 (things to do before it's too late) is on `feat/things-to-do`: adds `plans` and its rules, so rules plus hosting when it ships. Item 5 (tracking health) is on `feat/tracking-health`: hosting plus **one new function**, deployed on its own with `firebase deploy --only functions:createActivityEntry --project timelefttolive` (no function reads `functions/.env`). Item 6 (phone install and quick capture) is on `feat/phone-capture`: hosting only (the new cache headers come with it). Items 4 to 6 merged and deployed 2026-11-26 (`main` at 6986dda, plus the `createActivityEntry` function). Item 8 (Sunday digest, notification and email) merged and deployed 2026-11-27 (`main` at ddfad6c: rules, hosting and `functions:sendWeeklyDigests,functions:weeklyDigest`, after the owner set the Web Push key and the two `DIGEST_SMTP_*` secrets); the owner's test send arrived on both channels. Item 7 comes in three parts: on this day merged and deployed 2026-11-27 (hosting only; `main` at 401fb41 with the fix for long events), search merged and deployed 2026-11-27 (`main` at c91cb07, hosting only), and year in review is on `feat/year-in-review` (hosting only, no new paths or rules). Item 9 follows.

## Housekeeping

- Everything is pushed (`origin/main` is at the merge commit `7c43551`). `main` has no upstream configured, so `git push` needs `origin main` spelled out, or run `git push -u origin main` once.
- The staging plan (`docs/timelefttolive-life-event-ingestion-staging-plan.md`) ends with the owner-run smoke test still pending, and nothing records whether it was ever run. Confirm and record the outcome, or leave the note as is.
- Not covered by any doc: the `gridlineai` cross-project access setup (which service account needs which Firestore and Storage grants). It is only mentioned in `docs/activity-dashboard.md`.
- Optional, no behaviour change: `src/utils/lifeEventUtils.js` (about 2,000 lines) and `src/components/ActivityDashboard.jsx` (about 1,500 lines) are candidates for splitting.
- CI (`.github/workflows/ci.yml`) is pushed and its first run passed on commit `27ba39d`, both jobs, all suites. It has no deploy step; deploys are still manual.
- Storage rules still have no tests (needs the Storage emulator).

Delete this file once the items are done.
