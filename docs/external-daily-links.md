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

## Current Limitation

This repo now has the Time Left To Live side: schema, UI, mappers, source connections, rules, and dry-run backfill mapping. Real-time cross-project ingestion should be added as a Cloud Function or source-app server function once source app credentials and calendar/source mappings are finalized.
