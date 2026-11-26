# Making Time Left To Live useful week to week

Phase 0 of `docs/prompts/make-it-useful-prompt.md`: the brief checked against the code on `main` (`099ac80`, level with production), plus what else turned up, ranked by how much each item changes a normal week for the effort. Approved 2026-11-26 in this order, with measurements and new journal entries private by default. Sizes: S is a day or less, M a few days, L a week or more.

## What the code says about the brief

| # | Brief | Verdict |
| --- | --- | --- |
| 1 | Lived weeks are all the same | **True.** `LifeHeatmap.jsx` colours a cell past/current/future and adds wedges only for `events` (the calendar's own events). It never loads daily entries, attachments, `lifeEvents` or the custody schedule. |
| 2 | No weekly loop | **True.** There is no review, rating or intention anywhere. `evaluateTarget` (`activityTargets.js`) can already judge a week, but only the wheel calls it. |
| 3 | Kids panel doesn't plan | **True.** `FamilyTimePanel.jsx` shows the countdown, the next birthday and whose week it falls in, and nothing else. `custodyUtils.js` already knows every future week with you, so the plans and milestones have the data they need. |
| 4 | Child details are free text | **True**, and there is a privacy catch (below): the details live on the calendar document, which viewers can read. |
| 5 | No bucket list | **True.** `whatsLeft.js` counts summers, Christmases and birthdays, but nothing can be attached to them. |
| 6 | Data quality hidden; no manual create | **True.** `lifeEvents` is `write: if false` for clients and there is no create callable. The four "↳ Sleep" rows are rows nested inside a session of another category, usually a Home stay (`lifeEventUtils.js` around line 1362). Nesting explains the arrow but not four nights of 4 to 6 hours in one day, so that day's raw events need a read-only look before anything is built. |
| 7 | No phone install | **Mostly true.** There is an `apple-touch-icon`, so Add to Home Screen gives an icon, but there is no manifest, no `apple-mobile-web-app-capable` meta tag and no service worker, so it opens as a Safari tab. |
| 8 | No search or look-back | **True.** |
| 9 | Nothing reaches you | **True.** There are no scheduled functions apart from `carryOngoingCalendarEvents` and the cleanup job. |
| 10 | Housekeeping | **True** as listed in `TODO.md` and `docs/activity-dashboard.md` ("Known issues"). |

## Found beyond the brief

- **This machine can't run the project yet.** There's no `node_modules`, no Java (needed for the rules and hosting tests), and Node is v26 while functions target Node 22. Also, `npm run dev:emulators` sets its variables the POSIX way (`VAR=x vite`), which fails under npm on Windows, so the emulator click-through can't run on the Surface.
- **Day notes and attachments default to `viewers`.** `DayDetailView.jsx` starts the visibility selector on `viewers` for notes, files and links, so anything written there is shared unless it's changed each time. That's the wrong default for a journal, and quick capture (item 6) would make it worse.
- **Viewers can read the whole calendar document.** The rule `allow read: if isCalendarOwner() || isAcceptedViewer(calendarId)` means viewers get the children (including every detail row, so the heights too), the custody schedule and `activityTargets`. `FamilyTimePanel` is also rendered for viewers. That may be fine for family, but new private data must not go on the calendar document. Every new collection below is a subcollection with its own rules.
- **The app uses three different weeks.** A life-calendar square starts on your birthday's weekday each year (52 cells; the last one takes the year's leftover days). Activity weeks run Monday to Sunday. Custody weeks start on the schedule's anchor day. A weekly review has to pick one. I'd key it to the life-calendar square, because that's the cell it colours, and compute that square's activity over its exact dates. `getPeriodBounds` already accepts arbitrary bounds.
- **The custody schedule repeats back forever.** That's fine for the future, but marking past weeks "with the boys" needs a start date for when the arrangement began, or it would colour weeks before it existed.

## Ranked plan

### 0. Make the Surface able to build, test and run the emulators (S) — done on `feat/windows-dev-setup`
Install dependencies (`npm ci` at the root and in `functions/`), a JDK 21 for the emulators, and Node 22 next to Node 26. I'll ask before installing software. Replace the POSIX variables in `dev:emulators` with `vite --mode emulators` plus a committed `.env.emulators` holding only the existing demo values, which are not secrets and need no new dependency. Nothing in items 1 to 8 can be tested until this works.

### 1. Weekly review (M) — done on `feat/weekly-review`
On Sunday evening, or any day while last week's square is unreviewed, a card at the top of the calendar shows the week with real numbers:
- tracked time by category;
- targets met and missed (`evaluateTarget`);
- days with the boys (`custodyUtils`);
- journal days.

It then asks four short things: a 1 to 5 rating, what mattered, one moment, and one intention for next week. Next week's card opens with that intention and asks whether it happened. It's skippable, and a skipped week stays visibly unreviewed. It's built with pure `weeklyReview.js` functions (week numbers, carry-forward, streaks of reviewed weeks), a thin card, and a review dialog that also opens from any past square.

### 2. Lived weeks that mean something (M) — done on `feat/lived-weeks`
The life calendar gets a "Colour lived weeks by" control: **Events** (today's view), **How the week went** (rating tint), or **With the boys**. In each mode the reviewed or custody weeks show and everything else stays plain. A week with a journal or photo gets a small dot. Data comes from `weeklyReviews` (one query for the whole life, at most about 4,700 small documents) and from custody computed from its new `since` date. The square's tooltip and the week view show the review. This depends on item 1, so building it first would light up almost nothing.

### 3. Kids: milestones, then measurements (S + M)
- **Milestones (S, no data model).** `childMilestones.js` derives each boy's:
  - 16th birthday, when an Ontario G1 licence becomes possible;
  - end of Grade 8 and of Grade 12 (last school day of June in that school year, from `currentGrade`);
  - 18th birthday.

  Each milestone gets its date, whose week it falls in, and a countdown ("David can get his G1 in 31 weeks, in your week"). There's a "Coming up" line on each card and a combined timeline under the panel.
- **Measurements (M).** A dated history per child (height first; weight, shoe size and marks later) with a hand-drawn SVG growth line and the change since last time, for example "+1 1/2" since Feb 2025". Imperial input with fractions is parsed and stored in millimetres, with the original text kept. A value that doesn't parse cleanly is stored as written and flagged, which is how `5' 10 9/8"` will show. A migration script copies the 14 "Height, <date>" rows across, dry run by default with `--apply` and `--confirm-project`. It only removes the old detail rows once you say so, and you see the dry-run output first.

### 4. Things to do before it's too late: plans and bucket list as one list (M)
The brief has these as two features (item 3's per-child list and item 5's bucket list). The code says they're one thing: an item with a title and an optional who (you, or any of the boys). Its deadline is one of:
- before an age (yours, or a boy's 18th);
- a season (this summer, this Christmas);
- a date;
- none.

It can optionally be placed in one of your custody weeks. Each item shows its chances left, computed by functions that already exist: "3 summers left before Joseph turns 18", "9 of your weeks before then". It appears in three places: on each kid card (their items), in the Still ahead section (yours), and on the weekly review card ("next week is yours with the boys: 2 plans for it"). Done items stay as a record and can go in a week's review.

### 5. Tracking health and manual entry (M)
First, a read-only look at the day with four Sleep rows, to tell nesting from duplicates and fix the pairing if it's wrong. Then a **Needs attention** list in the Activity view that collects:
- missing finishes;
- incomplete visits;
- likely duplicates (same category, overlapping, from different sources);
- days under 50 % covered.

Each one has a one-tap fix that uses the existing edit, delete and restore callables, or "this is fine", which hides it. A new `createActivityEntry` callable (owner only) adds a session by hand with `sourceApp: "manual"`. That's additive: the ingestion API and the existing fields are untouched, and the tombstone and recycle-bin rules apply as they do now.

### 6. Install on the phone and quick capture (S + S)
- **Install (S):** a web app manifest, the iOS standalone meta tags and a theme colour, using the brand icons already in `public/brand`.
- **Quick capture (S):** a `#capture` view that opens straight to today with a text box and a photo button, plus a manifest shortcut to it.
- **Defaults:** quick capture writes owner-only, and the day panel's default changes from `viewers` to `ownerOnly`, so sharing becomes a choice and not the default. Existing entries keep whatever they are now.
- **No service worker yet:** a stale cached bundle after a deploy is a real risk with Firebase Hosting, and install doesn't need one on iOS. It comes with item 8 if push is chosen.

### 7. On this day, search, year in review (S + M + M)
- **On this day (S):** what happened 1, 2, 5 and 10 years ago today, from events, day notes, attachments and, where they exist, weekly reviews and activity sessions. It shows as one line on the calendar and expands.
- **Search (M):** across day notes, events, reviews, plans and measurements. All of it is small and owner-readable, so it runs in the browser with no new index. GridlineAI journal text lives in another project and is out of scope at first.
- **Year in review (M):** a printable page per life year: ratings, best weeks, time with the boys, items done, totals.

### 8. A weekly message (M), only after item 1 has run for a few weeks
The review card already does most of what a digest would do, but only when you open the app. A digest needs a channel, which is your decision:
- **Email**, with a new dependency and a secret, for example an SMTP app password in Secret Manager.
- **Web push** to the installed app. It works on iOS 16.4+ home-screen apps and needs FCM plus a service worker.

It would be a scheduled function on Sunday at 7 pm Toronto time. Nothing is sent until you approve the channel, the text and a test send to yourself.

### 9. Housekeeping (S to L, alongside the above)
- Read the timezone from the profile, defaulting to Toronto (M, touches most utilities).
- Make the journal source app configurable instead of `gridlineai` (S).
- Add a `weekSummaries` aggregate written by a `lifeEvents` trigger. That stops "My totals" downloading every event, and it can later feed item 2 with real activity per square (L).
- Split `lifeEventUtils.js` and `ActivityDashboard.jsx` along the lines the features above touch (M).
- Add Storage rules tests in the Storage emulator (S).
- Work through the "not yet checked signed in" items in `TODO.md` (S, needs you signed in).

## Firestore additions

All of these sit under `lifeCalendars/{calendarId}/`. The owner can read and write all of them. A viewer can read a document only if it has `visibility == "viewers"`, and every new document defaults to `ownerOnly`. Each path gets rules tests, including that a viewer can't read an owner-only document and can't write at all.

| Path | Fields | Item |
| --- | --- | --- |
| `weeklyReviews/{weekStartId}` | `weekStart`, `weekEnd` (life-calendar square), `rating` 1–5, `mattered`, `moment`, `intention`, `intentionKept` (`yes` / `partly` / `no` / null, for the previous week's intention), `numbers` (snapshot: tracked seconds by category, targets met/missed, days with the boys, journal days), `visibility`, `createdAt`, `updatedAt` | 1, 2 |
| `childMeasurements/{id}` | `childId`, `kind` (`height` first), `measuredOn` (YYYY-MM-DD), `valueMm` (null if unparsed), `asWritten`, `needsCheck`, `note`, `visibility`, `source` (`manual` / `migratedDetail`), `createdAt` | 3 |
| `plans/{id}` | `title`, `notes`, `who` (`me` or child ids), `deadline` (`{ kind: 'age', personId, age }` / `{ kind: 'season', season, year }` / `{ kind: 'date', date }` / null), `plannedWeekStart`, `doneOn`, `visibility`, `createdAt`, `updatedAt` | 4 |
| `activityGapNotes/{key}` | `dateId`, `kind`, `lifeEventIds`, `note`, `createdAt` (owner only; no viewer access at all) | 5 |
| Calendar doc, additive | `custodySchedule.since` (YYYY-MM-DD). The lived-week view is remembered per device in `localStorage` instead of a `settings.livedWeekMode` field: it's a viewing preference, and keeping it off the profile avoids a write on every switch | 2 |
| `lifeEvents` (via callable only) | new `sourceApp: "manual"` documents with the existing field shape | 5 |

Item 9 would add `weekSummaries/{weekStartId}` (function-written, owner read only), and item 8 `digestSettings` on the user doc. Both are proposed with those items, not now.

## What I won't do, and why

- **Show activity data to viewers.** The Activity view is owner only at every layer, and none of the above changes that.
- **Change the ingestion API or existing `lifeEvents` fields.** Manual entries are a new source with the same shape.
- **Put new private data on the calendar document,** since viewers can read it whole.
- **Add a service worker for offline use now.** The stale-bundle risk outweighs offline access for an app that needs Firestore anyway.
- **Search GridlineAI journal text** in the first version. It lives in another project, behind `getActivityJournalDetails`.
- **AI summaries of the week.** That's a new dependency and data leaving Firebase, for something the structured numbers already say.
- **Move the existing heights out of `details` without asking.** The migration copies first and removes only on your say-so.
- **Charting libraries.** Charts are hand-drawn SVG.
