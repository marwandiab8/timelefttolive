#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPROVED_PROJECT_ID = 'timelefttolive-stg-go';
const FORBIDDEN_PROJECT_ID = 'timelefttolive-stg-marwan';
const FIXTURE_CALENDAR_ID = 'calendar-staging-fixture';
const FIXTURE_CONNECTION_ID = 'connection-staging-test-source';
const FIXTURE_INTEGRATION_ID = 'integration-staging-test-source';
const FIXTURE_OWNER_UID = 'staging-owner-fixture';
const FUNCTION_REGION = 'northamerica-northeast1';
const FIXTURE_TOKEN_FILE = '.staging-fixture-token';

function parseArgs(argv) {
  const options = {};
  for (const value of argv) {
    if (value.startsWith('--')) {
      const eq = value.indexOf('=');
      options[value.slice(2, eq === -1 ? undefined : eq)] = eq === -1 ? true : value.slice(eq + 1);
    }
  }
  return options;
}

function fail(message, details) {
  console.error(JSON.stringify({ status: 'error', message, ...(details ? { details } : {}) }));
  process.exit(1);
}

function assertProject(projectId) {
  if (!projectId) {
    fail('Missing --project argument.');
  }
  if (projectId === FORBIDDEN_PROJECT_ID) {
    fail('Refused obsolete staging project.', { forbiddenProjectId: FORBIDDEN_PROJECT_ID });
  }
  if (projectId !== APPROVED_PROJECT_ID) {
    fail('Refused unexpected project id.', { provided: projectId, expected: APPROVED_PROJECT_ID });
  }
}

function readFixture(filePath) {
  if (!existsSync(filePath)) {
    fail('Missing staging fixture token metadata file.', { filePath });
  }
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_error) {
    fail('Could not parse staging fixture token metadata file.', { filePath });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function buildCanonicalPayload(sourceRecordId, eventType = 'arrive_work') {
  return {
    calendarId: FIXTURE_CALENDAR_ID,
    connectionId: FIXTURE_CONNECTION_ID,
    integrationId: FIXTURE_INTEGRATION_ID,
    schemaVersion: 1,
    sourceApp: 'staging_test_source',
    sourceFirebaseProjectId: 'staging-source-project',
    sourceProjectId: 'staging-source-calendar-001',
    sourceRecordId,
    eventType,
    occurredAt: nowIso()
  };
}

function containsToken(obj, token) {
  if (obj === token) return true;
  if (obj === null || obj === undefined) return false;
  if (Array.isArray(obj)) {
    return obj.some((child) => containsToken(child, token));
  }
  if (typeof obj === 'object') {
    return Object.values(obj).some((child) => containsToken(child, token));
  }
  return false;
}

function assertStatus(actual, expectedSet, label) {
  if (!expectedSet.includes(actual)) {
    fail(`${label} failed.`, { expected: expectedSet.join(' or '), actual });
  }
}

async function callJson(url, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_error) {
    payload = { rawText: text };
  }
  return { status: response.status, payload, rawText: text, headers: response.headers };
}

async function signInForSmokeUser(apiKey, email, password) {
  if (!apiKey || !email || !password) {
    fail('Missing API key or user credentials for authenticated smoke checks.', {
      required: ['VITE_FIREBASE_API_KEY', 'TLTL_SMOKE_USER_EMAIL', 'TLTL_SMOKE_USER_PASSWORD', 'TLTL_SMOKE_SECOND_USER_EMAIL', 'TLTL_SMOKE_SECOND_USER_PASSWORD']
    });
  }

  const response = await callJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    body: {
      email,
      password,
      returnSecureToken: true
    }
  });

  if (response.status !== 200 || !response.payload?.idToken) {
    fail('Unable to sign in user for smoke assertions.', { email, payload: response.payload });
  }

  return response.payload.idToken;
}

async function firestoreGet(baseProject, userToken, path) {
  const url = `https://firestore.googleapis.com/v1/projects/${baseProject}/databases/(default)/documents/${path}`;
  return callJson(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${userToken}`
    }
  });
}

async function firestoreCreateDocument(baseProject, userToken, path, documentId, fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${baseProject}/databases/(default)/documents/${path}?documentId=${documentId}`;
  return callJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`
    },
    body: { fields }
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectId = options.project;
  const fixturePath = options['fixture-token-file'] || options.fixtureTokenFile || FIXTURE_TOKEN_FILE;
  const baseHost = options.host || `https://${APPROVED_PROJECT_ID}.web.app`;
  const functionBase = options.functionBase || `https://${FUNCTION_REGION}-${APPROVED_PROJECT_ID}.cloudfunctions.net`;
  const runCleanup = options.cleanup !== 'false';

  assertProject(projectId);

  const fixture = readFixture(fixturePath);
  if (fixture.projectId !== APPROVED_PROJECT_ID || fixture.calendarId !== FIXTURE_CALENDAR_ID) {
    fail('Fixture token metadata does not target approved staging project.', { fixture: fixturePath });
  }
  const fixtureToken = fixture.token;
  if (!fixtureToken || typeof fixtureToken !== 'string') {
    fail('Fixture token missing from metadata file. Re-run fixture create.', { fixturePath });
  }

  const apiKey = options.apiKey || process.env.VITE_FIREBASE_API_KEY;

  const app = initializeApp({ projectId });
  const db = getFirestore(app);

  const missing = await callJson(`${baseHost}/api/v1/life-events`, {
    method: 'POST',
    body: buildCanonicalPayload(`smoke-missing-${Date.now()}`)
  });
  assertStatus(missing.status, [401], 'Missing token must be rejected.');

  const invalid = await callJson(`${baseHost}/api/v1/life-events`, {
    method: 'POST',
    headers: { Authorization: 'Bearer bad-token' },
    body: buildCanonicalPayload(`smoke-invalid-${Date.now()}`)
  });
  assertStatus(invalid.status, [401, 403], 'Invalid token should be rejected.');

  const validPayloadId = `smoke-valid-${Date.now()}`;
  const validPayload = buildCanonicalPayload(validPayloadId);
  const valid = await callJson(`${baseHost}/api/v1/life-events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fixtureToken}` },
    body: validPayload
  });
  if (valid.status !== 200 || valid.payload.status !== 'success' || !valid.payload.lifeEventId) {
    fail('Valid token should create canonical event.', { response: valid.payload });
  }
  const lifeEventId = valid.payload.lifeEventId;

  const eventDoc = await db.collection('lifeCalendars').doc(FIXTURE_CALENDAR_ID).collection('lifeEvents').doc(lifeEventId).get();
  if (!eventDoc.exists) {
    fail('Created lifeEvent document is missing.');
  }
  const event = eventDoc.data() || {};
  if (event.timeLeftUserId !== FIXTURE_OWNER_UID) {
    fail('timeLeftUserId should be resolved from fixture source connection.', { actual: event.timeLeftUserId });
  }
  if (containsToken(event, fixtureToken)) {
    fail('Bearer token should not be persisted in canonical document.');
  }

  const replay = await callJson(`${baseHost}/api/v1/life-events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fixtureToken}` },
    body: structuredClone(validPayload)
  });
  if (replay.status !== 200 || replay.payload.duplicate !== true || replay.payload.lifeEventId !== lifeEventId) {
    fail('Replay should return duplicate=true and stable lifeEventId.', { response: replay.payload });
  }

  const conflict = await callJson(`${baseHost}/api/v1/life-events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fixtureToken}` },
    body: {
      ...validPayload,
      title: `changed-${randomBytes(4).toString('hex')}`
    }
  });
  if (conflict.status !== 409 || conflict.payload.code !== 'idempotency_conflict') {
    fail('Changed payload with same idempotency identity should return idempotency_conflict.', { response: conflict.payload });
  }

  const batch = await callJson(`${baseHost}/api/v1/life-events:batch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fixtureToken}` },
    body: {
      calendarId: FIXTURE_CALENDAR_ID,
      connectionId: FIXTURE_CONNECTION_ID,
      integrationId: FIXTURE_INTEGRATION_ID,
      items: [
        buildCanonicalPayload(`batch-valid-${Date.now()}`, 'arrive_work'),
        buildCanonicalPayload(`batch-valid-${Date.now()}b`, 'finish_work')
      ]
    }
  });
  if (batch.status !== 200 || batch.payload.status !== 'success') {
    fail('Valid batch should succeed.', { response: batch.payload });
  }

  const partial = await callJson(`${baseHost}/api/v1/life-events:batch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fixtureToken}` },
    body: {
      calendarId: FIXTURE_CALENDAR_ID,
      connectionId: FIXTURE_CONNECTION_ID,
      integrationId: FIXTURE_INTEGRATION_ID,
      items: [
        buildCanonicalPayload(`partial-valid-${Date.now()}`, 'arrive_work'),
        {
          calendarId: FIXTURE_CALENDAR_ID,
          connectionId: FIXTURE_CONNECTION_ID,
          integrationId: FIXTURE_INTEGRATION_ID,
          schemaVersion: 1,
          sourceApp: 'staging_test_source',
          sourceFirebaseProjectId: 'staging-source-project',
          sourceRecordId: `partial-missing-source-project-${Date.now()}`,
          eventType: 'arrive_work'
        }
      ]
    }
  });
  if (partial.status !== 200 || partial.payload.status !== 'partial_success') {
    fail('Partial batch should report partial_success and preserve valid items.', { response: partial.payload });
  }

  const ownerEmail = options.userEmail || process.env.TLTL_SMOKE_USER_EMAIL;
  const ownerPassword = options.userPassword || process.env.TLTL_SMOKE_USER_PASSWORD;
  const peerEmail = options.peerUserEmail || process.env.TLTL_SMOKE_SECOND_USER_EMAIL;
  const peerPassword = options.peerUserPassword || process.env.TLTL_SMOKE_SECOND_USER_PASSWORD;
  const ownerToken = await signInForSmokeUser(apiKey, ownerEmail, ownerPassword);
  const peerToken = await signInForSmokeUser(apiKey, peerEmail, peerPassword);

  const peerRead = await firestoreGet(projectId, peerToken, `lifeCalendars/${FIXTURE_CALENDAR_ID}/lifeEvents/${lifeEventId}`);
  assertStatus(peerRead.status, [403, 404], 'Another user should not read synthetic lifeEvent.');

  const rawRead = await firestoreGet(projectId, peerToken, `lifeCalendars/${FIXTURE_CALENDAR_ID}/rawIngestionPayloads/${lifeEventId}`);
  assertStatus(rawRead.status, [403, 404], 'Raw audit should be inaccessible to synthetic users.');

  const secretRead = await firestoreGet(projectId, peerToken, `lifeCalendars/${FIXTURE_CALENDAR_ID}/sourceConnectionSecrets/${FIXTURE_CONNECTION_ID}`);
  assertStatus(secretRead.status, [403, 404], 'Connection secret should be inaccessible to synthetic users.');

  const deadLetterId = `dl-${Date.now()}`;
  const deadRead = await firestoreGet(projectId, peerToken, `lifeCalendars/${FIXTURE_CALENDAR_ID}/ingestionDeadLetters/${deadLetterId}`);
  assertStatus(deadRead.status, [403, 404], 'Dead-letter doc should be inaccessible to synthetic users.');

  const writeAttempt = await firestoreCreateDocument(
    projectId,
    peerToken,
    `lifeCalendars/${FIXTURE_CALENDAR_ID}/lifeEvents`,
    `peer-write-${randomBytes(4).toString('hex')}`,
    {
      ownerUid: { stringValue: 'peer-inject' },
      eventType: { stringValue: 'arrive_work' }
    }
  );
  if (writeAttempt.status >= 200 && writeAttempt.status < 300) {
    fail('Authenticated users should not write LifeEvents directly.', { status: writeAttempt.status });
  }

  const legacyProbe = await callJson(`${functionBase}/ingestExternalDailyItem`, {
    method: 'POST',
    body: {
      calendarId: FIXTURE_CALENDAR_ID,
      connectionId: FIXTURE_CONNECTION_ID,
      integrationId: FIXTURE_INTEGRATION_ID,
      item: {
        sourceApp: 'aigridline',
        sourceFirebaseProjectId: 'project-id',
        sourceProjectId: 'project-a',
        title: 'legacy-probe'
      }
    }
  });
  assertStatus(legacyProbe.status, [401], 'Legacy endpoint should remain protected while operational.');

  const ingestionUrl = `${functionBase}/ingestExternalDailyItem`;
  if (functionBase && functionBase.includes('cloudfunctions.net')) {
    const response = await callJson(ingestionUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fixtureToken}` },
      body: {
        calendarId: FIXTURE_CALENDAR_ID,
        connectionId: FIXTURE_CONNECTION_ID,
        integrationId: FIXTURE_INTEGRATION_ID,
        item: {
          sourceApp: 'staging_test_source',
          sourceFirebaseProjectId: 'staging-source-project',
          sourceProjectId: 'staging-source-calendar-001',
          title: 'legacy-compatible',
          category: 'other'
        }
      }
    });
    if (response.status !== 200) {
      fail('Legacy endpoint should remain operational when valid credentials are supplied.', { response: response.payload });
    }
  }

  if (!runCleanup) {
    return;
  }

  const fixtureCleanup = spawnSync(process.execPath, ['scripts/staging-fixture.js', 'cleanup', `--project=${projectId}`, `--token-file=${fixturePath}`], {
    encoding: 'utf8'
  });

  if (fixtureCleanup.status !== 0) {
    fail('Fixture cleanup command failed inside smoke script.', {
      status: fixtureCleanup.status,
      stderr: fixtureCleanup.stderr,
      stdout: fixtureCleanup.stdout
    });
  }

  const remaining = await db.collection('lifeCalendars').doc(FIXTURE_CALENDAR_ID).collection('lifeEvents').where('integrationId', '==', FIXTURE_INTEGRATION_ID).get();
  if (!remaining.empty) {
    fail('Fixture cleanup should remove synthetic lifeEvents created during smoke run.', { remaining: remaining.size });
  }

  console.log(JSON.stringify({
    status: 'ok',
    project: projectId,
    checks: [
      'missing token rejected',
      'invalid token rejected',
      'canonical create/read path',
      'idempotent replay',
      'idempotency conflict',
      'batch success',
      'partial batch',
      'timeLeftUserId resolved',
      'token not persisted',
      'client write denied',
      'authenticated read denied',
      'legacy endpoint reachable'
    ]
  }));
}

main().catch((error) => {
  fail('smoke test failed', {
    message: error?.message || 'unknown',
    details: error?.stack || null
  });
});
