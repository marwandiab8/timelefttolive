#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const APPROVED_PROJECT_ID = 'timelefttolive-stg-go';
const FORBIDDEN_PROJECT_ID = 'timelefttolive-stg-marwan';
const FIXTURE_CALENDAR_ID = 'calendar-staging-fixture';
const FIXTURE_CONNECTION_ID = 'connection-staging-test-source';
const FIXTURE_INTEGRATION_ID = 'integration-staging-test-source';
const DEFAULT_TOKEN_FILE = '.staging-fixture-token';

const ALLOWED_EVENT_CLASSES = [
  'activity_boundary',
  'completed_activity',
  'location',
  'achievement',
  'project',
  'system'
];

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function generateToken() {
  return `tltl_stg_${randomBytes(32).toString('base64url')}`;
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [key, ...rest] = arg.slice(2).split('=');
    options[key] = rest.length ? rest.join('=') : true;
  }
  return { positional, options };
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

function readFixtureToken(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (_error) {
    return null;
  }
}

function writeFixtureToken(filePath, payload) {
  const dir = dirname(filePath);
  if (dir && dir !== '.') {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

function makeBatchDeleteOps(db, docs) {
  const chunks = [];
  const all = docs.map((doc) => doc.ref);
  for (let i = 0; i < all.length; i += 500) {
    chunks.push(all.slice(i, i + 500));
  }
  return chunks.map((chunk) => {
    const batch = db.batch();
    for (const ref of chunk) {
      batch.delete(ref);
    }
    return batch.commit();
  });
}

async function createFixture(db, tokenPath) {
  const token = generateToken();
  const tokenHash = sha256(token);
  const tokenLastFour = token.slice(-4);

  const calendarRef = db.collection('lifeCalendars').doc(FIXTURE_CALENDAR_ID);
  const connectionRef = calendarRef.collection('sourceConnections').doc(FIXTURE_CONNECTION_ID);
  const secretRef = calendarRef.collection('sourceConnectionSecrets').doc(FIXTURE_CONNECTION_ID);

  await calendarRef.set({
    ownerUid: 'staging-owner-fixture',
    synthetic: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await connectionRef.set({
    status: 'active',
    sourceApp: 'staging_test_source',
    sourceFirebaseProjectId: 'staging-source-project',
    sourceProjectIds: ['staging-source-calendar-001'],
    permissions: {
      eventClasses: ALLOWED_EVENT_CLASSES
    },
    integrationId: FIXTURE_INTEGRATION_ID,
    timeLeftUserId: 'staging-owner-fixture',
    tokenStatus: 'active',
    tokenVersion: 1,
    tokenLastFour,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await secretRef.set({
    tokenHash,
    tokenVersion: 1,
    tokenStatus: 'active',
    tokenCreatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  const payload = {
    projectId: APPROVED_PROJECT_ID,
    calendarId: FIXTURE_CALENDAR_ID,
    connectionId: FIXTURE_CONNECTION_ID,
    integrationId: FIXTURE_INTEGRATION_ID,
    sourceApp: 'staging_test_source',
    token,
    tokenHash,
    createdAt: new Date().toISOString()
  };

  writeFixtureToken(tokenPath, payload);

  console.log(JSON.stringify({
    status: 'created',
    targetProject: APPROVED_PROJECT_ID,
    calendarId: FIXTURE_CALENDAR_ID,
    connectionId: FIXTURE_CONNECTION_ID,
    integrationId: FIXTURE_INTEGRATION_ID,
    tokenFile: tokenPath,
    note: 'Plaintext token is stored only in token file.'
  }));
}

async function cleanupFixture(db, tokenPath) {
  const calendarRef = db.collection('lifeCalendars').doc(FIXTURE_CALENDAR_ID);
  const connectionRef = calendarRef.collection('sourceConnections').doc(FIXTURE_CONNECTION_ID);
  const secretRef = calendarRef.collection('sourceConnectionSecrets').doc(FIXTURE_CONNECTION_ID);

  const [events, rawPayloads, deadLetters] = await Promise.all([
    calendarRef.collection('lifeEvents').where('integrationId', '==', FIXTURE_INTEGRATION_ID).get(),
    calendarRef.collection('rawIngestionPayloads').where('integrationId', '==', FIXTURE_INTEGRATION_ID).get(),
    calendarRef.collection('ingestionDeadLetters').where('integrationId', '==', FIXTURE_INTEGRATION_ID).get()
  ]);

  const deleteOps = [];
  deleteOps.push(...makeBatchDeleteOps(db, events));
  deleteOps.push(...makeBatchDeleteOps(db, rawPayloads));
  deleteOps.push(...makeBatchDeleteOps(db, deadLetters));

  await Promise.all(deleteOps);
  await Promise.all([connectionRef.delete(), secretRef.delete()]);

  if (existsSync(tokenPath)) {
    const tokenMeta = readFixtureToken(tokenPath);
    if (!tokenMeta || tokenMeta.projectId === APPROVED_PROJECT_ID) {
      rmSync(tokenPath);
    }
  }

  console.log(JSON.stringify({
    status: 'cleanup-complete',
    targetProject: APPROVED_PROJECT_ID,
    calendarId: FIXTURE_CALENDAR_ID,
    connectionId: FIXTURE_CONNECTION_ID,
    deleted: {
      lifeEvents: events.size,
      rawIngestionPayloads: rawPayloads.size,
      ingestionDeadLetters: deadLetters.size
    }
  }));
}

function usage() {
  console.log(JSON.stringify({
    usage: 'node scripts/staging-fixture.js <create|cleanup> --project timelefttolive-stg-go --token-file .staging-fixture-token'
  }));
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  const projectId = options.project;

  if (!command || !['create', 'cleanup'].includes(command)) {
    usage();
    fail('Missing or invalid command.', { command: command || null });
  }

  assertProject(projectId);

  const tokenPath = options['token-file'] || options.tokenFile || DEFAULT_TOKEN_FILE;
  const app = initializeApp({ projectId });
  const db = getFirestore(app);

  console.log(JSON.stringify({
    status: 'target',
    command,
    targetProject: projectId,
    calendarId: FIXTURE_CALENDAR_ID,
    connectionId: FIXTURE_CONNECTION_ID,
    integrationId: FIXTURE_INTEGRATION_ID
  }));

  if (command === 'create') {
    await createFixture(db, tokenPath);
    return;
  }

  await cleanupFixture(db, tokenPath);
}

main().catch((error) => {
  fail('staging fixture command failed.', {
    message: error?.message || 'unknown',
    code: error?.code || null
  });
});
