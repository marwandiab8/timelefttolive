# External Daily Links

Time Left To Live stores linked records from other apps under the exact day they belong to:

```text
lifeCalendars/{calendarId}/dailyEntries/{YYYY-MM-DD}/externalItems/{externalItemId}
```

The source record is not deleted or copied blindly. Each external item stores source metadata, a dedupe key, visibility, and optional public file URLs or source references.

## Source Connections

Owners can manage source apps in **External sources**:

```text
lifeCalendars/{calendarId}/sourceConnections/{connectionId}
```

Fields:

```js
{
  sourceApp,
  sourceFirebaseProjectId,
  sourceOwnerUid,
  sourceUserEmail,
  sourceProjectIds,
  status,
  createdAt,
  updatedAt,
  createdByUid,
  lastSyncedAt
}
```

## Canonical Payload

Source apps should map their records to:

```js
{
  calendarId,
  ownerUid,
  dateId,
  sourceApp,
  category,
  title,
  summary,
  description,
  sourceFirebaseProjectId,
  sourceProjectName,
  sourceProjectId,
  sourceCollection,
  sourceDocumentId,
  sourceDocumentPath,
  sourceStoragePath,
  sourceUrl,
  fileUrl,
  thumbnailUrl,
  contentType,
  fileName,
  fileSize,
  originalCreatedAt,
  originalUpdatedAt,
  capturedAt,
  visibility,
  metadata
}
```

Date resolution priority:

1. `dateId`, `reportDate`, `reportDateKey`, `dateKey`, `journalDate`, `workoutDate`, `progressDate`, `dartDate`, `createdForDate`
2. `capturedAt`
3. `originalCreatedAt`
4. `fileMetadataDate`
5. `uploadedAt`
6. `createdAt`

If no valid `YYYY-MM-DD` date is found, the mapper marks the item as `needsDateReview`.

## Example Payloads

### aigridline report picture

```json
{
  "calendarId": "TIME_LEFT_CALENDAR_ID",
  "ownerUid": "TIME_LEFT_OWNER_UID",
  "sourceApp": "aigridline",
  "category": "projectPicture",
  "title": "Site photo",
  "dateId": "2028-07-25",
  "sourceFirebaseProjectId": "aigridline",
  "sourceProjectName": "Fergus Legion",
  "sourceProjectId": "fergus-legion",
  "sourceCollection": "media",
  "sourceDocumentId": "MEDIA_DOC_ID",
  "sourceDocumentPath": "media/MEDIA_DOC_ID",
  "sourceStoragePath": "media/2028/07/photo.jpg",
  "thumbnailUrl": "https://...",
  "fileUrl": "https://...",
  "contentType": "image/jpeg",
  "visibility": "ownerOnly"
}
```

### GYM-K2 workout

```json
{
  "calendarId": "TIME_LEFT_CALENDAR_ID",
  "ownerUid": "TIME_LEFT_OWNER_UID",
  "sourceApp": "GYM-K2",
  "category": "workout",
  "title": "Push day",
  "summary": "Bench, incline press, triceps",
  "workoutDate": "2028-07-25",
  "sourceFirebaseProjectId": "gym-k2",
  "sourceCollection": "workouts",
  "sourceDocumentId": "WORKOUT_DOC_ID",
  "sourceDocumentPath": "workouts/WORKOUT_DOC_ID",
  "metadata": {
    "durationMinutes": 72,
    "exercises": []
  }
}
```

## Backfill

Dry-run JSON mapping:

```bash
npm run backfill:external -- --calendarId=CALENDAR_ID --sourceApp=aigridline --input=records.json --dryRun
```

Without `--input`, the script prints a planned summary. Cross-project Firestore scanning must run server-side with Admin credentials; do not put Admin credentials in the browser.

## Ingestion

Real-time ingestion is implemented as Cloud Functions in `functions/`. Source apps call `ingestExternalDailyItem` / `ingestExternalDailyItemsBatch` (legacy, this document's payload shape) or `POST /api/v1/life-events` (canonical). Both authenticate with a per-connection bearer token created from **External sources**, and the legacy endpoints also mirror supported items into canonical `lifeEvents`. See the [README](../README.md#cloud-functions) and [the phase 1 handoff](timelefttolive-life-event-ingestion-phase-1-handoff.md).

## Backfill Limitation

`npm run backfill:external` only maps records from a JSON file and prints the result; it performs no writes. Cross-project Firestore scanning must run server-side with Admin credentials. To backfill legacy items into canonical `lifeEvents`, use `npm run backfill:life-events` instead.
