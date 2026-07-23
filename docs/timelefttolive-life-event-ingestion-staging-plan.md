# TimeLeftToLive Life-Event Phase 1 Staging Deployment Plan (Final Owner-Verified)

## 1) Project configuration and separation

- Approved production project: `timelefttolive`
- Approved staging project: `timelefttolive-stg-go`
- Obsolete staging project to never use: `timelefttolive-stg-marwan`
- Legacy placeholders to avoid: `timelefttolive-staging`, `timelefttolive-stg-nam5`

## 2) Firestore verification (authoritative)

- Production: `projects/timelefttolive/databases/(default)`
  - database: `(default)`
  - location: `nam5`
  - edition: `STANDARD`
  - type: `FIRESTORE_NATIVE`
- Staging: `projects/timelefttolive-stg-go/databases/(default)`
  - database: `(default)`
  - location: `nam5`
  - edition: `STANDARD`
  - type: `FIRESTORE_NATIVE`

## 3) Aliases (`.firebaserc`)

```json
{
  "projects": {
    "default": "timelefttolive",
    "production": "timelefttolive",
    "staging": "timelefttolive-stg-go"
  }
}
```

- Do not switch default/active project.
- All staging/production operations must use explicit staging target:
  - `--project timelefttolive-stg-go` or `--project staging`

## 4) Host-run functional verification evidence

Owner-run terminal (outside Codex) results:

### Frontend

- Command: `npm run test:frontend`
- Files: `3`
- Tests: `17`
- Passed: `17`
- Failed: `0`
- Skipped: `0`
- Exit: `0`

### Functions

- Command: `npm run test:functions`
- Files: not file-counted in this run (commit harness)
- Tests: `75`
- Passed: `75`
- Failed: `0`
- Skipped: `0`
- Exit: `0`

### Firestore rules

- Command: `npm run test:rules`
- Tests: `13`
- Passed: `13`
- Failed: `0`
- Skipped: `0`
- Exit: `0`
- Verified through real Firestore emulator scenarios:
  - owner reads own LifeEvent
  - owner cannot create/update/delete a LifeEvent directly
  - other user cannot read owner event
  - source-project admin role does not grant timeline read
  - unauthenticated cannot read LifeEvents
  - no client access to `rawIngestionPayloads`
  - no client access to `sourceConnectionSecrets`
  - no client access to `ingestionDeadLetters`
  - owner source-connection access remains valid

### Hosting + authenticated ingestion

- Command: `npm run test:hosting`
- Tests: `7`
- Passed: `7`
- Failed: `0`
- Skipped: `0`
- Exit: `0`
- Verified with Firestore + Functions + Hosting emulators:
  - single endpoint rewrite works
  - batch endpoint rewrite works
  - invalid methods return `405`
  - missing token rejected
  - invalid token rejected
  - valid token creates canonical LifeEvent
  - `timeLeftUserId` resolves from registry
  - canonical write contains no plaintext bearer token
  - exact replay returns same `lifeEventId`
  - replay returns `duplicate: true`
  - changed content under same identity returns `409`
  - idempotency conflict does not overwrite
  - valid batch succeeds
  - partial batch has independent item-level failure handling

### Full suite

- Command: `npm run test:all`
- Total passed: `112`
- Failed: `0`
- Exit: `0`
- Includes all sections: frontend (17), functions (75), rules (13), hosting (7)

## 5) Staging build safety

- Command: `npm run build:staging`
- Exit: `0`
- Embedded project ID in build: `timelefttolive-stg-go`
- Production project ID blocked from staging build: `true`
- Staging safety verification script passed.

## 6) Codex sandbox limitation

- Codex did not rerun emulator-based commands in this task.
- The sandbox cannot reliably bind local Firebase emulator ports for `test:rules`, `test:hosting`, or emulator-driven `test:all`.
- Evidence is therefore owner-run terminal execution only, not Codex execution.

## 7) Billing / Authentication / Scheduler / APIs (manual confirmations)

- Billing: `PASTE BILLING CONFIRMATION HERE`
- Firebase Authentication: `PASTE AUTHENTICATION CONFIRMATION HERE`
- Cloud Scheduler and required APIs: `PASTE API CONFIRMATION HERE`

## 8) Functions region and routing

- Current runtime region: `northamerica-northeast1`
- Hosting rewrites:
  - `/api/v1/life-events` → `apiV1LifeEvents`
  - `/api/v1/life-events:batch` → `apiV1LifeEventsBatch`
- Direct regional function URLs remain callable directly; Hosting rewrites keep canonical endpoints behind Hosting URLs.
- No region changes were made during this documentation task.
- Recommendation remains: keep `northamerica-northeast1` for first staging deployment unless production-verified compatibility concerns arise.

## 9) Fixture and smoke tooling

### Staging fixtures

- Command: `npm run staging:fixture:create`
- Command: `npm run staging:fixture:cleanup`
- Required behavior (per script implementation):
  - accepts only `timelefttolive-stg-go`
  - refuses `timelefttolive`
  - refuses `timelefttolive-stg-marwan`
  - generates synthetic fixture artifacts
  - writes token hash only into source secret document
  - stores token only in `.staging-fixture-token` (gitignored)
  - cleanup removes synthetic records for synthetic integration

### Staging smoke test

- Command: `npm run staging:smoke-test`
- Intended assertions:
  - missing token rejection
  - invalid token rejection
  - canonical creation
  - registry-resolved `timeLeftUserId`
  - token non-persistence
  - exact replay duplicate behavior
  - changed-content idempotency conflict
  - valid batch success
  - partial batch item independence
  - direct client write/read restrictions
  - legacy endpoint remains operational
  - fixture cleanup removes synthetic records after run

## 10) Dry-runs (staging-only deploy validation, no deploy)

- `firebase deploy --project timelefttolive-stg-go --dry-run --only firestore:indexes`
- `firebase deploy --project timelefttolive-stg-go --dry-run --only firestore:rules`
- `firebase deploy --project timelefttolive-stg-go --dry-run --only functions:apiV1LifeEvents,functions:apiV1LifeEventsBatch,functions:ingestExternalDailyItem,functions:ingestExternalDailyItemsBatch,functions:createSourceIngestionToken,functions:revokeSourceIngestionToken,functions:cleanupLifeEventIngestionArtifacts`
- `firebase deploy --project timelefttolive-stg-go --dry-run --only hosting`

## 11) Deployment scope and exact sequence

- Exact staging deployment scope:
  `timelefttolive-stg-go`
- Exact sequencing when approved:
  1. `firebase deploy --project timelefttolive-stg-go --only firestore:indexes`
  2. `firebase deploy --project timelefttolive-stg-go --only firestore:rules`
  3. `firebase deploy --project timelefttolive-stg-go --only functions:apiV1LifeEvents,functions:apiV1LifeEventsBatch,functions:ingestExternalDailyItem,functions:ingestExternalDailyItemsBatch,functions:createSourceIngestionToken,functions:revokeSourceIngestionToken,functions:cleanupLifeEventIngestionArtifacts`
  4. `firebase deploy --project timelefttolive-stg-go --only hosting`
- Do not deploy to `timelefttolive-stg-marwan`.

## 12) Rollback steps

Rollback scope (staging-only explicit):

1. `firebase deploy --project timelefttolive-stg-go --only hosting`
2. `firebase deploy --project timelefttolive-stg-go --only functions:apiV1LifeEvents,functions:apiV1LifeEventsBatch,functions:ingestExternalDailyItem,functions:ingestExternalDailyItemsBatch,functions:createSourceIngestionToken,functions:revokeSourceIngestionToken,functions:cleanupLifeEventIngestionArtifacts`
3. `firebase deploy --project timelefttolive-stg-go --only firestore:rules`
4. `firebase deploy --project timelefttolive-stg-go --only firestore:indexes`

## 13) Repository and push status (as requested)

- `git status --short` (non-emulator): clean
- `git log -10 --oneline`: latest history starts at
  - `docs: finalize TimeLeftToLive staging readiness` / etc. (full list in repository)
- `git branch -vv`: `main` on commit `9eab529` (and now updated below after this doc edit)
- `git rev-list --left-right --count origin/main...HEAD`:
  - local ahead indicator from this run: `0	3` (remote push check indicates local commits not yet fully pushed)
- `git remote -v`: origin points to `https://github.com/marwandiab8/timelefttolive.git`

## 14) Staging build and production separation controls

- Production/staging are separate and explicit:
  - prod: `timelefttolive`
  - staging: `timelefttolive-stg-go`
- Staging frontend validation blocks production config, and production project ID is explicitly rejected in staging build output.

## 15) Final deployment approval phrase

`I approve TimeLeftToLive Phase 1 staging deployment for [Staging Project ID: timelefttolive-stg-go] using Firebase Functions/Firestore/Hosting exactly as defined in this plan.`
