#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { executeLegacyBackfill } = require('../functions/src/ingestion/legacyBackfill.js');
const { isValidDateId } = require('../functions/src/ingestion/dateId.js');

const DEFAULT_BATCH_SIZE = 100;
const MAX_SCAN_LIMIT = 100_000;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const separator = arg.indexOf('=');
    const key = arg.slice(2, separator === -1 ? undefined : separator);
    if (separator !== -1) {
      options[key] = arg.slice(separator + 1);
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
  return options;
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function integerOption(value, fallback, label, { min = 1, max = MAX_SCAN_LIMIT } = {}) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(`${label} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function validateDateOption(value, label) {
  if (value && !isValidDateId(value)) fail(`${label} must be a valid YYYY-MM-DD date.`);
  return value || '';
}

function readCheckpoint(path, expected) {
  if (!path || !existsSync(path)) return '';
  const checkpoint = JSON.parse(readFileSync(path, 'utf8'));
  if (checkpoint.projectId !== expected.projectId || checkpoint.calendarId !== expected.calendarId) {
    fail('Checkpoint project or calendar does not match this run.', {
      checkpointProject: checkpoint.projectId || null,
      checkpointCalendar: checkpoint.calendarId || null
    });
  }
  return checkpoint.resumeAfter || '';
}

function writeCheckpoint(path, value) {
  if (!path || !value.resumeAfter) return;
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function resolveCalendar(db, requestedId) {
  if (requestedId) {
    const snapshot = await db.collection('lifeCalendars').doc(requestedId).get();
    if (!snapshot.exists) fail('Requested calendar does not exist.', { calendarId: requestedId });
    return snapshot;
  }
  const snapshot = await db.collection('lifeCalendars').select('ownerUid', 'timezone', 'settings').limit(2).get();
  if (snapshot.size !== 1) {
    fail('Calendar auto-resolution requires exactly one calendar; pass --calendar-id explicitly.', { calendarCount: snapshot.size });
  }
  return snapshot.docs[0];
}

async function loadConnections(calendarRef) {
  const snapshot = await calendarRef.collection('sourceConnections').get();
  return new Map(snapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
}

async function scanLegacyRecords(calendarRef, options) {
  let entryQuery = calendarRef.collection('dailyEntries').orderBy(FieldPath.documentId());
  if (options.startDate) entryQuery = entryQuery.startAt(options.startDate);
  if (options.endDate) entryQuery = entryQuery.endAt(options.endDate);
  const entries = await entryQuery.get();
  const records = [];

  for (let index = 0; index < entries.docs.length; index += 25) {
    const entryChunk = entries.docs.slice(index, index + 25);
    const itemSnapshots = await Promise.all(entryChunk.map((entry) => (
      entry.ref.collection('externalItems').orderBy(FieldPath.documentId()).get()
    )));
    for (const [chunkIndex, items] of itemSnapshots.entries()) {
      const entry = entryChunk[chunkIndex];
      const dateId = entry.id;
      for (const item of items.docs) {
        const checkpoint = `${dateId}/${item.id}`;
        if (options.resumeAfter && checkpoint <= options.resumeAfter) continue;
        const data = item.data();
        records.push({
          id: item.id,
          path: item.ref.path,
          checkpoint,
          calendarId: calendarRef.id,
          connectionId: data.connectionId || '',
          dateId: data.dateId || dateId,
          data
        });
        if (records.length >= options.limit) return records;
      }
    }
  }
  return records;
}

function makeDependencies(db, calendarRef, calendar, connections, canonical, checkpointContext) {
  const canonicalRef = calendarRef.collection('lifeEvents');
  return {
    calendar,
    getConnection: async (connectionId) => connections.get(connectionId) || null,
    getCanonical: async (id) => canonical.get(id) || null,
    now: () => new Date(),
    applyOperations: async (operations) => {
      const refs = operations.map((operation) => canonicalRef.doc(operation.id));
      await db.runTransaction(async (transaction) => {
        const snapshots = await transaction.getAll(...refs);
        operations.forEach((operation, index) => {
          const snapshot = snapshots[index];
          if (operation.action === 'create') {
            if (snapshot.exists) fail('Concurrent canonical create detected; refusing to overwrite.', { lifeEventId: operation.id });
          } else if (!snapshot.exists || snapshot.get('contentHash') !== operation.expectedContentHash) {
            fail('Concurrent canonical repair conflict detected; refusing to overwrite.', { lifeEventId: operation.id });
          }
        });
        operations.forEach((operation, index) => {
          if (operation.action === 'create') transaction.create(refs[index], operation.data);
          else transaction.update(refs[index], operation.data);
        });
      });
      const lastCheckpoint = operations.at(-1)?.checkpoint;
      if (checkpointContext.path && lastCheckpoint) {
        writeCheckpoint(checkpointContext.path, {
          projectId: checkpointContext.projectId,
          calendarId: calendarRef.id,
          resumeAfter: lastCheckpoint,
          updatedAt: new Date().toISOString()
        });
      }
      operations.forEach((operation) => {
        const current = canonical.get(operation.id) || {};
        canonical.set(operation.id, operation.action === 'create' ? operation.data : { ...current, ...operation.data });
      });
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = typeof args.project === 'string' ? args.project.trim() : '';
  if (!projectId) fail('Missing required --project argument.');
  const apply = args.apply === true;
  const startDate = validateDateOption(args['start-date'] || args.startDate, '--start-date');
  const endDate = validateDateOption(args['end-date'] || args.endDate, '--end-date');
  if (startDate && endDate && startDate > endDate) fail('--start-date must not be after --end-date.');
  const limit = integerOption(args.limit, MAX_SCAN_LIMIT, '--limit');
  const batchSize = integerOption(args['batch-size'] || args.batchSize, DEFAULT_BATCH_SIZE, '--batch-size', { max: 400 });
  const checkpointPath = typeof args.checkpoint === 'string' ? args.checkpoint : '';

  const app = initializeApp({ projectId }, `life-event-backfill-${Date.now()}`);
  const db = getFirestore(app);
  const calendarSnapshot = await resolveCalendar(db, args['calendar-id'] || args.calendarId);
  const calendar = { id: calendarSnapshot.id, ...calendarSnapshot.data() };
  if (!calendar.ownerUid) fail('Resolved calendar has no ownerUid.', { calendarId: calendar.id });
  const resumeAfter = (typeof args['resume-after'] === 'string' ? args['resume-after'] : '')
    || readCheckpoint(checkpointPath, { projectId, calendarId: calendar.id });
  const connections = await loadConnections(calendarSnapshot.ref);
  const canonicalSnapshot = await calendarSnapshot.ref.collection('lifeEvents').get();
  const canonical = new Map(canonicalSnapshot.docs.map((doc) => [doc.id, doc.data()]));

  console.log(JSON.stringify({
    status: 'target',
    mode: apply ? 'apply' : 'dry-run',
    projectId,
    calendarId: calendar.id,
    startDate: startDate || null,
    endDate: endDate || null,
    limit,
    batchSize,
    resumeAfter: resumeAfter || null,
    connectionCount: connections.size
  }));

  const records = await scanLegacyRecords(calendarSnapshot.ref, {
    startDate,
    endDate,
    limit,
    resumeAfter
  });
  const dependencies = makeDependencies(db, calendarSnapshot.ref, calendar, connections, canonical, {
    path: checkpointPath,
    projectId
  });
  const summary = await executeLegacyBackfill(records, dependencies, { apply, batchSize });
  console.log(JSON.stringify({
    status: 'complete',
    projectId,
    calendarId: calendar.id,
    dateRange: { startDate: startDate || null, endDate: endDate || null },
    resumeAfter: records.at(-1)?.checkpoint || resumeAfter || null,
    ...summary
  }, null, 2));

  if (summary.conflicts > 0 || summary.errors > 0) process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: 'error',
      message: error.message,
      details: error.details || null
    }));
    process.exit(1);
  });
}

export {
  integerOption,
  loadConnections,
  parseArgs,
  readCheckpoint,
  resolveCalendar,
  scanLegacyRecords,
  validateDateOption
};
