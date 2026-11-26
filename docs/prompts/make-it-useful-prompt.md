# Prompt: make Time Left To Live genuinely useful

Paste everything below the line into Claude Code, opened in `C:\Users\ashtr\Projects\timelefttolive` (on the Surface).

---

You are working in the Time Left To Live repo: React 19, Vite 7, Firebase (Auth, Firestore, Storage, Cloud Functions on Node 22), no UI libraries, no CSS framework. Production is `timelefttolive` (https://timelefttolive.web.app), staging is `timelefttolive-stg-go`. I am the only owner; viewers get read-only access to what I mark `viewers`.

The app already *measures* a lot: a week-per-square life calendar to age 90, "weeks left", what is still ahead (weekends, summers, Christmases, birthdays), a "Time with my boys" panel (weeks left with each of David, Myles, Joseph and Keaton before 18, the every-other-week schedule, grade, school, free-form details), daily journals and attachments, and an Activity dashboard fed by other apps (GridlineAI, GYM-K2, Darts tracker, DartConnect, MyDoublesProgress, Apple Shortcuts) with a crystal time wheel, targets, streaks and totals.

What it does not do yet is help me *act* on any of it. The purpose of the app is to make me live the time I have left on purpose: more good weeks with my boys, my health, and the things I want to do before it's too late. I want it to go from a beautiful dashboard I look at to a tool I use every week. Read this whole brief before touching anything.

## Read first

- `README.md` (features, Firestore model, functions, tests, deploy) and `TODO.md` (what is deployed and what was never checked).
- `docs/activity-dashboard.md`, especially "How time is computed" and "Known issues and limitations".
- `docs/timelefttolive-life-event-platform.md` for the ingestion contract. Do not break it: other apps write to it.
- `src/pages/Dashboard.jsx`, `src/components/LifeSummary.jsx`, `WhatsLeft.jsx`, `FamilyTimePanel.jsx`, `ProfileForm.jsx`, `LifeHeatmap.jsx`, `WeekDetailPanel.jsx`, `DayDetailView.jsx`.
- `src/utils/childInfo.js`, `custodyUtils.js`, `whatsLeft.js`, `activityTargets.js`, `activityNotables.js`, and `src/utils/lifeEventUtils.js` (about 2,000 lines; skim the exports).
- `firestore.rules` and `tests/firestore-*.test.cjs`, so every new field or collection gets owner/viewer rules and tests.
- `docs/prompts/crystal-wheel-prompt.md` for the standard of work I expect.

## What I see today (verify each against the code and the live app before relying on it)

1. **Weeks lived are all the same.** On the life calendar a lived week is a solid square unless a calendar event colours it. The Activity data, journals, photos and time with the boys never reach the calendar, so the 2,700 squares behind me say nothing about how those weeks went.
2. **No weekly loop.** There is no moment where the app asks "how was this week, what mattered, what do you want next week?" Targets exist on the Activity wheel but nothing reviews them over a week or a month, and nothing carries an intention forward.
3. **The kids panel counts down but doesn't help plan.** It knows exactly which weeks are mine (custody schedule) and how many summers, Christmases and birthdays are left with each boy, but there is nowhere to plan what we'll do in my next weeks, keep a list of things to do with each of them before 18, or see milestones coming (driver's licence at 16, end of Grade 8 and Grade 12, graduation dates from the grade, 18th birthdays).
4. **Child details are free text only.** I just entered the boys' heights from the wall as rows like "Height, Nov 23, 2026 = 5' 11"". They can't be charted, sorted or compared. Height (and later weight, shoe size, school marks) wants a proper dated-measurement history with a small growth chart per child. Migrate those existing "Height, <date>" detail rows into it without losing any; keep the one written as `5' 10 9/8"` as written and flag it in the UI for me to correct.
5. **No "before it's too late" list.** "38 summers left" is powerful, but there is nowhere to put the things I want to do in them: a bucket list where each item can be tied to a deadline (before 90, before David turns 18, this summer) and shows how many chances are left to do it.
6. **Data quality is invisible until it's wrong.** Today's view said "Day covered 30%", one gym visit was "Incomplete", and "1 historical session is missing a finish". The 24-hour timeline also showed four separate "↳ Sleep" rows (4h 34m, 4h 56m, 5h 5m, 5h 35m): check whether that is correct nesting or duplicate sleep events. There's no single place that lists the gaps and lets me fix each in one tap (add the missing finish, merge duplicates, mark a gap as known). There is also no way to add an activity by hand. Edit, delete and restore exist, but create doesn't.
7. **No quick capture on the phone.** There is no web app manifest and no service worker, so it can't be installed to the iPhone home screen, and adding a journal line or photo for today takes several taps through the calendar.
8. **No search, no look-back.** I can't search my journals, events, notes and days. There is no "on this day" (a year ago, five years ago) and no year in review, even though the data is there.
9. **Nothing reaches me.** Everything waits for me to open the app. A short weekly digest (Sunday evening: the week in numbers, time with the boys, targets met and missed, one moment, next week's custody and plans) would close the loop.
10. Housekeeping from `TODO.md` and the docs: the hardcoded `America/Toronto` and `gridlineai`, "My totals" downloading every life event, `lifeEventUtils.js` and `ActivityDashboard.jsx` too large, Storage rules without tests, and items never checked while signed in.

## What I want you to do

### Phase 0: review and plan (stop for my approval)

Verify the points above, and add anything else you find that would make the app more useful day to day. Then write `docs/usefulness-plan.md`:

- each improvement as one short paragraph: what I'd do with it, what changes (data model, rules, functions, UI), and its size (S/M/L);
- ranked by how much it changes my week for the effort, highest first;
- the Firestore additions spelled out (paths, fields, who can read/write), keeping viewer privacy as it is: nothing new is visible to viewers unless I mark it `viewers`;
- what you will *not* do and why.

Show me the ranked list in chat and wait for my go-ahead and any re-ordering before writing feature code. My expected order is roughly: weekly review loop and meaningful lived weeks → kids planning, milestones and measurements → bucket list with deadlines → tracking health and manual entry → phone install and quick capture → search and look-back → weekly digest → housekeeping. Argue with it if the code says otherwise.

### Phases 1+: build, one feature per branch

For each approved item, in order:

1. Branch from `main` (`feat/<short-name>`).
2. Keep the logic in pure, tested functions under `src/utils/` (like `whatsLeft.js` and `custodyUtils.js`), with components kept thin. Add Vitest tests for the logic and for any new component behaviour, and Firestore rules tests for every new path, including that a viewer can't read owner-only data.
3. Match the existing look: the calendar view's serif headings and warm palette, and the Activity view's style. Both themes must pass `src/styles/themeContrast.test.js`. Everything must work at 390 px wide. Write UI copy in plain, warm language, like the existing panels ("42 weeks left with you", "in your week").
4. Run the full test suite (`npm test`; rules and hosting tests need Java and the emulators). Click through the change in the emulators (`npm run dev:emulators`) with a realistic demo calendar, never with production data.
5. Update `README.md`, the relevant doc in `docs/`, and `TODO.md` in the same branch.
6. Open a PR. **Do not deploy to production, run data migrations against production, or send any email or notification without asking me first**, each time. For a data migration (the height rows, for example), write it as a dry-run-by-default script with `--apply` and `--confirm-project`, like `scripts/enrichGridlineJournalLifeEvents.js`, and show me the dry-run output first.

### Constraints

- No new runtime dependencies unless you ask first and say why. Charts are hand-drawn SVG, like the wheel.
- Don't change the ingestion API contract or the meaning of existing `lifeEvents` fields. Additive fields only.
- All dates are local `YYYY-MM-DD` or Toronto-time, as the existing utilities do it. Never use raw UTC date math.
- Never log or commit secrets, `.env` files or tokens.
- If something in this brief turns out to be wrong when you read the code, say so and do the right thing instead of following the brief literally.

When everything approved is merged, give me a short summary: what's new, what I should try first on my phone, and what's left in `docs/usefulness-plan.md`.
