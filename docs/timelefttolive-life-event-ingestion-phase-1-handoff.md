# TimeLeftToLive Life Event Ingestion — Phase 1 Handoff

## 1) Scope and phase status
Phase 1 implements the TimeLeftToLive Life Event ingestion foundation only. Implemented areas:
- Canonical `lifeEvents` storage in `lifeCalendars/{calendarId}/lifeEvents/{id}`.
- Integration registry binding and bearer-token auth enforcement.
- New v1 ingestion endpoints (`POST /api/v1/life-events`, `POST /api/v1/life-events:batch`).
- Deterministic idempotency with exact replay behavior and conflict detection.
- Legacy endpoint compatibility through adapters under existing `ingestExternalDailyItem` routes.
- Dead-letter + raw-audit artifact writes with scheduled cleanup.

The following remain out of scope per instruction:
- ActivitySession/TimelineEntry/LocationVisit derivation
- Aggregations (Day/Week/Month/Year)
- Donut dashboard and UI pages
- Source adapter migrations for GYM-K2, Darts, and dual-write parity
- Apple Shortcuts direct integration

## 2) Canonical LifeEvent v1 implemented
Stored at `lifeCalendars/{calendarId}/lifeEvents/{lifeEventId}` and includes:
- `schemaVersion`
- `timeLeftUserId`
- `calendarId`
- `integrationId`
- `connectionId`
- `sourceApp`
- `sourceProjectId`
- `sourceUserId`
- `sourceRecordId`
- `sourceEventId`
- `eventType`
- `eventClass`
- `activityFamily`
- `categoryId`
- `title`
- `occurredAt`
- `startAt`
- `endAt`
- `durationSeconds`
- `timezone`
- `location` (optional object)
- `metrics`
- `metadata`
- `privacyLevel`
- `idempotencyKey`
- `ingestionStatus`
- `receivedAt`
- `createdAt`
- `updatedAt`

Server also writes:
- `id` (doc id)
- `contentHash` for conflict checks.

## 3) Required/validation rules
Required input on ingest:
- `schemaVersion`
- `integrationId`
- `sourceApp`
- one of (`sourceEventId`, `sourceRecordId`)
- `eventType`
- at least one valid time field: `occurredAt` or `startAt`
- `privacyLevel` defaults to `ownerOnly`

Server-resolved fields (never trusted from payload):
- `timeLeftUserId`
- `calendarId`
- `connectionId`
- `integrationId` (resolved against registry)

## 4) Event classes (v1 set)
Allowed set: `activity_boundary`, `completed_activity`, `location`, `achievement`, `project`, `system`.

Mapping currently enforced:
- `arrive_work`, `leave_work`, `start_workout`, `finish_workout` => `activity_boundary`
- `completed_workout`, `completed_gym_workout`, `completed_darts_match`, `completed_darts_practice` => `completed_activity`
- Unknown explicit class is rejected.

## 5) Time handling
- Accepts ISO timestamps and parses to Firestore-safe Date values.
- If both `startAt` and `endAt` present, duration is computed.
- `endAt < startAt` is rejected.
- `durationSeconds` must be non-negative.
- Conflicting explicit duration vs derived duration is rejected.
- `timezone` preserves explicit input and defaults to `America/Toronto` only when absent.

## 6) Location payload
Optional object with `label`, `latitude`, `longitude`, `accuracyMeters`, `placeId`, `source`.
- Coords validated: `latitude` in `[-90,90]`, `longitude` in `[-180,180]`.
- Both lat/lon must be provided together.

## 7) Endpoint: `POST /api/v1/life-events`
Request examples:
```json
{
  "calendarId": "calendar-1",
  "connectionId": "conn-1",
  "integrationId": "integration-conn-1",
  "schemaVersion": 1,
  "sourceApp": "aigridline",
  "sourceProjectId": "project-a",
  "sourceRecordId": "evt-123",
  "eventType": "arrive_work",
  "occurredAt": "2026-07-20T09:00:00Z"
}
```

Success response:
```json
{
  "status": "success",
  "lifeEventId": "<doc-id>",
  "idempotencyKey": "<sha256>",
  "duplicate": false,
  "schemaVersion": 1,
  "receivedAt": "2026-07-20T09:00:00.000Z"
}
```

Failure formats:
- validation/auth failures include `{ status: "error", code, message }`
- auth failures return 401/403 without token detail
- conflict returns 409 with `existingLifeEventId`

## 8) Endpoint: `POST /api/v1/life-events:batch`
Request is `{ calendarId, connectionId, integrationId, items: [...] }`.

Response includes per-item array with `index`, optional `clientReference`, and item status. Partial success is supported.
- Duplicate/missing required fields are handled independently.
- Oversize batch ( > 100 ) is rejected before processing.

## 9) Idempotency behavior
Key: `sha256(integrationId + ":" + schemaVersion + ":" + (sourceEventId || sourceRecordId))`
- Exact replay returns success with `duplicate:true` and same `lifeEventId`.
- Same key with material mismatch returns `idempotency_conflict` (409).

## 10) Raw payload audit retention
On successful canonical write, minimal sanitized snapshot is stored in:
- `lifeCalendars/{calendarId}/rawIngestionPayloads/{snapshotId}`

Retention:
- auto-expire marker `expiresAt` set to ~90 days from receive.
- no bearer tokens/authorization headers/secrets stored.

Cleanup:
- scheduled function `cleanupLifeEventIngestionArtifacts` runs daily and deletes expired raw snapshots and dead letters.

## 11) Dead letters
On unexpected internal processing failures (post-auth), record to:
- `lifeCalendars/{calendarId}/ingestionDeadLetters/{id}`

Stored fields include integration/source identifiers, error code/summary, payload hash, retry count, timestamps.
Validation failures are intentionally excluded from dead-lettering.

## 12) Legacy compatibility adapters
`ingestExternalDailyItem` and `ingestExternalDailyItemsBatch` now:
- keep existing `upsertExternalItem` behavior for source-native storage
- map supported legacy records to canonical LifeEvents in parallel
- keep legacy response shape and add canonical ingestion result metadata.

No attempt to synthesize unsupported legacy data into canonical events.

## 13) Security rules and indexes
Rules:
- `lifeEvents`: owner-only read, no direct writes.
- `ingestionDeadLetters`, `rawIngestionPayloads`: server-only (no client read/write).
- existing source connection secret rules remain server-only.

Indexes:
- `lifeEvents`: `(timeLeftUserId ASC, occurredAt DESC)`
- `rawIngestionPayloads`: `(expiresAt ASC)`

## 14) Current limitations
- No source-app admin/organization visibility exceptions are added beyond existing owner model.
- No collection-level location obfuscation is added beyond owner-only read access.
- No full canonical v1 API docs/SDK/clients yet.
- `normalizeLocation`/`location` currently stores coordinates directly in canonical payload for owner-only reads.

## 15) Tests executed
- `node --test` inside `functions` (covers ingestion + legacy compatibility tests).
- `npm --prefix /home/marwan/Documents/timelefttolive test` (frontend unit tests in `src`).
- `node --check` on changed function source files.

## 16) Next phase
Phase 2: add derivation for `TimelineEntry`, `ActivitySession`, and `LocationVisit` from canonical `lifeEvents`, while keeping current legacy ingestion compatibility and parity validation.
