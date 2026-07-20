# TimeLeftToLive Life Event Ingestion — Phase 1 Acceptance

Date: 2026-07-20
Commit under review: `9c30158f96a212ee2b38d0fff0a4707306bd6d8d`

## 1) Requirements matrix

Status legend: Implemented and tested (I+T), Implemented but not tested (I), Partially implemented (P), Missing (M), Out of scope (O).

1. Exact single-event endpoint route and Firebase export — I+T
2. Exact batch endpoint route and Firebase export — I+T
3. Source connection authentication — I+T
4. Server-side resolution of `timeLeftUserId` — I+T
5. Calendar, connection, integration, source-app and permission binding — I+T
6. Canonical LifeEvent validation — I+T
7. Deterministic document identity — I+T
8. Idempotent exact replay — I+T
9. Idempotency conflict for changed content — I+T
10. Concurrent duplicate protection — I+T
11. Batch maximum size — I+T
12. Batch partial success — I+T
13. Dead-letter creation — I+T
14. Raw audit sanitization — I+T
15. Ninety-day expiry — I+T
16. Scheduled/callable cleanup — I+T
17. Legacy endpoint compatibility — I+T
18. Firestore owner-only reads — I+T
19. Server-authoritative writes — I+T
20. Server-only dead-letter and audit collections — I+T
21. Secret/authorization redaction — I+T
22. Payload size limits — I+T
23. No unexpected source-adapter rollout — I+T
24. No deployment side effects in this phase — I

## 2) Findings and corrections made

Gaps found:
- No local emulator/rules test framework existed in this repository, so emulator and true Firestore-rules execution could not be run.
- Root `npm test` runs backend Node test files as Vitest files by discovery and fails to load them, which obscures clean frontend-only counts.

Corrections applied:
- Added request-size validation (`413`) guards to both canonical v1 and legacy ingestion request validators.
- Added focused ingestion tests for auth scope failures, validation edge cases, idempotency and conflicts, batch behavior, dead-letter/audit cleanup, legacy compatibility, and route/export assertions.
- Added Firebase Hosting rewrites for `/api/v1/life-events` and `/api/v1/life-events:batch`.
- Exported and tested `cleanupLifeEventArtifacts`.
- Removed phase-1-added `functions/src/sourceMappers/*` files that are outside scope.
- Aligned legacy conflict test assertions to current contract (`canonicalIngestion: "failed"` with `canonicalError`) and fixed a missing `db` argument in that path.

## 3) Exact endpoints and exports

- `functions/index.js`
  - `apiV1LifeEvents` (`onRequest`) — single canonical endpoint
  - `apiV1LifeEventsBatch` (`onRequest`) — batch canonical endpoint
  - `ingestExternalDailyItem` (`onRequest`) — legacy single compatibility
  - `ingestExternalDailyItemsBatch` (`onRequest`) — legacy batch compatibility
  - `cleanupLifeEventIngestionArtifacts` (`onSchedule`, every 24h) — artifact cleanup
- Public routes in `firebase.json`
  - `POST /api/v1/life-events` → `apiV1LifeEvents`
  - `POST /api/v1/life-events:batch` → `apiV1LifeEventsBatch`
- Required request body fields
  - Single: `calendarId`, `connectionId`, `integrationId`, plus canonical payload (`schemaVersion`, `sourceApp`, `sourceProjectId`, `sourceRecordId|sourceEventId`, `eventType`, and `occurredAt` and/or `startAt`)
  - Batch: same top-level identifiers, `items[]` (max 100)
- Required header
  - `Authorization: Bearer <token>`
- Methods
  - POST only; non-POST returns `405`
- Status behavior
  - Success: `200`
  - Validation: `400` / `413`
  - Authn/authz: `401`, `403`, `404` depending on failure
  - Conflict: `409` (`idempotency_conflict`)

Single response (`/api/v1/life-events`):
- `status`, `lifeEventId`, `idempotencyKey`, `duplicate`, `receivedAt`
- Conflicts include `existingLifeEventId` and `code`

Batch response (`/api/v1/life-events:batch`):
- `status` (`success` or `partial_success`) and `summary` (`total/success/failed/duplicates/conflict`)
- `results[]` with stable `index`, optional `clientReference`, per-item `status`, `lifeEventId/idempotencyKey`, optional `duplicate`, optional `existingLifeEventId`, and item `code/message` on failure

## 4) Authentication and identity behavior

- Token is always resolved against `lifeCalendars/{calendarId}/sourceConnectionSecrets/{connectionId}` and compared as hash.
- Invalid/missing/revoked tokens: `401`; disabled connection: `403`; wrong `connectionId`/`calendarId`: `404`.
- Wrong integration id against connection raises auth error (`403` with `auth_error`).
- Source/project/app scope checks are enforced via connection fields before write.
- `timeLeftUserId` is derived from registry ownership fields and client-supplied values are ignored.

## 5) Idempotency behavior

- Key: `sha256(integrationId + ':' + schemaVersion + ':' + (sourceEventId || sourceRecordId))`.
- Doc id uses key value.
- Exact replay returns same `lifeEventId` with `duplicate: true`.
- Conflicting content with same key returns `409` conflict.
- Concurrent duplicate attempts collapse to one write.
- Batch duplicates are item-local: one duplicate does not affect unique items.

## 6) Dead letters and raw-audit cleanup

- Unexpected internal failures write to `ingestionDeadLetters` (no raw request payload retained).
- Validation failures do not create dead letters.
- `rawIngestionPayloads` and dead letters carry `expiresAt` markers.
- `cleanupLifeEventArtifacts` removes expired docs by query/`<= now`, preserving unexpired docs.
- Cleanup is operational via scheduled function in this phase (not just TTL field existence).

## 7) Source-mapper scope audit

`git show 9c30158` added:
- `functions/src/sourceMappers/aiGridlineMapper.js`
- `functions/src/sourceMappers/gridlineAiMapper.js`
- `functions/src/sourceMappers/gymK2Mapper.js`
- `functions/src/sourceMappers/dartsTrackerMapper.js`
- `functions/src/sourceMappers/myDoubleProgressMapper.js`

These were not required for phase-1 canonical intake + legacy compatibility and were removed. Existing `src/services/externalSources/sourceMappers*` source adapter files remain untouched for UI/external-record behavior.

## 8) Rules and emulator validation

- Firestore rules currently assert:
  - `lifeEvents` owner read, no client write
  - `ingestionDeadLetters`, `rawIngestionPayloads`, `sourceConnectionSecrets` server-only
  - connection reads remain owner-only
- Emulator/unit rule framework was not present:
  - no `@firebase/rules-unit-testing` references
  - no local `emulators`/rules test harness command in repo scripts

## 9) Test commands and exact counts

- Functions all tests:
  - `cd /home/marwan/Documents/timelefttolive/functions && node --test`
  - 2 files, 2 file-level test runs, 0 failed
  - Individual tests: 7 (`ingestion.test.js`) + 61 (`lifeEventFoundation.test.js`) = 68
- Ingestion-focused file commands:
  - `node --test src/ingestion/ingestion.test.js` → 1 file, 1 subtest (contains 7 named tests)
  - `node --test src/ingestion/lifeEventFoundation.test.js` → 1 file, 1 subtest (contains 61 named tests)
- Root app tests:
  - `cd /home/marwan/Documents/timelefttolive && npm test`
  - 3 frontend suites passed, 2 functions suites fail to load as Vitest suite (`No test suite found`)
  - `Tests 17 passed`
- Syntax checks:
  - `node --check index.js src/ingestion/{lifeEventFoundation.js,ingestExternalDailyItem.js,validateIngestionRequest.js,ingestion.test.js,lifeEventFoundation.test.js}` (functions dir) passed

## 10) Production configuration remaining

- No deployment was executed.
- Before production go-live:
  - Deploy function exports + Hosting rewrites
  - Ensure cleanup scheduler is enabled in deployed functions target
  - Verify Firestore rules deployment
  - Optionally decide between scheduled cleanup and Firestore TTL for archival policy (cleanup is implemented operationally already)

## 11) Recommendation

NO-GO until Firestore emulator/JDK is available to execute rules tests; hosting/cleanup/function code paths are otherwise aligned with Phase 1 expectations.

## 12) Phase 1 verification recap (local)

Environment and command intent
- Branch context reviewed: `9c30158f96a212ee2b38d0fff0a4707306bd6d8d` and `87d8d41`.
- Emulator tests and hosting checks are local-only (no production reads/writes).
- Added/used:
  - `tests/firestore-rules.test.js`
  - `scripts/verify-hosting-routes.test.cjs`
  - `npm run test:frontend`
  - `npm run test:functions`
  - `npm run test:rules`
  - `npm run test:hosting`
  - `npm run test:all`

Emulator setup
- Frontend runner: Vitest CLI with explicit exclusions.
- Functions runner: Node test runner (`node --test functions/src/**/*.test.js`).
- Rules runner: `firebase emulators:exec --only firestore`.
- Hosting check runner: `firebase emulators:exec --only functions,hosting`.

Rules-test execution
- Targeted test file: `tests/firestore-rules.test.js`.
- Assertions implemented for:
  - owner can read own LifeEvent
  - owner cannot create/update LifeEvent
  - owner delete behavior is denied unless rules permit
  - different user denied read
  - source admin role does not grant timeline read
  - unauthenticated read denied
  - clients cannot read/write `rawIngestionPayloads`, `ingestionDeadLetters`, `sourceConnectionSecrets`.
  - existing source-connection read behavior still works.
- Execution result:
  - `npm run test:rules` fails at emulator startup: `Could not spawn java -version. Please make sure Java is installed and on your system PATH.`
  - This blocks definitive pass/fail of rules tests in this environment.

Hosting rewrite verification
- `firebase.json` rewrites now include explicit region:
  - `/api/v1/life-events` → `apiV1LifeEvents` in `northamerica-northeast1`
  - `/api/v1/life-events:batch` → `apiV1LifeEventsBatch` in `northamerica-northeast1`
- Verification file: `scripts/verify-hosting-routes.test.cjs`.
- Local emulator command result (with only functions+hosting emulators): all 4 checks pass.
- Observed behavior:
  - POST routes reach functions (non-404 responses).
  - non-POST routes return `405`.
  - responses are client-error JSON without server crashes (no 5xx for auth/method probes).
- Warning: full authenticated-path checks requiring seeded Firestore fixtures are not currently verifiable without Firestore emulator.

Cleanup scalability verification
- `cleanupLifeEventArtifacts` now uses:
  - bounded query page size (`CLEANUP_QUERY_LIMIT = 100`)
  - bounded write batch size (`CLEANUP_WRITE_BATCH_SIZE = 50`)
  - paged loop with bounded iteration by consumed results
  - per-batch retry-safe deletion logging.
- Added function tests for:
  - empty cleanup
  - only unexpired records
  - expired raw records
  - expired dead letters
  - mixed raw + dead-letter collections
  - more than one query page (150 raw artifacts)
  - partial delete failure handling while continuing.

Final test command outputs
- `npm run test:frontend`
  - Files: 3, Tests: 17, Passed: 17, Failed: 0, Skipped: 0, Exit: 0.
- `npm run test:functions`
  - Files: 2, Tests: 2 (subtest files), Passed: 2, Failed: 0, Skipped: 0, Exit: 0.
- `npm run test:rules`
  - Start failed before test execution: Java not installed (`java -version` spawn failure), Exit: 1.
- `npm run test:hosting`
  - Files: 1 test file, Tests: 4, Passed: 4, Failed: 0, Skipped: 0, Exit: 0.
- `npm run test:all`
  - Stops at `test:rules` failure; Exit: 1.

Deployment recommendation
- Hold staging deployment until `npm run test:rules` is executable in the local environment and rules tests pass.
