# TimeLeftToLive Life-Event Phase 1 Staging Deployment Plan (Deployment Status Updated)

## 1) Project configuration and separation

- Production: `timelefttolive`
- Approved staging: `timelefttolive-stg-go`
- Forbidden staging IDs: `timelefttolive-stg-marwan`, `timelefttolive-staging`, `timelefttolive-stg-nam5`, placeholders

## 2) Firestore verification (authoritative)

### Production
- Project: `timelefttolive`
- Database: `(default)`
- Location: `nam5`
- Edition: `STANDARD`
- Type: `FIRESTORE_NATIVE`

### Staging
- Project: `timelefttolive-stg-go`
- Database: `(default)`
- Location: `nam5`
- Edition: `STANDARD`
- Type: `FIRESTORE_NATIVE`

## 3) `.firebaserc` aliases

```json
{
  "projects": {
    "default": "timelefttolive",
    "production": "timelefttolive",
    "staging": "timelefttolive-stg-go"
  }
}
```

- Confirmed unchanged by this run.
- All explicit staging commands were run with `--project timelefttolive-stg-go`.

## 4) Owner-run verification evidence (outside Codex)

### Frontend
- Command: `npm run test:frontend`
- Files: `3`
- Tests: `17`
- Passed: `17`
- Failed: `0`
- Exit: `0`

### Functions
- Command: `npm run test:functions`
- Tests: `75`
- Passed: `75`
- Failed: `0`
- Exit: `0`

### Firestore rules
- Command: `npm run test:rules`
- Tests: `13`
- Passed: `13`
- Failed: `0`
- Exit: `0`

### Hosting + authenticated ingestion
- Command: `npm run test:hosting`
- Tests: `7`
- Passed: `7`
- Failed: `0`
- Exit: `0`

### Combined
- `npm run test:all` summary:
  - Frontend: `17/17`
  - Functions: `75/75`
  - Rules: `13/13`
  - Hosting: `7/7`
  - Total: `112`
  - Failed: `0`
  - Exit: `0`

## 5) Staging build safety

- Command: `npm run build:staging`
- Exit: `0`
- Embedded project: `timelefttolive-stg-go`
- Production project blocked: `true`
- Verification file: `scripts/verify-staging-build.js` reports `status: ok`

## 6) Codex sandbox limitation

- Emulator-port checks are not run in this sandbox.
- Internet/DNS instability in this environment prevents reliable direct staging endpoint probing from Codex.

## 7) Billing / Authentication / Scheduler / APIs

- Billing: not verifiable in this environment; `gcloud` is unavailable.
- Authentication: not fully verifiable in this run; smoke-test helper requires user credentials and fixture token.
- APIs / Scheduler: not verifiable fully in this run due missing `gcloud`.
- Required manual confirmations:
  - `gcloud billing projects describe timelefttolive-stg-go --format='value(billingEnabled)'`
  - confirm required APIs enabled:
    - `cloudfunctions.googleapis.com`, `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`, `run.googleapis.com`, `eventarc.googleapis.com`, `pubsub.googleapis.com`, `cloudscheduler.googleapis.com`, `firestore.googleapis.com`, `identitytoolkit.googleapis.com`
  - verify cleanup scheduler job exists for `cleanupLifeEventIngestionArtifacts`

## 8) Functions region and routing

- Current function region for LifeEvent/ingestion functions: `northamerica-northeast1`
- Hosting rewrites in use:
  - `/api/v1/life-events` → `apiV1LifeEvents`
  - `/api/v1/life-events:batch` → `apiV1LifeEventsBatch`
- `functions:list` shows:
  - `cleanupLifeEventIngestionArtifacts` with trigger `scheduled`
- Recommendation remains: keep `northamerica-northeast1` for first staging release.

## 9) Staging fixture and smoke execution this run

### Fixture
- Attempted command:
  - `node scripts/staging-fixture.js create --project=timelefttolive-stg-go --token-file=.staging-fixture-token`
- Result:
  - failed: `ERR_SYSTEM_ERROR: uv_interface_addresses returned Unknown system error 1`
- Also observed package-script argument parsing issue:
  - `npm run staging:fixture:create` passes spaced options and fails `Refused unexpected project id`.
  - documented command form uses `--project=<id> --token-file=<file>`.

### Smoke
- Attempted command:
  - `node scripts/staging-smoke-test.js --project=timelefttolive-stg-go --fixture-token-file=.staging-fixture-token --api-key=...`
- Result:
  - failed due missing fixture token file (fixture creation did not complete).
- Direct endpoint probes from Codex were inconsistent due DNS resolution failures for `timelefttolive-stg-go.web.app` and Cloud Run hostnames.

## 10) Deployment commands executed (staging, explicit project only)

- `firebase deploy --project timelefttolive-stg-go --only firestore:indexes`
  - first attempt failed on unnecessary single-field index:
    - `Error: this index is not necessary, configure using single field index controls`
  - `firestore.indexes.json` was corrected by removing `rawIngestionPayloads.expiresAt` single field index
  - redeploy succeeded.
- `firebase deploy --project timelefttolive-stg-go --only firestore:rules`
  - success
- `firebase deploy --project timelefttolive-stg-go --only functions:apiV1LifeEvents`
  - success (updated function)
- `firebase deploy --project timelefttolive-stg-go --only functions:apiV1LifeEventsBatch,functions:ingestExternalDailyItem,functions:ingestExternalDailyItemsBatch,functions:createSourceIngestionToken,functions:revokeSourceIngestionToken,functions:cleanupLifeEventIngestionArtifacts --force`
  - success (`✔ Deploy complete!`)
- `firebase deploy --project timelefttolive-stg-go --only hosting`
  - success (`✔ Deploy complete!`, URL: `https://timelefttolive-stg-go.web.app`)

## 11) Deployment scope and results

- Project: `timelefttolive-stg-go`
- Scope deployed:
  - `firestore:indexes`
  - `firestore:rules`
  - `functions:apiV1LifeEvents`
  - `functions:apiV1LifeEventsBatch`
  - `functions:ingestExternalDailyItem`
  - `functions:ingestExternalDailyItemsBatch`
  - `functions:createSourceIngestionToken`
  - `functions:revokeSourceIngestionToken`
  - `functions:cleanupLifeEventIngestionArtifacts`
  - `hosting`
- No deployment to production project occurred.

## 12) Rules/index status verification

- `firebase firestore:indexes --project timelefttolive-stg-go` returns staged indexes including `lifeEvents`, `events`, `externalItems`, `dailyEntries`; no `rawIngestionPayloads` single-field index entry remains in config.
- Firestore rules deployed successfully.

## 13) Smoke assertions still pending (manual follow-up)

- Missing token rejected
- Invalid token rejected
- Valid canonical write
- `timeLeftUserId` resolution from registry
- Plaintext bearer token non-persistence
- Exact replay returns same `lifeEventId` + `duplicate: true`
- Idempotency conflict with changed payload returns `409`
- Valid batch success
- Partial batch failure isolation
- Direct client LifeEvent writes denied
- Cross-user read denied for synthetic event
- Raw secret/audit/dead-letter read denied
- Legacy ingestion endpoint checks

## 14) Rollback commands

- `firebase deploy --project timelefttolive-stg-go --only hosting`
- `firebase deploy --project timelefttolive-stg-go --only functions:apiV1LifeEvents,functions:apiV1LifeEventsBatch,functions:ingestExternalDailyItem,functions:ingestExternalDailyItemsBatch,functions:createSourceIngestionToken,functions:revokeSourceIngestionToken,functions:cleanupLifeEventIngestionArtifacts`
- `firebase deploy --project timelefttolive-stg-go --only firestore:rules`
- `firebase deploy --project timelefttolive-stg-go --only firestore:indexes`

## 15) Repository and git status

- `git status --short`: `M firestore.indexes.json` and `M docs/timelefttolive-life-event-ingestion-staging-plan.md` (after this edit)
- `git log --oneline -10` top commits: `6c61b5a`, `9eab529`, `6a83025`, `a23d81c`, ...
- `git branch -vv`: `main` currently at `6c61b5a`
- `git rev-list --left-right --count origin/main...HEAD`: `0 4` at last checked fetch
- `git remote -v`: `origin https://github.com/marwandiab8/timelefttolive.git`
- `git fetch origin` currently fails in this sandbox with DNS resolution error to `github.com`.

## 16) Final deployment approval phrase

`I approve TimeLeftToLive Phase 1 staging deployment for [Staging Project ID: timelefttolive-stg-go] using Firebase Functions/Firestore/Hosting exactly as defined in this plan.`

## 17) Deployment outcome

- Current status: `STAGING DEPLOYMENT BLOCKED`
- Blocking conditions:
  1. Fixture and smoke automation cannot complete in this environment due missing authenticated token/credentials path and DNS instability.
  2. Billing/auth/API readiness still requires manual confirmation (`gcloud` unavailable in sandbox).
