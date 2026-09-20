# Activity Dashboard and Activity Functions

The Activity dashboard is the owner-only second view of the app (`#activity`). It turns the canonical `lifeEvents` collection (see [the life event platform design](timelefttolive-life-event-platform.md) and [the phase 1 handoff](timelefttolive-life-event-ingestion-phase-1-handoff.md)) into a picture of how the owner spends time: a "time wheel", a chronological timeline, journal notes and photos, and all-time totals. It also lets the owner correct or delete individual entries.

This document describes the code as of the commit that added it. Where it says something is a known issue, it was reproduced against the current code.

- [Access and privacy](#access-and-privacy)
- [Where the data comes from](#where-the-data-comes-from)
- [The two views](#the-two-views)
- [How time is computed](#how-time-is-computed)
- [Callable functions: edit and delete](#callable-functions-edit-and-delete)
- [HTTP functions: journal details and photos](#http-functions-journal-details-and-photos)
- [Known issues and limitations](#known-issues-and-limitations)
- [Code map and tests](#code-map-and-tests)

## Access and privacy

Everything here is owner-only, enforced at every layer, not only in the UI:

| Layer | Rule |
| --- | --- |
| UI (`Dashboard.jsx`) | The dashboard is only mounted when `role === 'owner'`. A viewer who opens `#activity` is switched back to the calendar. |
| Firestore rules | `lifeEvents` is readable by the calendar owner only and is never writable from a client. `lifeEventTombstones` is inaccessible to clients. |
| Callables | `editActivityEntry` and `deleteActivityEntry` require a signed-in user who is the calendar's `ownerUid`. |
| HTTP endpoints | `getActivityJournalDetails` and `getActivityMedia` require a Firebase ID token and re-check ownership, source connection and source project for every event they touch. |

Accepted viewers therefore never see activity data, journals or photos, even for records that would otherwise be marked `viewers` elsewhere in the app.

## Where the data comes from

```text
source apps ──► ingestion API ──► lifeCalendars/{id}/lifeEvents ──► Activity dashboard (Firestore listeners)
                                          ▲                                   │
                     editActivityEntry ───┘                                   ├─► getActivityJournalDetails ─► gridlineai Firestore (journal text)
                     deleteActivityEntry (also writes lifeEventTombstones)    └─► getActivityMedia ─────────► gridlineai Storage (photos)
```

The dashboard has no data of its own. Every number on screen is derived in the browser from `lifeEvents`, using the pure functions in `src/utils/lifeEventUtils.js`.

### Firestore listeners (`src/hooks/useCalendar.js`)

| Hook | Query | Used for |
| --- | --- | --- |
| `useLifeEvents(calendarId, start, end)` | `lifeEvents` where `occurredAt >= start` and `< end`, ordered by `occurredAt` | The selected period. The window is padded by 36 hours on each side so a session that starts before, or ends after, the period can still pair its boundary events. |
| `useLifeEvents` (second instance) | Same, over the previous 14 days / 8 weeks / 6 months / 3 years | Trend and history charts. |
| `useAllLifeEvents(calendarId)` | Every `lifeEvents` document, ordered by `occurredAt` | **My totals** only. It is subscribed only while that tab is open. |
| `useConnectedSources(calendarId)` | `sourceConnections` | The "Tracking status" count of active sources. |
| `useActivityJournalDetails(calendarId, lifeEvents)` | Not a Firestore query; calls `getActivityJournalDetails` | Journal text and photo metadata for the events in view. |

The listeners are live (`onSnapshot`), so a new event, an edit or a delete appears without a refresh. A clock ticks every minute so in-progress sessions grow.

### Journal enrichment

Journal and photo events arrive from GridlineAI as `lifeEvents` that only reference a source record. `isJournalOrMediaLifeEvent` (`src/services/activityJournal.js`) selects events whose `sourceApp` is `gridlineai` and whose type/family/category/title matches journal, note, memo, image, photo, picture, attachment or media. Up to 500 of them per view are sent, in batches of 100, to `getActivityJournalDetails`. The returned text is attached to each event as `_journal` (`enrichLifeEventsWithJournalDetails`). If more than 500 qualify, the UI says the period is too long to load everything and asks for a shorter one.

## The two views

The header switches between **Time wheel** and **My totals**, offers a light/dark theme for this view (stored in `localStorage` as `activityDashboardTheme`), and links back to the calendar. The calendar and activity views stay mounted, so scroll position is kept when switching.

### Time wheel

- **Period navigation:** day, week (Monday to Sunday), month or year, with previous/next, a date picker and a Today button. Titles read "Today", "Yesterday", "This Week", "Last Week" where they apply.
- **Wheel:** a donut of tracked time by category, largest first, clockwise from 12 o'clock. Slices are separated by small gaps and have rounded corners. The centre shows total tracked time and how many sessions are in progress. Each slice shows its icon and, where it fits, its duration. Selecting a slice (or a legend entry) focuses that category and fades the rest.
- **At a glance:** a sentence about the largest category plus tracked time, moments, and, for a day, how much of the 24 hours is covered. Sessions with a missing finish are called out and excluded from the total.
- **What happened:** the chronological timeline, earliest first. Sessions show their status (Completed, In progress, Incomplete, Ended elsewhere), their start and end boundary events and when the source sent them. Moments (point events such as Spotify plays, journal entries, achievements) show alongside without adding duration. For a day there is also a 24-hour overview chart. For a week, month or year the timeline is grouped by day and can be expanded.
- **Photos from this day** (day view only) and, when Journal is selected, a **journal reflection** with entries, photo counts and a private gallery with a lightbox (arrow keys and Escape work).
- **Focused analysis** for the selected category: trend against the previous period and recent history, location breakdown, and category-specific panels (work attendance, workout summaries, session history).
- **Edit / Delete** buttons on each timeline entry that has a canonical event id.

#### How the wheel is drawn

Angles come from `buildWheelSegments` in `src/utils/wheelGeometry.js`, and each slice is an SVG path from `describeWheelSegment`.

- Slices are proportional to time **except that none is drawn smaller than 8 degrees**, so a few minutes stay visible next to a whole week. The room those slices take is removed from the larger ones. The exact figures are always in the legend, the tooltip and the centre total; a slice's real share is `trueShare` and `boosted` marks the ones drawn larger than that.
- Neighbouring slices leave a 1.8 degree gap, centred on each boundary. With a single slice the ring is drawn whole, with no gap.
- If there are too many slices to give each the minimum, the ring is shared evenly.
- Corner rounding shrinks on narrow slices so the corners never overlap.
- The icon is shown on every slice. The duration is added only when the upright text fits inside the slice's wedge, checked geometrically by `getWheelLabelMode`.

### My totals

Tallies for **All time**, **This year**, **30 days** or **7 days**. Each category card shows valid time, active days, valid sessions (or "visits" for Gym/Fitness), average session, first and latest dates, and how many incomplete sessions were left out of the duration. Categories that only have moments show an entry count instead of time. "View latest details" jumps to the day view of that category's most recent date.

## How time is computed

All of this is in `src/utils/lifeEventUtils.js`. The app timezone is fixed at `America/Toronto` (`APP_TIMEZONE`); days, weeks and ranges are computed in it regardless of the browser's timezone.

### 1. Classification

`getTallyActivityLabel(event)` assigns one label to each event using ordered pattern matches on the event type (with any `arrive_`/`leave_`/`start_`/`finish_` prefix removed), family, category id, title and location. The first match wins, in this order: Work Reports, Notes, Attachments, Achievements, Gym/Fitness, Sleep, Transportation, Music, Meals, Home, Work, Reading, Places (coordinates or generic location text), then Moments for anything unclassifiable. Unknown non-generic labels are shown as-is.

The order matters. For example a title containing "gym" is Gym/Fitness even if the event type also says "work".

### 2. Event precedence

Generic CarPlay-style `arrive_location` / `leave_location` records are observations, not duration boundaries. `applyActivityEventPrecedence` hides a generic arrival when a specific arrival (Gym, Home, Work...) for an equivalent place occurs within 10 minutes, and attaches its location text to the specific event as display enrichment. Generic location events with no usable place name are hidden. Events with `excludeFromActivity: true` or a journal marked as a Shortcut "shadow" are excluded.

### 3. Sessions

`buildActivitySessions` produces four kinds of session:

| Kind | Source |
| --- | --- |
| `reported` | An event that carries its own `endAt` or `durationSeconds` (for example a completed workout). It keeps its supplied times. |
| `paired` | An `arrive_*`/`start_*` boundary matched with the next `leave_*`/`finish_*`/`stop_*` for the same person, category and location. |
| `active` | An unmatched start that is still in progress. Only Work, Gym/Fitness, Sleep, Home, Transportation, Meals and Reading can be active, only if it started within the last 36 hours, only for the period that contains "now", and only the latest per category. Its duration runs to the current time. |
| `incomplete` | An unmatched start or unmatched end. It has no duration and is excluded from time totals. If a later arrival at a different place proves the visit ended, it is labelled "Ended elsewhere". |

Spotify start events are never treated as open-ended boundaries; without a supplied duration they remain moments.

### 4. Allocation, so time is never double counted

Sessions can overlap (a workout inside a gym visit, a drive during "home"). `allocateIntervals` gives each minute to exactly one session, highest priority first:

```text
Sleep 100 > Work 90 > Gym/Fitness 80 > Transportation 70 > Meals 60 > Reading 50 > Home 40 > Music 30 > Places 20 > Other 10
```

Within equal priority, longer sessions win. The lower-priority session keeps only the fragments not already claimed. A session fully covered by a parent (for example a workout inside a gym visit) is recorded as a nested session of that parent and appears in the drill-down without adding to the total.

The wheel, "tracked time" and totals use allocated seconds. The timeline and moments never add duration.

### 5. Tallies (My totals)

`buildActivityTallies` first drops events that should not count, then de-duplicates, then reuses the same session and allocation logic over the selected range:

- **Dropped:** shortcut shadows, `excludeFromActivity`, invalid/invalidated/replaced/superseded events, and any event whose status (ingestion, activity, session or metadata status) is one of cancelled, deleted, discarded, failed, invalid, invalidated, needs_date_review, paused, rejected, replaced, superseded. Events from another calendar or owner are also dropped.
- **De-duplicated** by source identity: `sourceEventId`, else `sourceRecordId` plus event type and time, else the document id.
- **Boundaries before the range** still pair with departures inside it and are clipped to the range boundary.
- **Gym/Fitness** counts gym visits, not the workouts nested within them, unless there are no visits.

## Callable functions: edit and delete

Both are Firebase callable functions (v2) in region `northamerica-northeast1`, exported from `functions/index.js`, implemented in `functions/src/activityEntries.js` and wrapped for the browser in `src/services/activityEntries.js`. They run in Firestore transactions using the Admin SDK, which is the only way `lifeEvents` can be changed, since the rules deny all client writes.

Common behaviour:

- Unauthenticated calls fail with `unauthenticated`.
- The caller must be the `ownerUid` of the calendar, otherwise `permission-denied`.
- Errors thrown by the implementation carry a `code` (`invalid-argument`, `not-found`, `permission-denied`) which is passed through to the client as the `HttpsError` code.
- Every field is validated server-side; the client dialog is not trusted.

### `editActivityEntry`

Request (all fields other than `calendarId` and `eventId` are optional; omitted fields are left unchanged):

| Field | Type | Rule |
| --- | --- | --- |
| `calendarId`, `eventId` | string | Required, at most 200 characters. |
| `title` | string | At most 500 characters. |
| `activityFamily`, `categoryId`, `eventType`, `timezone` | string | At most 120 (`timezone` 100) characters. |
| `description` | string | At most 4000 characters. |
| `startAt`, `endAt`, `occurredAt` | ISO date string, or `null`/empty to clear | Must parse as dates. `endAt` must not be before `startAt`. `occurredAt` defaults to `startAt`. |
| `durationSeconds` | number, or `null`/empty | Non-negative, rounded to whole seconds. When both `startAt` and `endAt` exist it is computed from them, and an explicitly supplied value that disagrees is rejected. |
| `location` | object, or `null` | An object replaces the stored `location`; `null` clears it; omitting the field leaves it unchanged. Anything else is rejected. |
| `metadata` | object | Shallow-merged into the existing `metadata`; existing keys not mentioned are kept. |
| `linkedEventId`, `linkedEndAt` | string, ISO date | See below. |

What it writes: the patch above plus `updatedAt`, `updatedBy`, `updatedByUid` and **`manualOverride: true`**. Returns `{ id: eventId }`. Errors `not-found` if the event or the linked event does not exist or has a `deletedAt`.

**Paired sessions.** A paired session is two events (arrival and departure). The dashboard edits the arrival event and passes the departure event's id as `linkedEventId` with the new end time as `linkedEndAt`. The function then updates the departure's `occurredAt` and drops `endAt`/`durationSeconds` from the arrival's patch, so the pair keeps deriving its finish from the departure event instead of becoming two overlapping intervals.

**Why `manualOverride` matters.** When a source app later re-sends the same event (same idempotency key), ingestion sees `manualOverride` and returns status `manual_override` without touching the document. The correction is therefore permanent and is not overwritten, and does not produce an `idempotency_conflict` error for the source.

### `deleteActivityEntry`

Request: `{ calendarId, eventId, linkedEventId? }`. Returns `{ id: eventId }`. Errors `not-found` if the event, or the linked event when one is given, does not exist. A `null` or empty `linkedEventId` is treated as absent.

For a paired session (arrival and departure) the dashboard passes the departure event's id as `linkedEventId`, the same way `editActivityEntry` does, so both boundaries are removed together. Nothing is deleted if either is missing or the caller is not the owner.

In one transaction, for each event being deleted, it:

1. writes `lifeEventTombstones/{id}` with the event's idempotency key, source app, source record id and source event id, `deletedAt`, and `deletedBy`/`deletedByUid`, and
2. deletes `lifeEvents/{id}`.

The document id of a life event is its idempotency key, so the tombstone has the same id. When the source app re-sends a deleted event, `upsertLifeEventRecord` finds the tombstone and answers with status `deleted` and `duplicate: true` without recreating it. Deletion is therefore permanent and survives replays and backfills. There is no undo in the app; to bring an entry back, remove the tombstone document by hand and re-ingest it.

### The edit dialog

`ActivityEntryDialog` (exported from `ActivityDashboard.jsx`) edits activity/category, category id, title, event type, start and end (local time via `datetime-local`), duration, location label, notes, and a free-form JSON `workoutDetails` block (stored under `metadata.workoutDetails`). It checks end-before-start and JSON validity in the browser, and offers a delete confirmation step. `buildLocationPatch` decides what to send for the location: nothing when it is unchanged, the new label merged over the stored location when it was edited, and `null` (or the location without its label, if it has coordinates) when the label was erased. `buildDeleteRequest` adds the departure event's id for paired sessions. Both leave keys out rather than passing `undefined`, because the Firebase callable client encodes `undefined` as `null`. Successful actions show a status banner for a few seconds; failures show the server message.

## HTTP functions: journal details and photos

Both are `onRequest` functions in `northamerica-northeast1`, routed by Firebase Hosting rewrites in `firebase.json`, implemented in `functions/src/activityJournal.js`, with `cors: false` (same-origin only) and `Cache-Control: private, no-store`. They read the **`gridlineai`** Firebase project (hardcoded as `SOURCE_PROJECT_ID`, with bucket `gridlineai.firebasestorage.app`) through a second Admin app named `activity-gridline-source`. That project's Firestore and Storage must grant this project's functions service account read access.

Both require `Authorization: Bearer <Firebase ID token>`. Failure returns 401 `unauthenticated`.

### Authorization chain (both endpoints)

For each life event requested, in order:

1. The calendar exists and its `ownerUid` equals the caller (403 `owner_required`).
2. The life event exists in that calendar; its `calendarId` and `timeLeftUserId` match; its `sourceApp` is `gridlineai`; any `sourceFirebaseProjectId` is `gridlineai` (403 `event_scope_denied` / `source_scope_denied`).
3. The event's `connectionId` resolves to a `sourceConnections` document owned by the caller with `sourceApp` `gridlineai` (403 `connection_scope_denied`).
4. The event's `sourceProjectId` is in the connection's `sourceProjectIds`. Firebase app ids such as `1:123:web:...` are always rejected (403 `project_scope_denied`).
5. The source record itself (a `logEntries/{id}` or `media/{id}` document, taken from `sourceRecordId`, `sourceEventId` or `metadata.sourceDocumentPath`) must belong to the same project as the event.

The endpoints read exact documents by id only, never running collection queries in GridlineAI, so the cross-project grant can stay narrow.

### `POST /api/activity/journal-details`

Body: `{ calendarId, lifeEventIds: [...] }`, 1 to 200 ids of `[A-Za-z0-9_-]`. Non-POST returns 405.

Response: `{ ok: true, details: [...], media: [...], unavailable: [...] }`.

- `details` has one entry per readable event: `kind` (`journal` or `media`), the note text (multi-line preserved, up to 12,000 characters), a title (explicit title, else the note's first line), timestamps (`occurredAt`, and `sourceSentAt` when supplied), a place name (coordinate-only values are discarded), `projectId`, `dateId`, `mediaIds`, and `shortcutShadow` for journals that were only echoed by an iOS Shortcut.
- `media` lists photos (id, title, caption, content type, timestamps, location). Photos are correlated to journal entries only among records that were individually authorized in the same request, through `linkedLogEntryId` or the journal's `linkedMediaIds` storage paths. Correlated photos get `journalLifeEventId` and `associationTitle`.
- `unavailable` lists events whose source record is gone (`{ lifeEventId, code }`), so one missing record does not fail the whole batch. Any 403 aborts the request.

Reads run in chunks of 12 concurrent requests after the first event has cached the calendar and connection lookups.

### `GET /api/activity/media?calendarId=&lifeEventId=&mediaId=`

Streams one photo. Beyond the shared chain above it also requires that the media document belongs to the same source project, that it is actually linked to the requested event (either the event is that media record, or the journal links to it), and that its storage path starts with `projects/{projectId}/media/` and contains no `..`. The file must exist and be an `image/*` (415 otherwise), and no larger than 20 MB (413). The bytes are returned with `Content-Type`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and no caching. No public or signed URL is ever created.

The browser cannot put a bearer token in an `<img src>`, so `loadAuthorizedActivityImage` fetches the image with the `Authorization` header, turns it into a `Blob` and shows it through an object URL (revoked when the component unmounts). Thumbnails load lazily as they scroll into view.

## Known issues and limitations

These were checked against the current code. None stops the app from working day to day.

1. **Deletion cannot be undone from the app.** See the tombstone description above.
2. **The timezone is fixed.** `America/Toronto` is hardcoded in the frontend utilities; it is not read from the calendar or the browser.
3. **`gridlineai` is hardcoded** as the only journal and photo source, in both `functions/index.js` and the authorization code.
4. **My totals downloads every life event** for the calendar and computes in the browser. That is fine at current volumes but grows with history.
5. **Journal details are capped** at 500 events per view, and photos larger than 20 MB are not previewed.
6. **Classification is pattern based.** Category assignment depends on words appearing in event types, titles and locations. A source that names things differently will land in Moments or Places until the rules in `getTallyActivityLabel` are extended.

## Code map and tests

| Area | Files |
| --- | --- |
| Shell and routing | `src/pages/Dashboard.jsx`, `src/components/PrimaryViewSwitcher.jsx` |
| UI | `src/components/ActivityDashboard.jsx`, `src/styles/activity-cycle.css` |
| Derivation logic | `src/utils/lifeEventUtils.js` |
| Wheel geometry | `src/utils/wheelGeometry.js` |
| Firestore hooks | `src/hooks/useCalendar.js` |
| Browser clients for the functions | `src/services/activityEntries.js`, `src/services/activityJournal.js` |
| Callables | `functions/src/activityEntries.js` |
| HTTP endpoints | `functions/src/activityJournal.js` |
| Exports and second Admin app | `functions/index.js` |
| Hosting routes | `firebase.json` |
| Ingestion side of edits and deletes | `manualOverride` and tombstone checks in `functions/src/ingestion/lifeEventFoundation.js` |

Tests: `src/utils/lifeEventUtils.test.js` (derivation, about 76 tests), `src/utils/wheelGeometry.test.js` (slice angles, minimum size, paths, label fit), `src/components/ActivityDashboard.test.jsx`, `src/services/activityJournal.test.js`, `functions/src/activityEntries.test.js` (edit, ownership and time validation, clearing and omitting location, delete with tombstone, paired edit and paired delete) and `functions/src/activityJournal.test.js` (authorization, sanitized details, fail-closed media). Run them with `npm run test:frontend` and `npm run test:functions`.
