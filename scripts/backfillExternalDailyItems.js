#!/usr/bin/env node
import fs from 'node:fs';
import { mapAiGridlineRecord } from '../src/services/externalSources/aiGridlineMapper.js';
import { mapGymK2Record } from '../src/services/externalSources/gymK2Mapper.js';
import { mapGridlineAiRecord } from '../src/services/externalSources/gridlineAiMapper.js';
import { mapMyDoubleProgressRecord } from '../src/services/externalSources/myDoubleProgressMapper.js';
import { mapDartsTrackerRecord } from '../src/services/externalSources/dartsTrackerMapper.js';

const mappers = {
  aigridline: mapAiGridlineRecord,
  'GYM-K2': mapGymK2Record,
  gridlineai: mapGridlineAiRecord,
  MyDoubleProgress: mapMyDoubleProgressRecord,
  DartstRacker2026: mapDartsTrackerRecord
};

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));

const sourceApp = args.sourceApp;
const mapper = mappers[sourceApp];
const dryRun = Boolean(args.dryRun);
const inputFile = args.input;

if (!args.calendarId || !sourceApp || !mapper) {
  console.error('Usage: npm run backfill:external -- --calendarId=... --sourceApp=aigridline --input=records.json --dryRun');
  process.exit(1);
}

if (!inputFile) {
  console.log(JSON.stringify({
    mode: dryRun ? 'dryRun' : 'planned',
    scanned: 0,
    linked: 0,
    skipped: 0,
    missingDate: 0,
    errors: 0,
    note: 'No --input file supplied. Cross-project Firestore scanning must run server-side with Admin credentials; this script currently maps JSON exports only.'
  }, null, 2));
  process.exit(0);
}

const records = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const rows = Array.isArray(records) ? records : Object.values(records);
let linked = 0;
let missingDate = 0;
let errors = 0;

for (const record of rows) {
  try {
    const item = mapper(record);
    item.calendarId = args.calendarId;
    if (item.needsDateReview) missingDate += 1;
    else linked += 1;
    if (dryRun) console.log(JSON.stringify(item));
  } catch (error) {
    errors += 1;
    console.error(error.message);
  }
}

console.log(JSON.stringify({
  mode: dryRun ? 'dryRun' : 'mappedOnly',
  scanned: rows.length,
  linked,
  skipped: 0,
  missingDate,
  errors,
  note: dryRun ? 'No writes performed.' : 'This first version maps records only; write execution should run through the owner UI or a server-side ingestion function.'
}, null, 2));
