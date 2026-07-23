# TimeLeftToLive Life-Event Phase 1 Staging Deployment Plan (Recovered)

## 1) Repository status (2026-07-23)

- Working tree: clean (`git status --short`, `git diff`, `git diff --stat`, `git diff --cached` are empty).
- Branch: `main` at `6a83025`.
- `origin/main` is behind status: `0 2` from `git rev-list --left-right --count origin/main...HEAD` (local is ahead by 2 commits).
- Required phase commits present locally:
  - `9c30158` (Phase 1 foundation)
  - `87d8d41` (hardening)
  - `191156b` (emulator verification)
  - `d316c0a` (verification updates)
  - `05a6cfa` (staging plan baseline)
  - `1319e6a` (ignore file)
  - `4fe4e61` (staging bootstrap and safety tooling)
  - `a23d81c` (staging readiness doc updates)
  - `6a83025` (staging dry-run results)

## 2) Approved and disallowed projects

- Approved production project ID: `timelefttolive`.
- Approved staging project ID: `timelefttolive-stg-go`.
- Obsolete staging project: `timelefttolive-stg-marwan` (never use, never add to aliases).
- Legacy placeholders `timelefttolive-staging` and `timelefttolive-stg-nam5` are not used and must remain unsupported.

## 3) Firebase aliases (`.firebaserc`)

Current aliases are correct and unchanged:

- `default: timelefttolive`
- `production: timelefttolive`
- `staging: timelefttolive-stg-go`

Do not switch default/active project.

## 4) Firestore location verification

- Executed:
  - `firebase firestore:databases:get "(default)" --project timelefttolive`
  - `firebase firestore:databases:get "(default)" --project timelefttolive-stg-go`
- `firebase firestore:databases:list --project timelefttolive` (failed with request error in this environment)
- `firebase firestore:databases:list --project timelefttolive-stg-go` (failed with request error in this environment)

Observed:
- Production: `(default)`, `FIRESTORE_NATIVE`, `STANDARD`, `nam5`
- Staging: `(default)`, `FIRESTORE_NATIVE`, `STANDARD`, `nam5`

If this changes, recover and stop staging deployment checks:
- `NOT READY FOR STAGING DEPLOYMENT` when `nam5` is not confirmed for staging default.

## 5) Service and API readiness (classification)

| Service / readiness check | Status | Evidence |
| --- | --- | --- |
| Blaze Billing | cannot verify from CLI | Billing check not available without Cloud Billing tooling in this environment. |
| Firestore | ready | Verified `(default)` DB config in both projects. |
| Firebase Authentication | manual console action required | No direct auth verification executed in this environment. |
| Firebase Hosting | ready | `hosting:sites:list` shows `timelefttolive-stg-go.web.app`. |
| Cloud Functions | ready | Required exports exist; functions deploy dry-run succeeded. |
| Cloud Scheduler | manual console action required | Required for scheduled cleanup; not independently verified here. |
| Required APIs | likely ready | Deploy dry-runs triggered API preflight for firestore/functions/cloudbuild/artifactregistry/cloudscheduler/run/eventarc/pubsub/storage. |
| Deployment permissions | ready (CLI-side) | Deploy dry-runs reached completion without authz error for staged scope. |

## 6) Functions-region audit

- Current region is `northamerica-northeast1` in:
  - `functions/index.js`
  - `firebase.json` rewrites
- Legacy functions in this phase (LifeEvent/API/security functions) are already on `northamerica-northeast1`.
- Client entrypoint for canonical endpoints uses Hosting rewrites:
  - `/api/v1/life-events` → `apiV1LifeEvents`
  - `/api/v1/life-events:batch` → `apiV1LifeEventsBatch`
- Direct regional function URLs are still callable directly when using function URLs; Hosting rewrites hide region for browser API paths.
- Given Firestore in `nam5` and current production/staging coupling, keep `northamerica-northeast1` for first staging deployment.
- No code region changes were made in this recovery step.

## 7) Staging frontend isolation

- `.env.staging` values are explicitly scoped to:
  - `timelefttolive-stg-go`
  - `timelefttolive-stg-go.firebaseapp.com`
  - `timelefttolive-stg-go.firebasestorage.app`
  - `1:976180981554:web:e1e224f9d38c377340712b`
  - `976180981554`
- `npm run build:staging` and `scripts/verify-staging-build.js` enforce:
  - staging project ID present in build output
  - production project ID not present
- No secrets, server credentials, or raw token values are embedded in build output.

## 8) Fixture tooling

- Commands:
  - `staging:fixture:create`
  - `staging:fixture:cleanup`
- Safety checks in `scripts/staging-fixture.js`:
  - requires `--project timelefttolive-stg-go`
  - refuses `timelefttolive`
  - refuses `timelefttolive-stg-marwan`
- Fixture behavior:
  - creates synthetic fixture calendar (`calendar-staging-fixture`) and source connection (`connection-staging-test-source`)
  - uses source app `staging_test_source`
  - writes only token hash to `sourceConnectionSecrets`
  - writes bearer token in gitignored `.staging-fixture-token` only
  - uses synthetic token owner/calendar identifiers
  - supports cleanup of synthetic `lifeEvents`, `rawIngestionPayloads`, and `ingestionDeadLetters` for `integration-staging-test-source`
  - exits non-zero on validation failures

## 9) Smoke-test tooling

- Command:
  - `npm run staging:smoke-test --project timelefttolive-stg-go --fixture-token-file .staging-fixture-token`
- Required checks implemented in script:
  - missing token rejection
  - invalid token rejection
  - valid canonical creation
  - idempotent replay + stable id
  - idempotency conflict on changed payload
  - batch success
  - partial batch independent failure reporting
  - direct client writes denied for `lifeEvents`
  - cross-user read denied for canonical and server-only collections
  - legacy endpoint remains operational with a valid token
  - fixture cleanup invoked at end (when enabled by default)
- Smoke script has not been executed in this recovery pass because emulator-host port restrictions caused staging smoke dependencies to fail.

## 10) Dry-runs (staging-only, `--dry-run`)

Executed with explicit project scope:

- `firebase deploy --project timelefttolive-stg-go --dry-run --only firestore:indexes` → exit `0`
- `firebase deploy --project timelefttolive-stg-go --dry-run --only firestore:rules` → exit `0`
- `firebase deploy --project timelefttolive-stg-go --dry-run --only functions:apiV1LifeEvents,functions:apiV1LifeEventsBatch,functions:ingestExternalDailyItem,functions:ingestExternalDailyItemsBatch,functions:createSourceIngestionToken,functions:revokeSourceIngestionToken,functions:cleanupLifeEventIngestionArtifacts` → exit `0`
- `firebase deploy --project timelefttolive-stg-go --dry-run --only hosting` → exit `0`

## 11) Local verification

- `java -version` → OpenJDK `21.0.11`
- `npx firebase --version` → `15.24.0`
- `npm run test:frontend` → `0`
- `npm run test:functions` → `0`
- `npm run test:rules` → `1` (emulator ports unavailable in sandbox)
- `npm run test:hosting` → `1` (emulator ports unavailable in sandbox)
- `npm run test:all` → `1` (inherits `rules`/`hosting` failures)
- `npm run build:staging` → `0` (build + staging verify script passed)

## 12) Deployment scope and sequencing

Use explicit project scope in every command:
- `--project timelefttolive-stg-go`
- or `--project staging` with matching alias mapping.

Staging scope order if continuing:

1. `firebase deploy --project timelefttolive-stg-go --only firestore:indexes`
2. `firebase deploy --project timelefttolive-stg-go --only firestore:rules`
3. `firebase deploy --project timelefttolive-stg-go --only functions:apiV1LifeEvents,functions:apiV1LifeEventsBatch,functions:ingestExternalDailyItem,functions:ingestExternalDailyItemsBatch,functions:createSourceIngestionToken,functions:revokeSourceIngestionToken,functions:cleanupLifeEventIngestionArtifacts`
4. `firebase deploy --project timelefttolive-stg-go --only hosting`

## 13) Rollback and blocker notes

- Rollback, if needed, should mirror the same explicit staging scope in reverse function order.
- Do not switch to old staging project `timelefttolive-stg-marwan`.
- Remove generated logs/temporary artifacts only when safe.
- `firestore-debug.log` should be removed when present (no source content).

## 14) Readiness outcome for this recovery

Current result: `NOT READY FOR STAGING DEPLOYMENT`

Blocking reasons (environment-specific):
- local `test:rules`, `test:hosting`, and `test:all` do not complete due emulator port restrictions.

## 15) Exact deployment approval phrase

`I approve TimeLeftToLive Phase 1 staging deployment for [Staging Project ID: timelefttolive-stg-go] using Firebase Functions/Firestore/Hosting exactly as defined in this plan.`

## 16) Manual remaining actions

- Re-run `npm run test:rules` and `npm run test:hosting` in an environment with emulator ports available.
- Confirm Blaze Billing and Firebase Authentication are enabled in the staging project.
- Confirm Cloud Scheduler is enabled for staged cleanup execution.
- Re-run `firebase deploy` sequence above only after all checks are green.
