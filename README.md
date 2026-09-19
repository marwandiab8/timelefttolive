# Time Left To Live

A private life-calendar and mortality-awareness dashboard. Users sign in, create a personal profile, and see one square per week from birth until a target age. Each year is one horizontal row with 52 week cells.

## Features

- Firebase Auth with Google and email/password sign-in.
- Owner-owned Firestore calendar data.
- Full-width 52-week life heatmap with current-week outline, event indicators, and weekend mini-strips.
- Click any week to see the seven individual dates inside that week.
- Daily journals, tags, links, file/image uploads, and external Firebase record metadata links.
- Date-range events with visibility and overlap indicators.
- Viewer invites with read-only access for accepted viewers.
- Firestore and Storage rules for owner/viewer permissions.
- Owner-only **Activity dashboard** (`#activity`): a day/week/month/year "life wheel", chronological timeline, all-time totals, work attendance, workout summaries, journal notes and photos, all derived from ingested life events. Entries can be edited or deleted.
- Life-event ingestion API (`POST /api/v1/life-events` and `:batch`) that other apps (aigridline/GridlineAI, GYM-K2, Darts tracker, MyDoubleProgress, Apple Shortcuts via aigridline) write to with per-connection bearer tokens.

## Firebase Setup

1. Create a Firebase project.
2. Register a Web App in Project Settings.
3. Enable Authentication:
   - Add Google provider.
   - Add Email/Password provider.
4. Enable Cloud Firestore.
5. Enable Firebase Storage.
6. Install and log in to Firebase CLI:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
7. Select or confirm the project:
   ```bash
   firebase use YOUR_FIREBASE_PROJECT_ID
   ```

## Environment Variables

Create a local `.env` file from `.env.example` and paste your Firebase Web App config:

```bash
cp .env.example .env
```

Required keys:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Do not commit `.env`. It is ignored by git.

## Run Locally

```bash
npm ci
npm run dev
```

## Build

```bash
npm ci
npm run build
```

## Deploy

```bash
npm ci
npm --prefix functions ci
npm run build
firebase deploy --only hosting,functions,firestore,storage --project YOUR_FIREBASE_PROJECT_ID
```

The Hosting config serves the Vite `dist` folder and rewrites all routes to `index.html`, except the `/api/...` routes listed under [Cloud Functions](#cloud-functions), which are rewritten to functions. Deploy `functions` together with `hosting`, otherwise those API routes have no backend.

Always pass `--project` explicitly. `.firebaserc` defines `production` (`timelefttolive`) and `staging` (`timelefttolive-stg-go`) aliases, and `npm run build:staging` builds against staging and refuses to embed the production project. See [docs/timelefttolive-life-event-ingestion-staging-plan.md](docs/timelefttolive-life-event-ingestion-staging-plan.md).

## Test

```bash
npm run test:frontend    # vitest, src/
npm run test:functions   # node --test, functions/src/
npm run test:rules       # Firestore rules, needs Java for the emulator
npm run test:hosting     # hosting rewrites + ingestion through the emulators
npm test                 # all of the above
```

The functions require Node 22 (see `functions/package.json`).

## Viewer Sharing

The owner opens **Manage viewers** and invites a viewer by email. The invite is stored at:

```text
lifeCalendars/{calendarId}/viewers/{viewerEmail}
```

When that viewer signs in with the same email, they can accept the invite. The email must be verified: Google accounts already are, and email/password accounts are sent a verification link on sign-up (the dashboard offers to resend it). Firestore and Storage rules check `email_verified` on the ID token, so an unverified account cannot accept an invite or read shared data. Accepted viewers can read:

- the calendar profile,
- events marked `visibility: "viewers"`,
- daily entries marked `visibility: "viewers"`,
- attachments marked `visibility: "viewers"`.

Viewers cannot create, edit, upload, or delete data. Owner-only records are hidden by Firestore rules and filtered in the UI.

## Firestore Model

```text
users/{uid}
lifeCalendars/{calendarId}
lifeCalendars/{calendarId}/viewers/{viewerEmail}
lifeCalendars/{calendarId}/events/{eventId}
lifeCalendars/{calendarId}/dailyEntries/{YYYY-MM-DD}
lifeCalendars/{calendarId}/dailyEntries/{YYYY-MM-DD}/attachments/{attachmentId}
lifeCalendars/{calendarId}/dailyEntries/{YYYY-MM-DD}/externalItems/{externalItemId}
lifeCalendars/{calendarId}/sourceConnections/{connectionId}
lifeCalendars/{calendarId}/lifeEvents/{lifeEventId}
```

Server-only collections (no client access) under each calendar: `sourceConnectionSecrets`, `lifeEventTombstones`, `ingestionDeadLetters`, `rawIngestionPayloads`. `externalIndex` and `externalNeedsDateReview` are owner-readable but server-written. `lifeEvents` is owner-read-only; every write goes through Cloud Functions.

Storage uploads are stored at:

```text
lifeCalendars/{calendarId}/dailyEntries/{YYYY-MM-DD}/{filename}
```

## External Firebase Records

`src/services/externalRecords.js` stores cross-project references as attachment metadata only. It does not perform Admin SDK access or cross-project reads. Add credentials or callable backend support later if direct import is required.

## External Daily Links

The app supports linked source records under:

```text
lifeCalendars/{calendarId}/dailyEntries/{YYYY-MM-DD}/externalItems/{externalItemId}
```

Owners can manage source app connections from **External sources**. Day detail groups linked reports, pictures, workouts, MyDoubleProgress records, darts records, and other items. Connector/mapping details and example payloads are in [docs/external-daily-links.md](docs/external-daily-links.md).

## Cloud Functions

All functions live in `functions/` and run in `northamerica-northeast1`.

| Function | Route / trigger | Purpose |
| --- | --- | --- |
| `apiV1LifeEvents`, `apiV1LifeEventsBatch` | `POST /api/v1/life-events`, `/api/v1/life-events:batch` | Canonical life-event ingestion (bearer token, idempotent, max 100 per batch). |
| `ingestExternalDailyItem`, `ingestExternalDailyItemsBatch` | HTTPS | Legacy daily-item ingestion, kept compatible and mirrored into `lifeEvents`. |
| `createSourceIngestionToken`, `revokeSourceIngestionToken` | callable | Owner-only management of source connection tokens (only a hash is stored). |
| `editActivityEntry`, `deleteActivityEntry` | callable | Owner-only edit and delete of a life event. Deletes write a tombstone so re-ingestion does not bring the entry back. |
| `getActivityJournalDetails`, `getActivityMedia` | `POST /api/activity/journal-details`, `GET /api/activity/media` (Firebase ID token as bearer) | Read journal text and photos for the Activity dashboard from the separate `gridlineai` Firebase project (hardcoded in `functions/index.js`) using a second Admin app. |
| `cleanupLifeEventIngestionArtifacts` | scheduled, every 24h | Deletes expired raw-payload audit records and dead letters. |

The dashboard and the four activity functions are documented in [docs/activity-dashboard.md](docs/activity-dashboard.md). The ingestion design and contract are in [docs/timelefttolive-life-event-platform.md](docs/timelefttolive-life-event-platform.md) and [docs/timelefttolive-life-event-ingestion-phase-1-handoff.md](docs/timelefttolive-life-event-ingestion-phase-1-handoff.md). Those two describe phase 1 only.

## Operational Scripts

The Admin-SDK scripts need Application Default Credentials and an explicit `--project`.

- `npm run backfill:external` only maps a JSON file of records and prints the result; it never writes (see [docs/external-daily-links.md](docs/external-daily-links.md)).
- `npm run backfill:life-events -- --project=ID [--calendar-id=ID]` backfills legacy external items into canonical `lifeEvents`. It is a dry run unless `--apply` is passed.
- `npm run enrich:gridline-journals -- --project=ID` enriches journal life events from their legacy records. It is a dry run unless `--apply` is passed, and `--apply` also requires `--confirm-project=ID`.
- `npm run staging:fixture:create`, `staging:fixture:cleanup` and `staging:smoke-test` only run against the staging project.

## Notes

- Date IDs are stored as local `YYYY-MM-DD` strings to avoid UTC date shifts.
- Events are loaded once per calendar because they color the heatmap.
- Daily entries and attachments load only when a week is opened.
- Storage rules can verify calendar owner/viewer status, but cannot deeply inspect each Firestore attachment visibility before serving a file URL. Owner-only attachment metadata remains hidden from viewers.
