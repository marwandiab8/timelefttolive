import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFixtureMetadata,
  makeBatchDeleteOps,
  cleanupIntegrationRecords,
  FIXTURE_INTEGRATION_IDS,
  shouldDeleteFixtureTokenFile
} from './staging-fixture.js';
import { buildLegacyPayload, buildTorontoDateOnlyPayload } from './staging-smoke-test.js';

function makeFakeBatch() {
  const deletions = [];
  return {
    batch() {
      const localDeletions = [];
      return {
        delete(ref) {
          localDeletions.push(ref);
        },
        commit: async () => {
          deletions.push(localDeletions.slice());
          return [];
        }
      };
    },
    deletions
  };
}

function makeCalendarRef() {
  const calls = [];
  const collection = (name) => {
    const where = (field, _op, value) => {
      calls.push({ collection: name, field, value });
      return {
        get: async () => ({
          size: 1,
          docs: [{ ref: `${name}-${field}-${value}-doc` }]
        })
      };
    };
    return { where };
  };
  return { collection, calls };
}

test('makeBatchDeleteOps accepts QuerySnapshot-like document input', async () => {
  const fakeDb = makeFakeBatch();
  const docs = {
    docs: [
      { ref: 'legacy-1' },
      { ref: 'legacy-2' }
    ]
  };
  await Promise.all(makeBatchDeleteOps(fakeDb, docs));
  assert.deepStrictEqual(fakeDb.deletions.flat(), ['legacy-1', 'legacy-2']);
});

test('makeBatchDeleteOps deletes from document array input', async () => {
  const fakeDb = makeFakeBatch();
  const docs = [
    { ref: 'canonical-1' },
    { ref: 'canonical-2' }
  ];
  await Promise.all(makeBatchDeleteOps(fakeDb, docs));
  assert.deepStrictEqual(fakeDb.deletions.flat(), ['canonical-1', 'canonical-2']);
});

test('makeBatchDeleteOps rejects malformed snapshot input', () => {
  const fakeDb = makeFakeBatch();
  assert.throws(() => makeBatchDeleteOps(fakeDb, { list: [{ ref: 'x' }] }), /makeBatchDeleteOps expected/);
});

test('fixture metadata carries legacy and canonical tokens', () => {
  const metadata = buildFixtureMetadata({
    token: 'canonical-token',
    tokenHash: 'canonical-hash',
    legacyToken: 'legacy-token',
    legacyTokenHash: 'legacy-hash'
  });

  assert.equal(metadata.token, 'canonical-token');
  assert.equal(metadata.legacyToken, 'legacy-token');
  assert.equal(metadata.tokenHash, 'canonical-hash');
  assert.equal(metadata.legacyTokenHash, 'legacy-hash');
  assert.equal(metadata.legacySourceApp, 'manual');
  assert.equal(metadata.legacyIntegrationId, 'integration-staging-legacy-test');
  assert.equal(metadata.legacySourceProjectId, 'staging-legacy-project-001');
  assert.equal(metadata.legacySourceFirebaseProjectId, 'staging-legacy-source-project');
});

test('legacy payload helper uses supported source app and dates', () => {
  const payload = buildLegacyPayload('legacy-record-123', 'legacy-check');
  assert.equal(payload.sourceApp, 'manual');
  assert.equal(payload.sourceFirebaseProjectId, 'staging-legacy-source-project');
  assert.equal(payload.sourceProjectId, 'staging-legacy-project-001');
  assert.equal(payload.sourceRecordId, 'legacy-record-123');
  assert.equal(payload.title, 'legacy-check');
  assert.equal(typeof payload.occurredAt, 'string');
  assert.equal(typeof payload.originalCreatedAt, 'string');
  assert.equal(typeof payload.dateId, 'string');
  assert.match(payload.dateId, /^\d{4}-\d{2}-\d{2}$/);
});

test('Toronto staging payload uses a date-only value and explicit IANA timezone', () => {
  const payload = buildTorontoDateOnlyPayload('toronto-date-only', '2026-03-08');
  assert.equal(payload.occurredAt, '2026-03-08');
  assert.equal(payload.timezone, 'America/Toronto');
  assert.equal(payload.sourceRecordId, 'toronto-date-only');
});

test('cleanup handles both fixture integration IDs', async () => {
  const fakeCalendar = makeCalendarRef();
  const fakeDb = makeFakeBatch();

  const results = await Promise.all(FIXTURE_INTEGRATION_IDS.map((integrationId) =>
    cleanupIntegrationRecords(fakeDb, fakeCalendar, integrationId)
  ));

  assert.equal(results.length, 2);
  assert.equal(fakeCalendar.calls.length, 6);
  assert.deepStrictEqual(
    results.map((summary) => summary.integrationId).sort(),
    [...FIXTURE_INTEGRATION_IDS].sort()
  );
  assert.equal(results.every((summary) => summary.lifeEvents === 1), true);
  assert.equal(results.every((summary) => summary.rawIngestionPayloads === 1), true);
  assert.equal(results.every((summary) => summary.ingestionDeadLetters === 1), true);
});

test('cleanup token metadata shape without legacy token is still safe for file deletion', () => {
  const oldShape = {
    projectId: 'timelefttolive-stg-go',
    calendarId: 'calendar-staging-fixture',
    connectionId: 'connection-staging-test-source',
    integrationId: 'integration-staging-test-source',
    token: 'legacy-era-token'
  };
  assert.equal(shouldDeleteFixtureTokenFile(oldShape), true);

  const wrongProject = {
    ...oldShape,
    projectId: 'not-approved'
  };
  assert.equal(shouldDeleteFixtureTokenFile(wrongProject), false);
});
