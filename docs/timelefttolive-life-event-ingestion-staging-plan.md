# TimeLeftToLive Life-Event Phase 1 Staging Deployment Plan (Updated)

## 1) Repository status (2026-07-22)

- Working tree: clean.
- Branch: `main` at `1319e6a`.
- `origin/main`: matches local `main`.
- Required phase commits present locally and in origin:
  - `9c30158` (Phase 1 foundation)
  - `87d8d41` (hardening)
  - `191156b` (emulator verification)
  - `d316c0a` (verification updates)
  - `05a6cfa` (staging plan baseline)
  - `1319e6a` (ignore file)
- No production changes in this task.

## 2) Approved and disallowed projects

- Approved production project ID: `timelefttolive`.
- Approved staging project ID: `timelefttolive-stg-go`.
- Obsolete staging project: `timelefttolive-stg-marwan` (never use, never add to aliases).

## 3) Firebase aliases (`.firebaserc`)

Current alias file now:

- `default: timelefttolive`
- `production: timelefttolive`
- `staging: timelefttolive-stg-go`

The active project is still production through `default`.

## 4) Firestore location verification

Both projects were queried with:

- `firebase firestore:databases:get "(default)" --project timelefttolive`
- `firebase firestore:databases:get "(default)" --project timelefttolive-stg-go`

Result:

- production location: `nam5`
- staging location: `nam5`

## 5) Service readiness (read-only + repo evidence)

| Service | Status | Evidence / Note |
| --- | --- | --- |
| Firebase Billing / Blaze | Missing (cannot verify CLI without billing profile read scope) | Required for Cloud Functions outbound/network paths if any scale events exceed free quota |
| Cloud Functions | Ready (service exists in target project controls) | Region and deployability to be verified on deployment command execution |
| Firebase Hosting | Ready (service configuration exists) | Needs deploy to create phase-1 hosting rewrites for staging domain |
| Firebase Authentication | Missing (cannot fully verify without product admin access in output) | Required for user-aware UI and smoke test user sign-in |
| Cloud Scheduler | Missing (cannot fully verify from current scope) | Needed for scheduled cleanup |
| Pub/Sub | Missing (depends on Billing + Scheduler/Functions features) | Required by scheduled cleanup |
| Firestore indexes | Ready | `firestore.indexes.json` already contains required `lifeEvents` and `rawIngestionPayloads` indexes |
| Scheduled cleanup function | Not deployed yet (phase-1 target only, command prepared) | function exists in code as `cleanupLifeEventIngestionArtifacts` |
| Required Google Cloud APIs | Cannot verify automatically from current permission snapshot | Must be checked in Cloud/console before deployment |

Notes:
- If staging billing or service APIs are off, deployment may still be accepted but scheduled cleanup and user-facing operations can fail.
- All checks in this plan are ready/no-ready classification with explicit verification gaps above.

## 6) Functions region and routing analysis

- Current Functions region in code: `northamerica-northeast1` (via `functions/index.js`).
- Hosting rewrites now point:
  - `/api/v1/life-events` → `apiV1LifeEvents`
  - `/api/v1/life-events:batch` → `apiV1LifeEventsBatch`
- Function URLs for direct endpoint calls include region in the URL; hosting rewrites hide the region from client endpoints.

Existing compatibility:
- External direct regional function URL callers may still exist if they use function URL directly.
- Client traffic through Hosting rewrites does not expose region and is stable for the specified routes.

Impact notes:
- Legacy Functions are currently deployed from one region (`northamerica-northeast1`) and should remain there unless a separate migration is approved.

## 7) Region recommendation

Recommendation: **keep `northamerica-northeast1` temporarily** for the first staging release.

Rationale:
- Existing production and staging verification already target `northamerica-northeast1` and canonical rewrite paths.
- Migration to `us-central1` would require split-region configuration changes and rollback complexity.
- Immediate split plan increases operational risk and does not materially improve the Phase-1 scope.

## 8) Staging-safe frontend configuration

### Findings
- `.env` embeds production Firebase web app values.
- No staging-safe build mode existed.

### Changes made
- Added `.env.staging` for staging-safe mode loading.
- Added `build:staging` script.

`.env.staging`:
- Uses synthetic, non-production project target `timelefttolive-stg-go`.
- Other Firebase keys are intentionally placeholders until staging web app is registered.

### Staging verification
- Added `scripts/verify-staging-build.js`.
- `npm run build:staging` runs staging Vite build and verifies:
  - staging project id appears in built assets
  - production id does not appear in built assets
  - no plaintext secrets are printed

## 9) Fixture tooling

### Created commands
- Create: `npm run staging:fixture:create`
- Cleanup: `npm run staging:fixture:cleanup`

### Script behavior
- Target must be exactly `timelefttolive-stg-go`.
- Refuses:
  - missing project target
  - any `timelefttolive-stg-marwan`
  - any non-approved project
- Creates synthetic-only fixture values:
  - `calendarId: calendar-staging-fixture`
  - `sourceApp: staging_test_source`
  - synthetic `timeLeftUserId`
  - synthetic source connection/secret records
  - cryptographically random bearer token (stored only in `.staging-fixture-token`)
- `cleanup` deletes only synthetic records tied to fixture identifiers.

## 10) Smoke-test tooling

### Created command
- `npm run staging:smoke-test`

### Required checks prepared
- missing token rejected
- invalid token rejected
- valid token creates canonical LifeEvent
- `timeLeftUserId` resolved from source registry
- bearer token not persisted
- duplicate replay returns same `lifeEventId`
- conflict returns `idempotency_conflict`
- valid batch succeeds
- partial batch preserves valid items
- direct client writes denied
- second authenticated user cannot read synthetic event
- raw audit and dead letters denied to clients
- source connection secret denied
- legacy endpoint remains operational
- fixture cleanup removes synthetic staging records

### Notes
- Authenticated read/write client checks require user credentials + Firebase web API key at runtime.

## 11) Deployment command plan (staging-only, explicit project)

Use:

```bash
firebase deploy --project timelefttolive-stg-go --only firestore:indexes
firebase deploy --project timelefttolive-stg-go --only firestore:rules
firebase deploy --project timelefttolive-stg-go --only functions:apiV1LifeEvents,functions:apiV1LifeEventsBatch,functions:ingestExternalDailyItem,functions:ingestExternalDailyItemsBatch,functions:createSourceIngestionToken,functions:revokeSourceIngestionToken,functions:cleanupLifeEventIngestionArtifacts
firebase deploy --project timelefttolive-stg-go --only hosting
```

Do not run staging `--project` commands against any other project.

## 12) Deployment safety checks before run

- Read CLI help and confirm options for deployment command:
  - `firebase deploy --help`
- Verify aliases and project targets:
  - `firebase use`
  - `firebase projects:list`
- Firestore location check:
  - both databases must remain `nam5`

## 13) Rollback process

- Re-run `firebase deploy` with production alias for explicit rollback scope.
- Roll back functions first, then hosting rewrites if needed.
- Keep legacy endpoints for fallback:
  - `ingestExternalDailyItem`, `ingestExternalDailyItemsBatch`, token functions.
- No source data or fixture document deletion beyond synthetic fixture cleanup during rollback.

## 14) Remaining manual actions

- Register staging Firebase web app for `timelefttolive-stg-go` if not already done.
  - Exact command:
    `firebase apps:create web timelefttolive-stg-go <app-name> --project timelefttolive-stg-go`
  - then place generated config values in `.env.staging`.
- Confirm staging Billing/Blaze and required APIs if command output cannot confirm readiness.
- Provision/identify two non-production test users for smoke assertions.

## 15) Future Phase-1 staging deployment approval phrase

Use exactly:

`I approve TimeLeftToLive Phase 1 staging deployment for [Staging Project ID: timelefttolive-stg-go] using Firebase Functions/Firestore/Hosting exactly as defined in this plan.`
