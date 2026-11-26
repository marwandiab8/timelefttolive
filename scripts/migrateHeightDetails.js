#!/usr/bin/env node
// Copies the children's "Height, <date>" detail rows into the dated height history
// (lifeCalendars/{calendarId}/childMeasurements). Dry run by default: it lists what it would do and writes nothing.
//
//   node scripts/migrateHeightDetails.js --project timelefttolive
//   node scripts/migrateHeightDetails.js --project timelefttolive --calendar <id> --apply --confirm-project timelefttolive
//   node scripts/migrateHeightDetails.js ... --apply --confirm-project ... --remove-details
//
// Measurements get a stable id (child, kind, day), so running it again never makes duplicates, and one that already
// exists is left as it is. New measurements are owner-only. A value that doesn't read cleanly (5' 10 9/8") is kept
// as written, with no number, and flagged for checking in the app. The detail rows stay on the profile unless
// --remove-details is given, and then only the rows whose measurement exists are removed.
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { heightRowsFromDetails } from '../src/utils/childMeasurements.js';

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
  console.error(message);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const projectId = String(args.project || '').trim();
if (!/^[a-z0-9][a-z0-9-]{3,62}$/.test(projectId)) fail('--project is required and must be a Firebase project ID.');
const apply = args.apply === true;
const removeDetails = args['remove-details'] === true;
if (apply && args['confirm-project'] !== projectId) fail('--apply needs --confirm-project matching --project. Without --apply this is a dry run.');
if (apply && !args.calendar) fail('--apply needs --calendar <calendarId>, so it changes one calendar on purpose.');
if (removeDetails && !apply) fail('--remove-details only works with --apply.');

const app = initializeApp({ projectId });
const db = getFirestore(app);

async function migrateCalendar(calendarSnapshot) {
  const calendar = calendarSnapshot.data();
  const measurementsRef = calendarSnapshot.ref.collection('childMeasurements');
  const report = { calendarId: calendarSnapshot.id, create: [], existing: [], skipped: [], removeDetails: [] };
  const migratedDetailIds = new Map();

  for (const child of calendar.children || []) {
    const { measurements, skipped } = heightRowsFromDetails(child);
    skipped.forEach((row) => report.skipped.push({ child: child.name, ...row }));
    for (const measurement of measurements) {
      const exists = (await measurementsRef.doc(measurement.id).get()).exists;
      const row = {
        child: child.name,
        id: measurement.id,
        measuredOn: measurement.data.measuredOn,
        asWritten: measurement.data.asWritten,
        valueMm: measurement.data.valueMm,
        needsCheck: measurement.data.needsCheck
      };
      (exists ? report.existing : report.create).push(row);
      if (apply && !exists) {
        await measurementsRef.doc(measurement.id).set({ ...measurement.data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      }
      if (!migratedDetailIds.has(child.id)) migratedDetailIds.set(child.id, new Set());
      migratedDetailIds.get(child.id).add(measurement.detailId);
      report.removeDetails.push({ child: child.name, detailId: measurement.detailId });
    }
  }

  if (apply && removeDetails && migratedDetailIds.size) {
    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(calendarSnapshot.ref);
      const children = (fresh.data().children || []).map((child) => ({
        ...child,
        details: (child.details || []).filter((detail) => !migratedDetailIds.get(child.id)?.has(detail.id))
      }));
      transaction.update(calendarSnapshot.ref, { children, updatedAt: FieldValue.serverTimestamp() });
    });
  }
  return report;
}

try {
  const calendars = args.calendar
    ? [await db.collection('lifeCalendars').doc(String(args.calendar)).get()]
    : (await db.collection('lifeCalendars').get()).docs;
  const reports = [];
  for (const snapshot of calendars) {
    if (!snapshot.exists) fail(`Calendar ${args.calendar} not found in ${projectId}.`);
    const report = await migrateCalendar(snapshot);
    if (report.create.length || report.existing.length || report.skipped.length) reports.push(report);
  }
  console.log(JSON.stringify({
    projectId,
    mode: apply ? 'apply' : 'dry-run',
    removeDetails: apply && removeDetails,
    calendars: reports.map((report) => ({
      calendarId: report.calendarId,
      [apply ? 'created' : 'wouldCreate']: report.create,
      alreadyThere: report.existing,
      skipped: report.skipped,
      [apply && removeDetails ? 'detailRowsRemoved' : 'detailRowsKept']: report.removeDetails.length
    }))
  }, null, 2));
} finally {
  await deleteApp(app);
}
