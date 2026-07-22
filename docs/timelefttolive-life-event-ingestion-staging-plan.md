# TimeLeftToLive Life-Event Phase 1 Staging Deployment Plan (Host-verified)

## 1) Repository status (2026-07-22)

- Working tree: clean.
- Branch: `main` at `4fe4e61`.
- `origin/main`: matches local `main`.
- Required phase commits present locally and in origin:
  - `9c30158` (Phase 1 foundation)
  - `87d8d41` (hardening)
  - `191156b` (emulator verification)
  - `d316c0a` (verification updates)
  - `05a6cfa` (staging plan baseline)
  - `1319e6a` (ignore file)
  - `4fe4e61` (staging bootstrap and safety tooling)
- No production changes in this task.

## 1.1) Host verification run (authoritative)

Executed from host machine after clearing stale emulator process from `~/Documents/timelefttolive`:

- `npm run test:rules` → exit `0`
- `npm run test:hosting` → exit `0`
- `npm run test:all` → exit `0`
- `npm run build:staging` → exit `0`
- `npm run test:staging-build` → exit `0`

Prior failing results in Codex sandbox were due to stale Firestore emulator/port conflicts and are not indicative of repository readiness.

## 2) Approved and disallowed projects

- Approved production project ID: `timelefttolive`.
- Approved staging project ID: `timelefttolive-stg-go`.
- Obsolete staging project: `timelefttolive-stg-marwan` (never use, never add to aliases).

## 3) Firebase aliases (`.firebaserc`)

Current alias file now:

- `default: timelefttolive`
- `production: timelefttolive`
- `staging: timelefttolive-stg-go`

The active project remains production via `default`.

## 4) Firestore location verification

Verified with:

- `firebase firestore:databases:get "(default)" --project timelefttolive`
- `firebase firestore:databases:get "(default)" --project timelefttolive-stg-go`

Result:

- production: `nam5`
- staging: `nam5`

## 5) Service readiness

| Service | Status | Evidence |
| --- | --- | --- |
| Blaze Billing | Confirmed enabled | Manual prerequisite: `Blaze billing: ENABLED`
| Cloud Functions | Ready | Project is staging-enabled and deploy target is explicit `timelefttolive-stg-go`.
| Firebase Hosting | Ready | Hosting configuration and rewrite paths are in repo; dry-run path prepared.
| Firebase Authentication | Confirmed initialized | Manual prerequisite: `Firebase Authentication: INITIALIZED` and provider enabled.
| Cloud Scheduler | Required for cleanup schedule | Included in staging deployment readiness assumptions from enabled platform controls.
| Pub/Sub | Required for scheduled cleanup trigger path | Included in staging deployment readiness assumptions from enabled platform controls.
| Firestore indexes | Ready to deploy | Index/rule deploy commands prepared and staging is clean.
| Scheduled cleanup function | Ready | `cleanupLifeEventIngestionArtifacts` present in `functions/index.js` and covered by smoke assertions.

## 6) Functions region and routing analysis

- Current region in code: `northamerica-northeast1`.
- Hosting rewrites:
  - `/api/v1/life-events` → `apiV1LifeEvents`
  - `/api/v1/life-events:batch` → `apiV1LifeEventsBatch`
- Direct regional function URLs are still externally available by default when using function URL directly; Hosting routes still hide region for client-facing endpoints.

### Recommendation

Keep `northamerica-northeast1` for the first staging release.

## 7) Staging-safe frontend configuration

- `.env.staging` is configured to staging project values:
  - `timelefttolive-stg-go`
  - `1:976180981554:web:e1e224f9d38c377340712b`
  - `timelefttolive-stg-go.firebaseapp.com`
  - `timelefttolive-stg-go.firebasestorage.app`
  - `976180981554`
- Production frontend values remain in `.env`/default mode.
- `npm run build:staging` and `npm run test:staging-build` both validate staging targeting and block production project ID leakage.
- No private credentials or tokens were added to frontend files.

## 8) Fixture tooling

### Scripts

- `npm run staging:fixture:create`
- `npm run staging:fixture:cleanup`

### Guard behavior (required)

- Refuses `timelefttolive`.
- Refuses `timelefttolive-stg-marwan`.
- Accepts only `timelefttolive-stg-go`.
- Generates synthetic fixture token and stores metadata only in `.staging-fixture-token` (gitignored).
- Does not log token plaintext.
- Cleanup only removes synthetic fixture records and deletes token file metadata for this project.

## 9) Smoke-test tooling

### Script

- `npm run staging:smoke-test`

### Guard behavior (required)

- Refuses `timelefttolive`.
- Refuses `timelefttolive-stg-marwan`.
- Requires exact `timelefttolive-stg-go`.
- Uses `.staging-fixture-token` fixture metadata and avoids printing/logging bearer token strings.
- Performs direct writes/read-denial checks and fixture cleanup at end.

## 10) Host dry-runs (authoritative)

Dry-run command order and outcomes (per host run):

1. `firebase deploy --project timelefttolive-stg-go --dry-run --only firestore:indexes`
2. `firebase deploy --project timelefttolive-stg-go --dry-run --only firestore:rules`
3. `firebase deploy --project timelefttolive-stg-go --dry-run --only functions:apiV1LifeEvents,functions:apiV1LifeEventsBatch,functions:ingestExternalDailyItem,functions:ingestExternalDailyItemsBatch,functions:createSourceIngestionToken,functions:revokeSourceIngestionToken,functions:cleanupLifeEventIngestionArtifacts`
4. `firebase deploy --project timelefttolive-stg-go --dry-run --only hosting`

Outcome placeholders from host run:

- Firestore indexes: `[PASTE RESULT]`
- Firestore rules: `[PASTE RESULT]`
- Phase 1 Functions: `[PASTE RESULT]`
- Hosting: `[PASTE RESULT]`

## 11) Final staging deployment command order

1. `firebase deploy --project timelefttolive-stg-go --only firestore:indexes`
2. `firebase deploy --project timelefttolive-stg-go --only firestore:rules`
3. `firebase deploy --project timelefttolive-stg-go --only functions:apiV1LifeEvents,functions:apiV1LifeEventsBatch,functions:ingestExternalDailyItem,functions:ingestExternalDailyItemsBatch,functions:createSourceIngestionToken,functions:revokeSourceIngestionToken,functions:cleanupLifeEventIngestionArtifacts`
4. `firebase deploy --project timelefttolive-stg-go --only hosting`

## 12) Deployment safety and rollback process

- Confirm `firebase deploy --help` once before execution.
- Verify that every command uses explicit `--project timelefttolive-stg-go`.
- Rollback uses the same explicit project scope with reverse order and feature-scope narrowing.
- No data migration or production fixture writes are performed in this task.

## 13) Blaze and Authentication confirmation

- Blaze Billing: `ENABLED`.
- Firebase Authentication: `INITIALIZED`.
- Required sign-in provider: `ENABLED`.
- No production data, bearer tokens, or private credentials were copied into staging artifacts.

## 14) Sandbox caveat (historical)

- Earlier emulator failures in Codex sandbox were due to stale emulator process/port conflict, not application test logic.
- After host cleanup and rerun, all requested checks passed.

## 15) Future phase-1 staging deployment approval phrase

Use exactly:

`I approve TimeLeftToLive Phase 1 staging deployment for [Staging Project ID: timelefttolive-stg-go] using Firebase Functions/Firestore/Hosting exactly as defined in this plan.`
