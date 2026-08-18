#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const {
  buildJournalEnrichmentCandidate,
  evaluateJournalEnrichment,
  isEligibleLegacyRecord,
  sourcePathForLegacy
} = require('../functions/src/ingestion/journalEnrichment.js');
const { isValidDateId } = require('../functions/src/ingestion/dateId.js');

const MAX_LIMIT = 100_000;
const DEFAULT_BATCH_SIZE = 50;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const separator = value.indexOf('=');
    const key = value.slice(2, separator === -1 ? undefined : separator);
    if (separator !== -1) options[key] = value.slice(separator + 1);
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) options[key] = argv[++index];
    else options[key] = true;
  }
  return options;
}

function fail(message) {
  throw new Error(message);
}

function integerOption(value, fallback, label, max = MAX_LIMIT) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) fail(`${label} must be an integer from 1 to ${max}.`);
  return parsed;
}

function dateOption(value, label) {
  if (value && !isValidDateId(value)) fail(`${label} must be YYYY-MM-DD.`);
  return value || '';
}

function safeProjectId(value, label) {
  const result = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{3,62}$/.test(result)) fail(`${label} is required and must be a Firebase project ID.`);
  return result;
}

function shortHash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

function addReason(summary, key) {
  summary.skippedReasons[key] = (summary.skippedReasons[key] || 0) + 1;
}

function emptySummary(apply) {
  return {
    mode: apply ? 'apply' : 'dry-run',
    scanned: 0,
    eligible: 0,
    journals: 0,
    media: 0,
    shortcutShadows: 0,
    wouldRepair: 0,
    repaired: 0,
    unchanged: 0,
    skipped: 0,
    conflicts: 0,
    errors: 0,
    skippedReasons: {},
    conflictSamples: []
  };
}

async function scanLegacy(calendarRef, options) {
  let query = calendarRef.collection('dailyEntries').orderBy(FieldPath.documentId());
  if (options.startDate) query = query.startAt(options.startDate);
  if (options.endDate) query = query.endAt(options.endDate);
  const days = await query.get();
  const records = [];
  for (let index = 0; index < days.docs.length && records.length < options.limit; index += 20) {
    const chunk = days.docs.slice(index, index + 20);
    const snapshots = await Promise.all(chunk.map((day) => day.ref.collection('externalItems').orderBy(FieldPath.documentId()).get()));
    snapshots.forEach((snapshot, dayIndex) => {
      const dateId = chunk[dayIndex].id;
      snapshot.docs.forEach((doc) => {
        if (records.length >= options.limit) return;
        const resumeKey = `${dateId}/${doc.id}`;
        if (options.resumeAfter && resumeKey <= options.resumeAfter) return;
        records.push({ id: doc.id, dateId, resumeKey, data: doc.data() || {} });
      });
    });
  }
  return records;
}

async function linkedMediaPaths(sourceDb, logId, projectId) {
  const snapshot = await sourceDb.collection('media').where('linkedLogEntryId', '==', logId).limit(50).get();
  return snapshot.docs.map((doc) => doc.data() || {})
    .filter((media) => String(media.projectId || media.projectSlug || '') === projectId)
    .map((media) => String(media.storagePath || '').trim())
    .filter(Boolean);
}

function assertConnection(connection, record, sourceProject, ownerUid) {
  if (!connection || connection.sourceApp !== 'gridlineai') return 'connection_not_gridlineai';
  if (connection.sourceFirebaseProjectId && connection.sourceFirebaseProjectId !== 'gridlineai') return 'source_project_mismatch';
  if (connection.timeLeftUserId && connection.timeLeftUserId !== ownerUid) return 'connection_owner_mismatch';
  if (record.ownerUid && record.ownerUid !== ownerUid) return 'legacy_owner_mismatch';
  const allowed = Array.isArray(connection.sourceProjectIds) ? connection.sourceProjectIds.map(String) : [];
  if (!sourceProject || !allowed.includes(sourceProject)) return 'project_not_authorized';
  if (record.sourceProjectId && record.sourceProjectId !== sourceProject) return 'legacy_source_scope_mismatch';
  return '';
}

async function applyOperations(db, calendarRef, operations) {
  if (!operations.length) return;
  await db.runTransaction(async (transaction) => {
    const refs = operations.map((operation) => calendarRef.collection('lifeEvents').doc(operation.id));
    const snapshots = await transaction.getAll(...refs);
    snapshots.forEach((snapshot, index) => {
      const operation = operations[index];
      if (!snapshot.exists || snapshot.get('contentHash') !== operation.expectedContentHash) {
        fail(`Concurrent canonical change detected for redacted record ${shortHash(operation.id)}.`);
      }
    });
    operations.forEach((operation, index) => transaction.set(refs[index], operation.data, { merge: true }));
  });
}

async function run(options) {
  const timeApp = initializeApp({ projectId: options.projectId }, `journal-enrichment-time-${Date.now()}`);
  const sourceApp = initializeApp({ projectId: options.sourceProjectId }, `journal-enrichment-source-${Date.now()}`);
  const timeDb = getFirestore(timeApp);
  const sourceDb = getFirestore(sourceApp);
  const summary = emptySummary(options.apply);
  let lastResumeKey = options.resumeAfter || '';
  try {
    const calendarSnapshot = await timeDb.collection('lifeCalendars').doc(options.calendarId).get();
    if (!calendarSnapshot.exists) fail('The requested calendar does not exist.');
    const calendar = calendarSnapshot.data() || {};
    if (!calendar.ownerUid) fail('The requested calendar has no owner.');
    const connectionSnapshot = await calendarSnapshot.ref.collection('sourceConnections').get();
    const connections = new Map(connectionSnapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
    const records = await scanLegacy(calendarSnapshot.ref, options);
    const pending = [];

    for (const record of records) {
      summary.scanned += 1;
      lastResumeKey = record.resumeKey;
      try {
        if (!isEligibleLegacyRecord(record.data)) {
          summary.skipped += 1;
          addReason(summary, 'not_journal_or_media');
          continue;
        }
        const sourcePath = sourcePathForLegacy(record.data);
        const [collection, sourceId] = sourcePath.split('/');
        const sourceSnapshot = await sourceDb.collection(collection).doc(sourceId).get();
        if (!sourceSnapshot.exists) {
          summary.skipped += 1;
          addReason(summary, 'source_record_missing');
          continue;
        }
        const source = sourceSnapshot.data() || {};
        const sourceProject = String(source.projectId || source.projectSlug || '');
        const connection = connections.get(record.data.connectionId);
        const scopeFailure = assertConnection(connection, record.data, sourceProject, calendar.ownerUid);
        if (scopeFailure) {
          summary.conflicts += 1;
          if (summary.conflictSamples.length < 10) summary.conflictSamples.push({ record: shortHash(record.resumeKey), reason: scopeFailure });
          continue;
        }
        const linkedPaths = collection === 'logEntries'
          ? await linkedMediaPaths(sourceDb, sourceId, sourceProject)
          : [];
        const candidate = buildJournalEnrichmentCandidate(
          { ...record.data, dateId: record.data.dateId || record.dateId },
          source,
          {
            calendarId: calendarSnapshot.id,
            connectionId: connection.id,
            integrationId: connection.integrationId || connection.id,
            timeLeftUserId: calendar.ownerUid,
            connection
          },
          { sourcePath, linkedMediaPaths: linkedPaths }
        );
        if (!candidate) {
          summary.skipped += 1;
          addReason(summary, 'candidate_not_constructed');
          continue;
        }
        summary.eligible += 1;
        if (collection === 'logEntries') summary.journals += 1;
        else summary.media += 1;
        if (candidate.metadata?.activityVisibility === 'shortcut_shadow') summary.shortcutShadows += 1;
        const canonicalSnapshot = await calendarSnapshot.ref.collection('lifeEvents').doc(candidate.idempotencyKey).get();
        const evaluation = evaluateJournalEnrichment({
          canonicalId: candidate.idempotencyKey,
          existing: canonicalSnapshot.exists ? canonicalSnapshot.data() : null,
          candidate,
          now: new Date()
        });
        if (evaluation.status === 'unchanged') {
          summary.unchanged += 1;
        } else if (evaluation.status === 'repair') {
          summary.wouldRepair += 1;
          if (options.apply) pending.push({
            id: candidate.idempotencyKey,
            expectedContentHash: evaluation.expectedContentHash,
            data: evaluation.data
          });
        } else if (evaluation.status === 'conflict') {
          summary.conflicts += 1;
          if (summary.conflictSamples.length < 10) summary.conflictSamples.push({ record: shortHash(record.resumeKey), reason: evaluation.reason });
        } else {
          summary.skipped += 1;
          addReason(summary, evaluation.reason || 'not_repairable');
        }

        if (options.apply && pending.length >= options.batchSize) {
          const batch = pending.slice();
          await applyOperations(timeDb, calendarSnapshot.ref, batch);
          pending.splice(0, batch.length);
          summary.repaired += batch.length;
        }
      } catch (error) {
        summary.errors += 1;
        if (options.apply) throw error;
      }
    }
    if (options.apply && pending.length) {
      const count = pending.length;
      await applyOperations(timeDb, calendarSnapshot.ref, pending);
      summary.repaired += count;
    }
    return { ...summary, resumeAfter: lastResumeKey || null };
  } finally {
    await Promise.all([deleteApp(timeApp), deleteApp(sourceApp)]);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = safeProjectId(args.project, '--project');
  const sourceProjectId = safeProjectId(args['source-project'] || 'gridlineai', '--source-project');
  const calendarId = String(args['calendar-id'] || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(calendarId)) fail('--calendar-id is required.');
  const startDate = dateOption(args['start-date'], '--start-date');
  const endDate = dateOption(args['end-date'], '--end-date');
  if (startDate && endDate && startDate > endDate) fail('--start-date must not follow --end-date.');
  const apply = args.apply === true;
  if (apply && args['confirm-project'] !== projectId) {
    fail('Apply mode requires --confirm-project matching --project. Dry-run remains the default.');
  }
  const options = {
    projectId,
    sourceProjectId,
    calendarId,
    startDate,
    endDate,
    apply,
    limit: integerOption(args.limit, MAX_LIMIT, '--limit'),
    batchSize: integerOption(args['batch-size'], DEFAULT_BATCH_SIZE, '--batch-size', 200),
    resumeAfter: String(args['resume-after'] || '')
  };
  console.log(JSON.stringify({
    status: 'target',
    mode: apply ? 'apply' : 'dry-run',
    projectId,
    sourceProjectId,
    calendarId,
    startDate: startDate || null,
    endDate: endDate || null,
    limit: options.limit,
    batchSize: options.batchSize,
    resumeAfter: options.resumeAfter || null
  }));
  const summary = await run(options);
  console.log(JSON.stringify({ status: 'complete', ...summary }, null, 2));
  if (summary.conflicts || summary.errors) process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'error', message: error.message }));
    process.exit(1);
  });
}

export { assertConnection, emptySummary, parseArgs, run, scanLegacy };
