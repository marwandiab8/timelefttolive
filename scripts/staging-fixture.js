#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const APPROVED_PROJECT_ID = 'timelefttolive-stg-go';
const FORBIDDEN_PROJECT_ID = 'timelefttolive-stg-marwan';
const FIXTURE_CALENDAR_ID = 'calendar-staging-fixture';
const FIXTURE_CONNECTION_ID = 'connection-staging-test-source';
const FIXTURE_INTEGRATION_ID = 'integration-staging-test-source';
const FIXTURE_LEGACY_CONNECTION_ID = 'connection-staging-legacy-test';
const FIXTURE_LEGACY_INTEGRATION_ID = 'integration-staging-legacy-test';
const DEFAULT_TOKEN_FILE = '.staging-fixture-token';
const FIXTURE_SOURCE_PROJECT_ID = 'staging-source-calendar-001';
const FIXTURE_SOURCE_FIREBASE_PROJECT_ID = 'staging-source-project';
const FIXTURE_LEGACY_SOURCE_PROJECT_ID = 'staging-legacy-project-001';
const FIXTURE_LEGACY_SOURCE_FIREBASE_PROJECT_ID = 'staging-legacy-source-project';
const FIXTURE_OWNER_UID = 'staging-owner-fixture';
const FIXTURE_PEER_UID = 'staging-peer-fixture';

const ALLOWED_EVENT_CLASSES = [
  'activity_boundary',
  'completed_activity',
  'location',
  'achievement',
  'project',
  'system'
];

const FIXTURE_INTEGRATION_IDS = [FIXTURE_INTEGRATION_ID, FIXTURE_LEGACY_INTEGRATION_ID];
const FIXTURE_CONNECTION_IDS = [FIXTURE_CONNECTION_ID, FIXTURE_LEGACY_CONNECTION_ID];

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function generateToken() {
  return `tltl_stg_${randomBytes(32).toString('base64url')}`;
}

function buildFixtureMetadata({
  token,
  tokenHash,
  legacyToken,
  legacyTokenHash,
  smokeUsers
}) {
  return {
    projectId: APPROVED_PROJECT_ID,
    calendarId: FIXTURE_CALENDAR_ID,
    connectionId: FIXTURE_CONNECTION_ID,
    integrationId: FIXTURE_INTEGRATION_ID,
    sourceApp: 'staging_test_source',
    token,
    tokenHash,
    sourceFirebaseProjectId: FIXTURE_SOURCE_FIREBASE_PROJECT_ID,
    sourceProjectId: FIXTURE_SOURCE_PROJECT_ID,
    legacyConnectionId: FIXTURE_LEGACY_CONNECTION_ID,
    legacyIntegrationId: FIXTURE_LEGACY_INTEGRATION_ID,
    legacySourceApp: 'manual',
    legacySourceFirebaseProjectId: FIXTURE_LEGACY_SOURCE_FIREBASE_PROJECT_ID,
    legacySourceProjectId: FIXTURE_LEGACY_SOURCE_PROJECT_ID,
    legacyToken,
    legacyTokenHash,
    ...(smokeUsers ? { smokeUsers } : {})
  };
}

async function assertFixtureUserAvailable(auth, uid) {
  try {
    await auth.getUser(uid);
    throw new Error(`Refusing to replace existing staging Auth user '${uid}'.`);
  } catch (error) {
    if (error.code === 'auth/user-not-found') return;
    throw error;
  }
}

async function createSmokeUsers(auth) {
  await assertFixtureUserAvailable(auth, FIXTURE_OWNER_UID);
  await assertFixtureUserAvailable(auth, FIXTURE_PEER_UID);
  const suffix = randomBytes(8).toString('hex');
  const owner = {
    uid: FIXTURE_OWNER_UID,
    email: `timeleft-staging-owner-${suffix}@example.invalid`,
    password: `Aa1!${randomBytes(24).toString('base64url')}`
  };
  const peer = {
    uid: FIXTURE_PEER_UID,
    email: `timeleft-staging-peer-${suffix}@example.invalid`,
    password: `Aa1!${randomBytes(24).toString('base64url')}`
  };
  await auth.createUser({ uid: owner.uid, email: owner.email, password: owner.password, emailVerified: true });
  try {
    await auth.createUser({ uid: peer.uid, email: peer.email, password: peer.password, emailVerified: true });
  } catch (error) {
    await auth.deleteUser(owner.uid);
    throw error;
  }
  return { owner, peer };
}

async function cleanupSmokeUsers(auth, smokeUsers) {
  let deleted = 0;
  for (const fixtureUser of [smokeUsers?.owner, smokeUsers?.peer].filter(Boolean)) {
    try {
      const existing = await auth.getUser(fixtureUser.uid);
      if (existing.email !== fixtureUser.email) {
        throw new Error(`Refusing to delete staging Auth user '${fixtureUser.uid}' because its email does not match this fixture.`);
      }
      await auth.deleteUser(fixtureUser.uid);
      deleted += 1;
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
  }
  return deleted;
}

function resolveDocumentRefs(input) {
  const documentSnapshots = Array.isArray(input)
    ? input
    : Array.isArray(input?.docs)
      ? input.docs
      : null;
  if (!Array.isArray(documentSnapshots)) {
    throw new TypeError('makeBatchDeleteOps expected an array of document snapshots or QuerySnapshot-like object with .docs');
  }
  return documentSnapshots;
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [key, ...rest] = arg.slice(2).split('=');
    if (rest.length) {
      options[key] = rest.join('=');
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
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

function shouldDeleteFixtureTokenFile(tokenMeta) {
  return !tokenMeta || (tokenMeta?.projectId === APPROVED_PROJECT_ID && tokenMeta?.calendarId === FIXTURE_CALENDAR_ID);
}

function writeFixtureToken(filePath, payload) {
  const dir = dirname(filePath);
  if (dir && dir !== '.') {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

function makeBatchDeleteOps(db, docs) {
  const documentSnapshots = resolveDocumentRefs(docs);
  const all = [];
  for (const doc of documentSnapshots) {
    if (!doc || typeof doc !== 'object' || !doc.ref) {
      throw new TypeError('Document snapshot entries must include a ref field.');
    }
    all.push(doc.ref);
  }

  const chunks = [];
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

async function cleanupIntegrationRecords(db, calendarRef, integrationId) {
  const [events, rawPayloads, deadLetters] = await Promise.all([
    calendarRef.collection('lifeEvents').where('integrationId', '==', integrationId).get(),
    calendarRef.collection('rawIngestionPayloads').where('integrationId', '==', integrationId).get(),
    calendarRef.collection('ingestionDeadLetters').where('integrationId', '==', integrationId).get()
  ]);

  const deleteOps = [];
  deleteOps.push(...makeBatchDeleteOps(db, events));
  deleteOps.push(...makeBatchDeleteOps(db, rawPayloads));
  deleteOps.push(...makeBatchDeleteOps(db, deadLetters));
  await Promise.all(deleteOps);

  return {
    integrationId,
    lifeEvents: events.size,
    rawIngestionPayloads: rawPayloads.size,
    ingestionDeadLetters: deadLetters.size
  };
}

async function createFixture(db, auth, tokenPath) {
  const token = generateToken();
  const tokenHash = sha256(token);
  const tokenLastFour = token.slice(-4);
  const legacyToken = generateToken();
  const legacyTokenHash = sha256(legacyToken);
  const legacyTokenLastFour = legacyToken.slice(-4);
  const smokeUsers = await createSmokeUsers(auth);

  const payload = buildFixtureMetadata({
    token,
    tokenHash,
    legacyToken,
    legacyTokenHash,
    smokeUsers
  });
  payload.createdAt = new Date().toISOString();
  writeFixtureToken(tokenPath, payload);

  const calendarRef = db.collection('lifeCalendars').doc(FIXTURE_CALENDAR_ID);
  const connectionRef = calendarRef.collection('sourceConnections').doc(FIXTURE_CONNECTION_ID);
  const secretRef = calendarRef.collection('sourceConnectionSecrets').doc(FIXTURE_CONNECTION_ID);
  const legacyConnectionRef = calendarRef.collection('sourceConnections').doc(FIXTURE_LEGACY_CONNECTION_ID);
  const legacySecretRef = calendarRef.collection('sourceConnectionSecrets').doc(FIXTURE_LEGACY_CONNECTION_ID);

  await calendarRef.set({
    ownerUid: FIXTURE_OWNER_UID,
    synthetic: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await connectionRef.set({
    status: 'active',
    sourceApp: 'staging_test_source',
    sourceFirebaseProjectId: FIXTURE_SOURCE_FIREBASE_PROJECT_ID,
    sourceProjectIds: [FIXTURE_SOURCE_PROJECT_ID],
    permissions: {
      eventClasses: ALLOWED_EVENT_CLASSES
    },
    integrationId: FIXTURE_INTEGRATION_ID,
    timeLeftUserId: FIXTURE_OWNER_UID,
    tokenStatus: 'active',
    tokenVersion: 1,
    tokenLastFour,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await legacyConnectionRef.set({
    status: 'active',
    sourceApp: 'manual',
    sourceFirebaseProjectId: FIXTURE_LEGACY_SOURCE_FIREBASE_PROJECT_ID,
    sourceProjectIds: [FIXTURE_LEGACY_SOURCE_PROJECT_ID],
    permissions: {
      eventClasses: ALLOWED_EVENT_CLASSES
    },
    integrationId: FIXTURE_LEGACY_INTEGRATION_ID,
    timeLeftUserId: FIXTURE_OWNER_UID,
    tokenStatus: 'active',
    tokenVersion: 1,
    tokenLastFour: legacyTokenLastFour,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await secretRef.set({
    tokenHash,
    tokenVersion: 1,
    tokenStatus: 'active',
    tokenCreatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await legacySecretRef.set({
    tokenHash: legacyTokenHash,
    tokenVersion: 1,
    tokenStatus: 'active',
    tokenCreatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(JSON.stringify({
    status: 'created',
    targetProject: APPROVED_PROJECT_ID,
    calendarId: FIXTURE_CALENDAR_ID,
    connectionId: FIXTURE_CONNECTION_IDS,
    integrationId: FIXTURE_INTEGRATION_IDS,
    tokenFile: tokenPath,
    note: 'Plaintext token is stored only in token file.'
  }));
}

async function cleanupFixture(db, auth, tokenPath) {
  const tokenMeta = readFixtureToken(tokenPath);
  const calendarRef = db.collection('lifeCalendars').doc(FIXTURE_CALENDAR_ID);
  const connectionRef = calendarRef.collection('sourceConnections').doc(FIXTURE_CONNECTION_ID);
  const secretRef = calendarRef.collection('sourceConnectionSecrets').doc(FIXTURE_CONNECTION_ID);
  const legacyConnectionRef = calendarRef.collection('sourceConnections').doc(FIXTURE_LEGACY_CONNECTION_ID);
  const legacySecretRef = calendarRef.collection('sourceConnectionSecrets').doc(FIXTURE_LEGACY_CONNECTION_ID);

  const cleanupSummaries = await Promise.all(
    FIXTURE_INTEGRATION_IDS.map((integrationId) => cleanupIntegrationRecords(db, calendarRef, integrationId))
  );

  await Promise.all([
    connectionRef.delete(),
    secretRef.delete(),
    legacyConnectionRef.delete(),
    legacySecretRef.delete()
  ]);

  const calendarSnap = await calendarRef.get();
  if (calendarSnap.exists && calendarSnap.get('synthetic') === true) {
    await calendarRef.delete();
  }

  const deletedAuthUsers = await cleanupSmokeUsers(auth, tokenMeta?.smokeUsers);
  const canDeleteTokenFile = shouldDeleteFixtureTokenFile(tokenMeta);
  if (existsSync(tokenPath) && canDeleteTokenFile) {
    rmSync(tokenPath);
  }

  const deleted = cleanupSummaries.reduce((acc, summary) => ({
    lifeEvents: acc.lifeEvents + summary.lifeEvents,
    rawIngestionPayloads: acc.rawIngestionPayloads + summary.rawIngestionPayloads,
    ingestionDeadLetters: acc.ingestionDeadLetters + summary.ingestionDeadLetters
  }), {
    lifeEvents: 0,
    rawIngestionPayloads: 0,
    ingestionDeadLetters: 0
  });

  console.log(JSON.stringify({
    status: 'cleanup-complete',
    targetProject: APPROVED_PROJECT_ID,
    calendarId: FIXTURE_CALENDAR_ID,
    connectionIds: FIXTURE_CONNECTION_IDS,
    integrationIds: FIXTURE_INTEGRATION_IDS,
    deleted,
    deletedAuthUsers
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
  const auth = getAuth(app);

  console.log(JSON.stringify({
    status: 'target',
    command,
    targetProject: projectId,
    calendarId: FIXTURE_CALENDAR_ID,
    connectionId: FIXTURE_CONNECTION_IDS,
    integrationId: FIXTURE_INTEGRATION_IDS
  }));

  if (command === 'create') {
    await createFixture(db, auth, tokenPath);
    return;
  }

  await cleanupFixture(db, auth, tokenPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    fail('staging fixture command failed.', {
      message: error?.message || 'unknown',
      code: error?.code || null
    });
  });
}

export {
  buildFixtureMetadata,
  resolveDocumentRefs,
  makeBatchDeleteOps,
  cleanupIntegrationRecords,
  FIXTURE_INTEGRATION_IDS,
  FIXTURE_CONNECTION_IDS,
  FIXTURE_LEGACY_CONNECTION_ID,
  FIXTURE_LEGACY_INTEGRATION_ID,
  shouldDeleteFixtureTokenFile,
  readFixtureToken
};
