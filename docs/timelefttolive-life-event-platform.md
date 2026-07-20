# TimeLeftToLive Life Event Platform Design

Current source-of-truth is `aigridline/docs/timelefttolive-activity-architecture.md`.

## 1) Executive architecture
TimeLeftToLive becomes the single canonical life-event and analytics platform, while each source app keeps native models and writes only through adapters.

Current reality stays compatible:
- TimeLeftToLive receives daily-item payloads at `ingestExternalDailyItem` / `ingestExternalDailyItemsBatch` in `timelefttolive` (region `northamerica-northeast1`).
- Source apps already in use: aigridline, GYM-K2 (`gym-k2`), Darts (`dartstracker2026`), and GridlineAI-like variants.
- Existing source-integration security already uses `calendarId + connectionId + bearer token` plus allowlisted projects.

The v2 platform shifts from source-specific “external items” to canonical `LifeEvent` as the model of truth and derives sessions/visits/habits/aggregates from it.

```mermaid
flowchart TD
  TL[TimeLeftToLive Platform\n(northamerica-northeast1)]
  subgraph Sources
    AG[aigridline / GridlineAI]
    Gym[GYM-K2]
    Dart[Darts]
    SC[Apple Shortcuts]
    F[Future apps + services]
  end

  subgraph TL Platform
    Reg[Integration Registry\n/lifeCalendars/{calendarId}/sourceConnections]
    Ingest[/api/v1/life-events/ ingest/
legacy batch compat]
    Raw[LifeEvents]
    Derived[Derived Objects\nSessions, Visits, Habits, Timeline, Summaries]
    Agg[Day/Week/Month/Year aggregations + Donut categories]
  end

  AG -->|Ingest adapter\n(HTTP + token)| Ingest
  Gym -->|Ingest adapter| Ingest
  Dart -->|Ingest adapter| Ingest
  SC -->|Boundary events now through aigridline\nand optional direct path| Ingest
  F -->|OAuth / service token| Reg
  Reg --> Ingest
  Ingest --> Raw
  Raw --> Derived
  Derived --> Agg
  TL --> TL_UI[TimeLeft UI + Donut/Timeline]
```

## 2) System boundaries
Canonical ownership boundaries must stay strict.

Source records are source-app-native and remain in each source Firestore project. Source apps keep capture, editing UX, local permissions, and domain workflows.

TimeLeftToLive owns: integration registry, canonical life-events, deduplication, event linking, derived sessions/habits/visits/timelines/summaries, and all cross-app analytics APIs.

No source app is required to use TimeLeft’s schema for native features. Each adapter normalizes local records to the LifeEvent contract only at egress.

## 3) Canonical LifeEvent schema
Use a compact v1 contract that can grow with optional maps.

```json
{
  "schemaVersion": 1,
  "id": "life_event_id",
  "timeLeftUserId": "uid",
  "integrationId": "integration_id",
  "sourceApp": "aigridline",
  "sourceProjectId": "project-id-in-source",
  "sourceUserId": "user-id-in-source",
  "sourceRecordId": "record-id",
  "sourceEventId": "event-id-or-boundary-id",
  "eventType": "start_workout",
  "eventClass": "activity_boundary",
  "activityFamily": "workout",
  "categoryId": "workout",
  "title": "Workout started",
  "occurredAt": "2026-07-20T14:05:00Z",
  "startAt": "2026-07-20T14:05:00Z",
  "endAt": null,
  "durationSeconds": null,
  "timezone": "America/Toronto",
  "location": {
    "label": "Gym",
    "latitude": 43.65,
    "longitude": -79.38,
    "geohash": "f25dvx"
  },
  "metrics": { "calories": 0, "steps": 0 },
  "participants": [{"sourceUserId":"", "role":"actor"}],
  "metadata": { "sourceDocumentPath": "users/uid/workout_summaries/abc" },
  "privacyLevel": "ownerOnly",
  "ingestionStatus": "received|replaced|needs_date_review|failed",
  "createdAt": "2026-07-20T14:05:10Z",
  "updatedAt": "2026-07-20T14:05:12Z"
}
```

Keep extension points minimal and typed at the top level; only allow domain variance in `metrics`, `participants`, and `metadata`.

Recommended event class baseline:
activity_boundary, completed_activity, location_visit, measurement, achievement, task, media, communication, project, finance, health, system.

Classification examples:
- `arrive_work`, `leave_work`, `start_workout`, `finish_workout` => `activity_boundary`
- `completed gym workout`, `darts match`, `Spotify listening session` => `completed_activity`
- `step total` => `measurement`
- `daily construction report`, `project milestone` => `project` or `task` depending on intent
- `appointment` => `project` or `task` if it is a scheduled item
- `exercise set` => not a root LifeEvent; include as nested `metadata` / `metrics` on the workout LifeEvent

## 4) Integration Registry schema
Registry is the source-of-truth identity boundary.

Use existing connection document under `lifeCalendars/{calendarId}/sourceConnections/{connectionId}` and introduce these fields:

- `integrationId` stable ID generated on first activation
- `timeLeftUserId` resolved owner uid
- `sourceApp`, `sourceFirebaseProjectId`, `sourceProjectIds[]`
- `sourceUserId` for source-side identity (do not assume equal to `timeLeftUserId`)
- `connectionId` kept for compatibility and secret lookup
- `status` (`active`, `paused`, `revoked`)
- `permissions` (eventClass allowlist, source scope)
- `secretRef` (reference name only, not a secret value)
- `lastReceivedAt`, `lastSuccessfulSyncAt`, `schemaVersion`, `createdAt`, `updatedAt`

Do not store any bearer token or credentials in this document. Keep credentials in `sourceConnectionSecrets/{connectionId}` as token hash only (current model).

Current model migration rule:
- Keep `calendarId` and `connectionId` exactly as-is.
- Add `integrationId` as a stable alias and emit it in every ingested request.
- Keep legacy `sourceFirebaseProjectId` and allowlist checks to avoid breaking existing deployments.

## 5) Ingestion API contract
Design one versioned API and retain current endpoints as compatibility adapters during migration.

Primary endpoint:
- `POST /api/v1/life-events`

Batch endpoint:
- `POST /api/v1/life-events:batch`

Legacy compatibility (existing):
- `ingestExternalDailyItem`
- `ingestExternalDailyItemsBatch`

Payload shape (single):
- `calendarId`, `connectionId`, `events[0]`

Payload shape (batch):
- `calendarId`, `connectionId`, `items[]`

Core response shape:
- `ok`, `requestId`, `summary`, `results[]` with per-index status.

Recommended idempotency key:
- `idempotencyKey = sha256(integrationId + ':' + schemaVersion + ':' + (sourceEventId || sourceRecordId))`

If no explicit idempotency key, server derives stable key from the same fields and rejects conflicting payload updates unless event content changed in deterministic way and source explicitly requests replace semantics.

Validation contract:
- bearer token required
- token + calendarId + connectionId + integration binding
- sourceApp + sourceFirebaseProjectId + sourceProjectId allowlist
- event schema validation by `schemaVersion`
- per-integration eventClass permissions

Failure behavior:
- one bad item in batch returns item-level error with other items processed
- persistent failures can be surfaced to a retry queue + dead-letter collection

## 6) Authentication and authorization
Use the existing ownership model with stricter API-level rules.

- Source token created only by calendar owner via callable function.
- Token stored only as hash in `sourceConnectionSecrets/{connectionId}` and verified on every request.
- Authorization checks include connection status and permission scope (`sourceProjectIds`, `eventClass` allowlist).
- Source and target calendar IDs remain independent; no assumption that Firebase Auth `uid` values match across projects.
- Observability uses request-level IDs, never raw tokens or PII-rich payload dumps.

## 7) Idempotency and deduplication

Deduplication has three layers.

1) Exact source dedupe
Use canonical key and deterministic hash:
- `integrationId`
- `sourceApp`
- `sourceFirebaseProjectId`
- `sourceRecordId or sourceEventId`
- `schemaVersion`

2) Semantic correlation
Detect likely duplicates across sources by near-time overlap and category:
- same user, similar event class/family, overlapping `startAt/endAt` windows, and compatible location.

3) Event linking
- store `linkedTo` on events for same real-world event from multiple sources
- mark one as primary by confidence score.

Confidence defaults (starter)
- aigridline boundary session event: high
- GYM completed workout: high
- Darts match summary: high
- location auto-tracking visit: medium

Precedence rules to prevent double-counting
- for Donut and timeline duration, aggregate from derived sessions, not raw boundary events.
- related events from multiple sources may all remain visible as evidence.

Never delete overlapping real-world events solely due to overlap.

## 8) Derived-data model
All derived objects must carry source event lineage.

- `ActivitySession`: references `lifeEventIds[]`, has `derivedFrom: [{lifeEventId, confidence}]`
- `LocationVisit`: references `lifeEventIds[]`
- `HabitOccurrence`: references `lifeEventIds[]` and a deterministic `habitKey`
- `TimelineEntry`: references one or more `lifeEventIds[]`
- `DailySummary`: references `lifeEventIds[]` and source buckets
- `HealthFact` / `FinanceFact` / `ProjectFact`: reference source life events and raw metric ids

When practical, all must be rebuildable from LifeEvents via deterministic jobs.

## 9) Source-adapter responsibilities
Adapter responsibilities are fixed and uniform across all sources.

- Keep source-native records unchanged.
- Compute stable `sourceRecordId/sourceEventId` and `integrationId`.
- Validate required time + identity fields.
- Send one or batch payloads to ingestion API.
- Persist outbound send state (last sync offset, last error, retry count).
- Never emit client-readable credentials.

Adapters should not materialize cross-project session logic.

## 10) aigridline / GridlineAI integration
Keep aigridline as source system and transport owner.

What remains in aigridline:
- capture of `dailyReports`, `media`, `logEntries`.
- existing IOS shortcut ingestion + project workflows.
- source user/project authorization.

What moves to TimeLeftToLive:
- canonical ownership and lifecycle of boundary/completed events.
- dedupe and correlation across external boundary events.
- derived activity sessions/timeline objects.

Current transport recommendation:
- continue existing function-based transport (`syncDailyReportToTimeLeft`, `syncMediaToTimeLeft`, `syncLogEntryToTimeLeft`) to current ingest for continuity.
- add optional `LifeEvent` emitter from the same writes for new fields (start/end/duration where available).
- do not change source UX while dual-write is active.

Migration of aigridline session work:
- keep activitySessionEngine intact initially.
- emit boundary events from current iosShortcut event source.
- send boundary LifeEvents to TL v1 in parallel to local session writes.

## 11) GYM-K2 integration
Source data to send:
- workout started, workout completed
- total duration
- routine and exercise-level summary
- set/reps/weight details
- gym visit markers when available

Recommended LifeEvent shape:
- `eventClass`: `completed_activity`
- `eventType`: `completed_gym_workout`
- `activityFamily`: `workout`
- `startAt/endAt/durationSeconds`

Whether exercise sets are LifeEvents:
- not by default.
- keep per-set details in `metadata` under the completed workout LifeEvent for now.
- if future analysis requires per-set drilldown, introduce a separate `metricRecord` child object later.

Use existing transport endpoint and config to start (single endpoint + token), while adding a new canonical-mode path.

## 12) Darts integration
Source data to send:
- practice session and match records
- duration
- result score
- score summaries (targets, hit counts)
- opponent/opposition when present
- PR/achievement markers

Recommended LifeEvent shape:
- `eventClass`: `completed_activity`
- `eventType`: `completed_darts_match` or `completed_darts_practice`
- `activityFamily`: `darts`

Do not send each dart throw as a LifeEvent.
Per-throw data remains source-native and nested within `metadata` or source document references.

Current Darts trigger model already maps `sessions/{sessionId}` and can be adapted to dual-write canonical events.

## 13) Apple Shortcuts migration
Shortcuts currently posts into `iosShortcutsEvents` and aigridline builds boundary sessions.

Recommended path:
1) keep aigridline as intermediary initially (no behavior break);
2) add direct LifeEvent emission from `iosShortcutsEvents` pipeline into TimeLeftToLive;
3) optionally keep source-side session writes as source of truth until TL sessions are stable;
4) migrate clients to call aigridline public HTTP endpoint unchanged, then move TL-boundary ingestion into background adapter.

Do not remove existing flow without a parity dashboard and rollback switch.

## 14) Privacy and retention
Owner-only is default.

- `ownerOnly` visibility on personal event and timeline collections.
- optional `viewers` role where explicitly granted.
- integration writes are write-only for sources and read-only for users/admin with registry/secret restrictions.
- exact coordinates are precision-guarded at read-time for non-owner viewers.
- admin support users can view all events but not source credentials; no secret reads.
- delete flow: deleting a connection disables ingestion and marks future events as invalidated; previously ingested data remains for user control and audit.
- export flow: export should include canonical events + derived objects + raw metadata references.

Retention policy:
- keep raw external payload only as required by audit; retain dedupe metadata longer than derived if user configured.

## 15) Migration of existing Phase 2 work
Phase 2 session work currently in aigridline should be staged and preserved.

1. Freeze behavior in source by keeping existing output as canonical truth for users.
2. Add TimeLeftToLive dual-write adapters in aigridline for each existing source event path.
3. Keep old sync functions (`ingestExternalDailyItem*`) functional.
4. Add v1 life-event ingestion support in TL only.
5. Run backfill in read-only mode and reconcile counts by event IDs and session IDs.
6. Switch one dashboard read path in feature mode to TL sessions.
7. Retire local session reads after parity.

Rollback checkpoints:
- pre-dual-write snapshot
- dual-write staging with read-only TL derivations
- cutover with quick toggle and immediate fallback to source-local session reads

## 16) Revised implementation phases
Phase 0: design frozen + compatibility mapping.

Phase 1: TL ingestion v1 endpoint + canonical `LifeEvents` collection + stable idempotency + dead-letter collection.

Phase 2: deterministic derived builders for `TimelineEntry` and `ActivitySession` + `LocationVisit` MVP.

Phase 3: source adapter migration (aigridline boundary, GYM completed-workout, Darts session summary).

Phase 4: analytics readiness (`Day` and `Week` aggregations + habits + donut categories), with Month/Year hooks deferred.

Phase 5: privacy hardening, retention policy enforcement, and admin support surfaces.

## 17) Exact next coding phase
Implement in TimeLeftToLive first:
- `POST /api/v1/life-events` and `POST /api/v1/life-events:batch`
- canonical `LifeEvent` write path under `lifeCalendars/{calendarId}/lifeEvents/{id}`
- idempotency key generation and exact dedupe using `integrationId + sourceEventId/RecordId + schemaVersion`
- compatibility adapters so existing `ingestExternalDailyItem` and `ingestExternalDailyItemsBatch` map to LifeEvents behind the scenes

## 18) Open decisions requiring approval
1. Should `activitySessions` and `locationVisits` be separate top-level collections in TL or nested under `derived/`?
2. Should privacy default remain `ownerOnly` for all LifeEvents or allow `viewers` for non-sensitive families by default?
3. Should Donut categories be computed directly from LifeEvents or from derived sessions first?
4. Should exact location be optional (`locationPresent=true/false`) for all sources or stored per-source by `privacyLevel`?
5. How should `sourceConnectionSecrets` storage be standardized: continue collection-stored hash or move to Secret Manager-backed references only?
