# TimeLeftToLive Life-Event Phase 1 Staging Deployment Plan

## 1) Repository state (checked)
- `git status --short`: not clean (`?? firestore-debug.log`).
- `git log -5 --oneline`: includes `9c30158`, `87d8d41`, `191156b`, `d316c0a` at HEAD with latest `d316c0a`.
- `git branch --show-current`: `main`.
- `git branch -vv`: `main` tracking info only local.
- `git branch -r`: `origin/main`.
- `git remote -v`: single `origin` pointing to `git@github.com:marwandiad8/timelefttolive.git`.
- Commit presence:
  - `d316c0a` is present locally on `main`.
  - `d316c0a` is **not** present on `origin/main` yet.
- `git branch --contains/merge-base check`: local HEAD is not an ancestor of `origin/main`.

## 2) Production and staging target IDs
- Production project currently configured: `timelefttolive`.
  - `.firebaserc` currently:
    - `projects.default = timelefttolive`
  - `.env` uses `VITE_FIREBASE_PROJECT_ID=timelefttolive`.
  - `firebase use --json` returns `timelefttolive`.
- Staging project currently configured: **not configured** in this repo.
- Existing aliases: only `default`.
- Current `firebase projects:list --json` does not show an id matching a dedicated TimeLeftToLive staging project.

## 3) Deployment readiness result
- **NOT READY**.
- Blockers are environment-level (not code): missing dedicated staging Firebase project/alias and non-clean working tree.
- No deployment or environment mutation was performed in this pass.

## 4) Required deployment scope (Phase 1 only)
From source verification:
- `functions/index.js` exports exactly:
  - `apiV1LifeEvents`
  - `apiV1LifeEventsBatch`
  - `ingestExternalDailyItem`
  - `ingestExternalDailyItemsBatch`
  - `createSourceIngestionToken`
  - `revokeSourceIngestionToken`
  - `cleanupLifeEventIngestionArtifacts`
- Region is fixed in source: `northamerica-northeast1`.
- Hosting rewrites required:
  - `/api/v1/life-events` → `apiV1LifeEvents`
  - `/api/v1/life-events:batch` → `apiV1LifeEventsBatch`
- Explicitly exclude from this phase:
  - Donut UI
  - ActivitySession, TimelineEntry, LocationVisit
  - Aggregations / retention changes beyond current TTL/dead-letter policy
  - Non-Life-Event source adapters, GridlineAI integration, GYM-K2/Darts integration changes

## 5) Required configuration and secrets
- Firebase project/service configuration:
  - Firestore enabled
  - Authentication enabled
  - Hosting enabled
  - Cloud Functions enabled
  - Cloud Scheduler enabled for `cleanupLifeEventIngestionArtifacts` (runs every 24 hours UTC)
- Existing config from code:
  - Function region: `northamerica-northeast1`
  - Integration ID, idempotency, and auth resolved from registry/secret docs.
  - Retention constants in `functions/src/ingestion/lifeEventFoundation.js`:
    - Raw audit: 90 days (`RAW_AUDIT_TTL_MS`)
    - Dead letter: 30 days (`DEAD_LETTER_TTL_MS`)
  - Cleanup limits:
    - `CLEANUP_QUERY_LIMIT=100`, `CLEANUP_WRITE_BATCH_SIZE=50`
- Secret/config items required by staging:
  - `timeLeftUserId` in `sourceConnections/{connectionId}`
  - `connection.integrationId` resolved by token operations
  - `connection.sourceApp`
  - `connection.sourceFirebaseProjectId`
  - `connection.sourceProjectIds[]`
  - `connection.permissions.eventClasses[]`
  - `sourceConnectionSecrets/{connectionId}.tokenHash` generated at ingest-token creation
- Required fixture/administrative config **not in code** (must be created in staging):
  - dedicated `lifeCalendars` fixture records
  - fixture sourceConnection + sourceConnectionSecret
  - ingestion token generated via callable `createSourceIngestionToken`
  - optional seed data and observability labels/alerts
- Classification per item:
  - Already present in code: all function names, route behavior, retention constants, index definitions.
  - Must be created (staging): staging project and initial fixture docs/secrets.
  - Auto-created on deploy: function infra and hosting rewrite deployment.
  - Manually configured after deploy: fixture source connection/token/secrets and monitoring/alerts.
  - Production-only should not be copied: production `lifeCalendars/*`, user source connections, existing production tokens.

## 6) Runtime and compatibility
- Local tooling:
  - Node runtime used locally: `v22.22.2`.
  - Firebase CLI: `15.24.0`.
  - Frontend package has no runtime pin.
- Functions runtime/config:
  - `functions/package.json` -> `engines.node = 22`.
  - `firebase-functions` dependency `^7.2.5` (v2 APIs).
- No deployment blocker identified from current code inspection.
- Known warning:
  - Existing Firebase CLI execution emits Node deprecation warning (`punycode`) from CLI/runtime environment.

## 7) Firestore indexes, rules, scheduled cleanup
- Exact indexes in `firestore.indexes.json`:
  - `lifeEvents`: `(timeLeftUserId ASC, occurredAt DESC)`
  - `rawIngestionPayloads`: `(expiresAt ASC)`
  - Existing pre-existing indexes for `events`, `dailyEntries`, `externalItems` remain unchanged.
- Build behavior:
  - Collection indexes may report building state after deploy; confirm with index status before load-sensitive use.
- Rules in Phase 1:
  - `lifeEvents`: owner read only, no client write.
  - `ingestionDeadLetters`, `rawIngestionPayloads`, `sourceConnectionSecrets`: server-only (false for read/write).
  - `sourceConnections`: owner read/write.
- Runtime status expectations:
  - LifeEvent docs owner-readable only.
  - Raw audit/dead letters server-only and unretrievable by clients.
  - `cleanupLifeEventIngestionArtifacts` runs daily via scheduler in `northamerica-northeast1`.

## 8) Staging fixture design (not created)
Design one stable fixture set for staging smoke tests:
- `calendarId`: `calendar-staging-test`
- `connectionId`: `connection-staging-test-source`
- `integrationId`: `integration-staging-test-source`
- `timeLeftUserId`: synthetic owner UID `stg-owner-uid-001`
- `sourceApp`: `staging_test_source`
- `sourceFirebaseProjectId`: `staging-source-proj-id`
- `sourceProjectIds`: `["staging-source-calendar-001"]`
- `status`: `active`
- `permissions.eventClasses`: `[
  "activity_boundary",
  "completed_activity",
  "location",
  "achievement",
  "project",
  "system"
]`
- token fields stored server-side only in `sourceConnectionSecrets/{connectionId}`:
  - `{tokenHash, tokenStatus: "active", tokenVersion:1, tokenCreatedAt}`
- No precise location.
- Stable IDs for idempotency checks:
  - `sourceEventId` values stable across replay, e.g. `stg-event-001`.
- Easy cleanup: fixture prefix fields and prefix-based batch delete scripts.

## 9) Deployment order and exact commands (staging only)
_Replace `<STAGING_PROJECT_ID>` with a dedicated staging ID (not yet available)._  
_Run pre-flight check before each deployment action._

```bash
# 0) Verify staging target exists and is selected-only by command
firebase deploy --project "$STAGING_PROJECT_ID" --only firestore:rules --dry-run

# 1) Deploy indexes first
firebase deploy --project "$STAGING_PROJECT_ID" --only firestore:indexes

# 2) Deploy Firestore rules
firebase deploy --project "$STAGING_PROJECT_ID" --only firestore:rules

# 3) Deploy ingestion + callable functions
firebase deploy --project "$STAGING_PROJECT_ID" --only functions:apiV1LifeEvents,functions:apiV1LifeEventsBatch,functions:ingestExternalDailyItem,functions:ingestExternalDailyItemsBatch,functions:createSourceIngestionToken,functions:revokeSourceIngestionToken,functions:cleanupLifeEventIngestionArtifacts

# 4) Deploy hosting rewrites that point to the ingested functions
npm run build
firebase deploy --project "$STAGING_PROJECT_ID" --only hosting
```

### Post-deploy smoke verification commands
- Confirm routing:
  - `curl -i -X POST https://<staging-host>/api/v1/life-events -d '{...}'`
  - `curl -i -X POST https://<staging-host>/api/v1/life-events:batch -d '{...}'`
- Replace `<staging-host>` with configured Hosting domain for `timelefttolive-staging`.

Future production command should be documented separately only after staging signoff:
- `firebase deploy --project <production-id> --only ...` (do not run now).

## 10) Staging smoke-test plan
- Public routes resolve:
  - `POST /api/v1/life-events` and `POST /api/v1/life-events:batch` return non-404 responses.
- Negative auth:
  - missing token -> 401
  - invalid token -> 401/403
- Happy path:
  - valid token creates one `lifeEvents` document under fixture calendar.
  - stored event `timeLeftUserId` resolves from `sourceConnections[connectionId].timeLeftUserId`.
  - stored event does not include bearer token.
- Idempotency:
  - same payload replay -> `duplicate: true` and same `lifeEventId`.
  - same idempotency identity changed content -> 409 + `idempotency_conflict`.
- Batch tests:
  - valid batch writes all valid entries.
  - batch with one invalid item returns `partial_success` and leaves valid entry.
- Security checks:
  - another authenticated user cannot read lifeEvents fixture doc.
  - client cannot direct-write lifeEvents.
  - client cannot read `rawIngestionPayloads` or `ingestionDeadLetters`.
- Legacy compatibility:
  - keep legacy endpoint calls and verify success remains.
- Cleanup:
  - call cleanup function status or scheduler state, no manual deletion of canonical event records.

## 11) Monitoring plan
- Track after deployment:
  - Function invocation counts/errors for six exported functions.
  - auth failures by route.
  - validation failures (400/413) and idempotent conflicts (409).
  - dead-letter insertions and raw audit writes per calendar.
  - cleanup function execution logs and deletions counts.
  - endpoint 4xx/5xx rates for staging domain, especially `/api/v1/life-events*`.
- Ensure logs do not include raw `Authorization` headers, bearer token values, or full precise payload location.

## 12) Rollback plan
- Immediate rollback options:
  - `functions:*` or subsets + `hosting` can be re-deployed with last-good version.
  - `firestore.rules` can be rolled back to previous rule set.
  - `firestore:indexes` index changes can be removed only with caution (rollback can be slow and impacts query performance).
- Keep legacy ingestion endpoints unchanged and do not touch them for rollback of Phase 1 scope.
- Do not delete legacy `lifeEvents` collections as a rollback step unless there is a known bad import.
- Do not use index deletion as first-line rollback; index metadata changes are harder to reverse and do not undo data corruption safely.
- Last known-good commit for this phase: `d316c0a`.

## 13) What must be created before staging deployment (explicit)
- Dedicated staging Firebase project (new project id not yet created/recorded): e.g., `timelefttolive-staging`.
- Host, Firestore, Auth, Functions, Scheduler in staging project.
- `.firebaserc` entry for staging alias and deployment scripts updated to deploy using that alias only.
- Separate staging token and connection fixtures in staging Firestore only.

## 14) Approval gate phrase
"I approve TimeLeftToLive Phase 1 staging deployment for **[Staging Project ID: <STAGING_PROJECT_ID>]** using Firebase Functions/Firestore/Hosting exactly as defined in this plan."
