# Prompt: make the Activity time wheel world class

Paste everything below the line into Claude Code, opened in `~/Documents/timelefttolive`.

---

You are working in the Time Left To Live repo (`~/Documents/timelefttolive`): React 19, Vite 7, Firebase, no UI libraries, no CSS framework. The Activity dashboard (`#activity`, owner-only) opens on a "time wheel": a donut of tracked time by category for a day, week, month or year. I want that wheel, and the hero around it, taken to another level in two ways: it should look like it is cut from glass or crystal, lit and shiny, and it should become a better instrument for documenting and keeping track of my life. Read this whole brief before touching anything, then work through the phases in order.

## Read first

- `docs/activity-dashboard.md` (sections "Time wheel" and "How the wheel is drawn") for how the wheel works today.
- `src/utils/wheelGeometry.js` and `src/utils/wheelGeometry.test.js`: pure slice geometry in a 100 x 100 viewBox. Outer radius 48, inner radius 21, 1.8 degree gaps, 2.2 corner radius, 8 degree minimum slice, label fit by geometry.
- `src/components/ActivityDashboard.jsx`: `WheelView` (line ~302), `LifeWheel` (~444), `WheelLabels` (~516), `CategoryLegend` (~543), `PeriodGlance` / `SelectedGlance` / `PointGlance` (~562 to ~620), `ActivityStream` and `DayActivityOverview` (~621, ~777), `FocusedAnalysis` (~1247), `EmptyWheel` (~1499).
- `src/styles/activity-cycle.css`: everything scoped under `.activity-cycle`; the wheel rules are around lines 215 to 400 and the phone overrides around 1900 to 1930. The K2 logo watermark sits in the hole (`.life-wheel::before`).
- `src/utils/lifeEventUtils.js` lines 1 to 45: category colours, icons and priorities. `buildCategoryAnalysis` gives per-category `recentAverageSeconds`, `deltaSeconds`, `sessions`, `activeSession`, `locations`, `attendance`.
- `src/components/ActivityDashboard.test.jsx` (`describe('LifeWheel')`) and `src/styles/themeContrast.test.js`.

## What is wrong today (my review, verified against the code and a static render)

Looks

1. Every slice is one flat `fill`. There is no light model at all: no highlight, no edge, no shadow, no depth. On the dark theme it reads as a candy pie chart; on the light theme the colours wash out into pastel and the ring sinks into the white card.
2. Icons are a mix of colour emoji (💼 🏋 🎯 📅 🛒 🛍 ⛽ 🔧 🍴) and thin text glyphs (☾ ⌂ ◉ ◒ ♫ ⌖ ▤ ✎ ★ •). They render differently on every OS and font, at different weights and sizes, and the emoji are coloured bitmaps sitting on coloured glass. It is the single biggest thing that makes the wheel look home-made.
3. Duration labels are always white with a text shadow, including on the yellow Transportation slice and the orange Meals slice, where they fail contrast.
4. The centre is a dark hole with a faint mountain logo behind the numbers. The total and the "in progress" line compete with the logo, and the hole does not read as part of the object.
5. Nothing tells me a slice was drawn larger than its real share (the 8 degree minimum). Three slices in a typical day are boosted and look identical to honest ones.
6. Selection fades the other slices to 20 percent and nothing else happens: no lift, no light change, no transition of the centre. There is no entrance, and switching day/week/month/year snaps between unrelated wheels.
7. The wheel floats in a 34px-radius card with a gradient blob behind it, inside a page that also has gradient blobs. Box in a box; the object has no stage and casts no shadow.

Usefulness

8. For a day, the wheel shows shares but not *when*. The time of day lives only in the 24-hour chart further down.
9. Untracked time is a number ("Day covered 93%") rather than something I can see on the wheel.
10. There is no comparison on the wheel itself. "vs previous week" and "recent normal" exist in the data (`previousAnalysis`, `recentHistory`, `recentAverageSeconds`) but only show up after I select a category and scroll to the focus panel.
11. Moments (journal entries, photos, Spotify, achievements) are invisible on the wheel. They are the parts of a day I most want to remember.
12. Goals exist only as a hard-coded "vs 7h goal" for Sleep in the focus panel.
13. There is no way to keep a picture of a day. I document my life in a journal and in Evernote; I cannot save the wheel.
14. Everything is mouse-first: no keyboard shortcuts for period and date, no arrow keys between slices, no `aria-pressed` on the selected slice.

## The look I want: lit crystal

The wheel should look like a ring of coloured glass or crystal segments, polished, with light falling on it from the upper left. Think of a jeweller's photograph of a gemstone bezel, or a high-end GPU vendor's product render: deep saturated colour in the body, a bright specular highlight along the outer edge, a darker, denser tone toward the inner edge, a thin bright rim, and a soft coloured glow where the glass meets the dark surface beneath it. Not frosted-grey "glassmorphism" cards, not a plastic bevel, not a 2010 Aqua button. Restraint: one convincing material, applied consistently, beats five effects.

Build the material in SVG, per slice, from the existing path (`describeWheelSegment` stays the single source of shape). For each slice, in this order from back to front:

1. **Glow**: a blurred copy of the path in the slice colour, under the ring, 25 to 40 percent opacity on dark, 15 to 25 on light. This is the "light through glass onto the table".
2. **Body**: the path filled with a radial gradient centred on the wheel: the slice colour at the inner radius darkened about 30 percent, the pure colour through the middle, and lightened about 15 percent just inside the outer radius. Derive all three from the category colour with `color-mix()` in CSS custom properties or in JS; do not hand-pick new colours per category. Keep the category hues exactly as they are.
3. **Specular**: a second fill, white, clipped to the path, as a linear gradient at about -35 degrees that is 55 percent white at the upper-left end and transparent before the middle. Plus a narrow bright band hugging the outer arc (a stroke of the outer arc only, 0.6 to 0.9 units wide, white at 45 percent, masked so it fades at both ends of the slice).
4. **Rim**: a 0.35 unit stroke of the path, white at 28 percent on dark and 18 percent on light, and an inner 0.35 unit stroke in the darkened colour so the edge reads as thickness.
5. **Shadow and seat**: one soft drop shadow for the whole ring group (not per slice) falling down-right, and a dark "seat" disc under the ring slightly larger than the outer radius, so the 1.8 degree gaps show a dark bezel between crystal segments rather than the page background. Consider widening the gap to about 2.2 degrees once the bezel exists; keep the gap centred on boundaries and keep `buildWheelSegments` tests green (the gap is an option).
6. **Hub**: the centre hole becomes a crystal lens: a disc with an inset shadow, a faint upper-left highlight, and the K2 watermark kept but etched (much fainter, desaturated, with a 1px light and dark offset so it looks engraved). The numbers sit on top with enough contrast in both themes; the "in progress" line gets a slow pulse on a small dot, not on the text.

Use `<defs>` with gradients and filters created once per wheel, referenced by id; generate ids per mounted wheel so two wheels on one page (small multiples, below) do not collide. Keep filter regions tight and apply `feGaussianBlur` to a group, not to each slice, so the whole wheel stays smooth when ten slices animate. Add a `data-material="plain"` path that renders the current flat look, used automatically when `prefers-reduced-transparency` is set, on very narrow screens if the glass costs frames, and in tests.

Light theme: glass on white needs more, not less: a slightly stronger shadow, a darker rim, a visible seat, and body gradients that stay saturated. Both themes must look designed, not one theme with the other derived.

Labels on the glass: replace all icons on the wheel, in the legend, in the centre, and in the timeline with one inline SVG icon set, monochrome, stroke-based, drawn to a 24 unit grid, one file `src/components/activityIcons.jsx` exporting a component per category and point category (Work, Gym/Fitness, Sleep, Home, Transportation, Music, Meals, Places, Darts, Reading, Other, Spotify, Journal, Work Reports, Achievements, Calendar, Moments, and the place kinds). No icon dependency; write the paths. Choose label colour per slice from the slice colour's luminance so text is dark on yellow and light on blue; add the same rule to the legend swatches. Keep the geometric label fitting (`getWheelLabelMode`) and its tests; the icon box sizes in `LABEL` may change if the new icons need it, with the tests updated to match.

Boosted slices: mark them. Suggestion: a hairline dashed outer rim in white and a tooltip line "Drawn larger than its share (1.2%) so it stays visible".

## Motion (one orchestrated moment, then quiet)

- First paint: the ring draws itself clockwise from 12 o'clock over about 700 ms (animate each slice's end angle, or reveal through a rotating clip), the glow fades in behind, the centre total counts up. Once per mount, never on every data tick.
- Changing period or date: slices with the same label morph to their new angles over 350 ms; new ones grow from zero width, gone ones shrink to zero. Do this with a small `requestAnimationFrame` hook that interpolates `startAngle`/`endAngle` per label and feeds `describeWheelSegment`; no animation library.
- Selecting a slice: it lifts 1.2 units outward along its mid angle, its specular brightens, the others frost (desaturate and drop to about 35 percent) rather than vanish, the hub cross-fades to the category. Clearing the selection reverses it.
- Live session: a slow breathing glow on the outer edge of the slice that is in progress.
- Hover: tooltip (below) and a 4 percent brightness lift. Nothing else moves.
- All of it off under `prefers-reduced-motion`, with instant state changes instead.

## Usefulness: the wheel as an instrument

Do these in the order given; each is independently shippable.

1. **Glass tooltip** on hover and keyboard focus of a slice or legend row: category, time, exact share, sessions, boosted note, and for a day the first start and last end. One tooltip component, positioned from `getWheelLabelPosition`, kept inside the stage.
2. **Untracked time on the wheel.** Add a `showUntracked` toggle to `buildWheelSegments` options (default on for day, off for other periods) that appends a frosted, uncoloured, non-selectable segment for the period length minus tracked seconds, drawn as smoked glass without specular. For a day the ring then always sums to 24 hours. Keep the existing behaviour when the option is off and add tests.
3. **Clock layout for the day view.** A segmented control above the wheel, "Share | Clock". Clock places each allocated fragment at its actual time of day (midnight at 12 o'clock, noon at 6 o'clock), so a category can appear more than once, the night from bedtime wraps across midnight the way the 24-hour chart already draws it, and the live session's leading edge is the current time. Reuse `allocateIntervals` output (`analysis.allocatedSessions[].fragments`); add `buildClockSegments` to `wheelGeometry.js` with tests. Hour ticks on the seat ring. Default stays "Share"; remember the choice in `localStorage` beside the theme key.
4. **Comparison ring.** A thin hairline ring just outside the glass showing the previous period's share per category in the same hue at low opacity, with a small arrow in the tooltip ("Sleep 7h 12m, 48m less than last week"). Data from `previousAnalysis`; add a "recent normal" option using `recentAverageSeconds` from `buildCategoryAnalysis` where available. One toggle: "Compare: none | previous | normal".
5. **Moments as beads.** Journal entries, photos, achievements, Spotify plays and calendar entries as small crystal beads on the outer rim: at their time of day in Clock layout, grouped at their category's slice in Share layout, with a count badge when they cluster. Clicking a bead does what clicking the legend row for that point category does today; a journal bead on a day opens the journal reflection.
6. **Targets.** Per-category targets on the owner's calendar profile (`activityTargets: { Sleep: { minSeconds }, Work: { maxSeconds }, 'Gym/Fitness': { sessionsPerWeek } }`), edited from the focused glance panel, written through the existing profile update path and Firestore rules (owner-only write; viewers may read the profile already, which is acceptable). Draw the target as a tick on the slice's outer edge and say it in the hub when that category is selected ("48m under your 7h goal"). Replace the hard-coded "vs 7h goal" with this.
7. **Save this wheel.** A "Save as image" action that serialises the wheel SVG (inline the computed styles and gradients, embed the icon paths) and renders a 2048 px square PNG with a caption line (date, total, top three categories) through a canvas, downloaded as `time-wheel-YYYY-MM-DD.png`. Works in Chrome and iOS Safari; falls back to opening the PNG in a new tab where download is blocked.
8. **Small multiples.** In week view, seven thumbnail wheels (about 56 px, plain material, no labels) in the glance panel, one per day, clickable to jump to that day; in month view, one per week. Reuse `LifeWheel` geometry through a `MiniWheel` component; never fetch extra data (week and month data are already loaded).
9. **Keyboard.** Left/Right arrow for previous/next period, `D` `W` `M` `Y` for period, `T` for today, `Escape` clears the selection, Left/Right while a slice is focused moves to the neighbouring slice. Roving `tabIndex` on slices, `aria-pressed` on the selected one, the share percentage in the accessible name. Only when focus is not in an input.
10. **Streaks and notables.** Two or three deterministic one-line facts in the glance panel computed from `recentHistory` ("Third gym visit this week", "Darts 9 days in a row", "Longest work day this month"). No invented data: each fact must come with the numbers that prove it, and the function must be unit-tested.

## Process

0. **Material study first.** Before changing React, write a throwaway script (keep it in `scripts/wheel-study/`, not in `src/`) that renders the current geometry with real category colours into a static page with three material variants side by side, dark and light: clear crystal (strong specular, thin rim), smoked glass (denser body, softer glow), and jewel (deeper inner darkening, brighter outer band). Serve it on `127.0.0.1` and screenshot it with the Chrome extension at desktop and 390 px widths. Save the screenshots under `scripts/wheel-study/out/` and stop. Show me the three and ask me which one, with what adjustments, before you build the real thing. Note: the Chrome extension cannot open `file://` pages and the sandboxed `/tmp` is not visible to a background server, so serve from a folder under the home directory.
1. Branch from the commit production runs (see `TODO.md`; today that is `615db0b` on `fix/sleep-night-on-day-chart`, pending merge into `main`), named `feat/crystal-wheel`. Small commits, one concern each, messages in the repo's style ("feat: …", "fix: …").
2. Keep `wheelGeometry.js` pure and tested; every new geometry function gets tests of the kind already there (sums to 360, stays in the ring, order kept). Update `ActivityDashboard.test.jsx` deliberately when markup changes (it matches exact class strings such as `life-wheel-segment  selected`); never weaken an assertion to make it pass.
3. Scope every style under `.activity-cycle`. `src/styles/app.css` and the life calendar are out of bounds. Extend `themeContrast.test.js`, or add a sibling, so the new label and hub colours are checked in both themes.
4. Critique with screenshots as you go, dark and light, desktop and phone width, with a day that has nine categories, a day with one category (the full-ring case), a week, a year, the empty state and the loading state. Take one accessory off before calling it done.
5. Performance: the wheel must stay at 60 fps during the period morph on a mid-range phone. Measure in Chrome's performance panel; if filters are the cost, blur the group not the slices, cut the glow radius, or drop to the plain material on narrow screens.
6. Run `npm run test:frontend` and `npm run build` before every commit. Do not deploy. When the branch is ready, build it, tell me what to look at, and I will check it live and deploy hosting myself (functions and rules should not change; say so explicitly if they must, and why).
7. Update `docs/activity-dashboard.md` ("Time wheel" and "How the wheel is drawn") and `README.md`'s Activity bullet to describe the new layouts, toggles, targets and export. Add the deploy note to `TODO.md` in the existing format when I tell you it is deployed.

## Constraints and taste

- Keep the category hues, the clockwise largest-first order in Share layout, the 8 degree minimum, the gap centred on 12 o'clock, the K2 watermark, the titles ("Today", "Last Week"), and the light/dark toggle. These are settled.
- No new runtime dependencies. No Tailwind, no chart library, no icon package, no animation library.
- Copy is sentence case, plain and short. No all-caps labels beyond the existing eyebrow style, no middle-dot chains, no decorative numbering.
- One memorable thing: the glass ring. Everything around it gets quieter, not louder: the hero card can lose its inner gradient blob and its heavy border once the wheel has a seat and a shadow of its own.
- If a phase conflicts with this brief or with existing behaviour, stop and ask with a screenshot; do not pick for me.
