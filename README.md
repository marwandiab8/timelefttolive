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
   firebase use timelefttolive
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
npm run build
firebase deploy --only hosting,firestore,storage --project timelefttolive
```

The Hosting config serves the Vite `dist` folder and rewrites all routes to `index.html`.

## Viewer Sharing

The owner opens **Manage viewers** and invites a viewer by email. The invite is stored at:

```text
lifeCalendars/{calendarId}/viewers/{viewerEmail}
```

When that viewer signs in with the same email, they can accept the invite. Accepted viewers can read:

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
```

Storage uploads are stored at:

```text
lifeCalendars/{calendarId}/dailyEntries/{YYYY-MM-DD}/{filename}
```

## External Firebase Records

`src/services/externalRecords.js` stores cross-project references as attachment metadata only. It does not perform Admin SDK access or cross-project reads. Add credentials or callable backend support later if direct import is required.

## Notes

- Date IDs are stored as local `YYYY-MM-DD` strings to avoid UTC date shifts.
- Events are loaded once per calendar because they color the heatmap.
- Daily entries and attachments load only when a week is opened.
- Storage rules can verify calendar owner/viewer status, but cannot deeply inspect each Firestore attachment visibility before serving a file URL. Owner-only attachment metadata remains hidden from viewers.
