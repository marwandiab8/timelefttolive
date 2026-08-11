const {
  buildContentHash,
  mapLegacyToLifeEvent
} = require("./lifeEventFoundation");
const {
  DEFAULT_TIMEZONE,
  normalizeTimezone,
  parseDateInTimezone
} = require("./dateId");

const MIGRATION_NAME = "legacy-external-items-to-life-events";
const MIGRATION_VERSION = 1;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 400;

function emptySummary(dryRun) {
  return {
    mode: dryRun ? "dry-run" : "apply",
    scanned: 0,
    eligible: 0,
    created: 0,
    repaired: 0,
    unchanged: 0,
    skipped: 0,
    conflicts: 0,
    errors: 0,
    skippedReasons: {},
    conflictSamples: [],
    errorSamples: []
  };
}

function addReason(summary, reason) {
  summary.skippedReasons[reason] = (summary.skippedReasons[reason] || 0) + 1;
}

function toDate(value, timezone, fieldName) {
  if (!value) return null;
  try {
    return parseDateInTimezone(value, timezone, fieldName);
  } catch (_error) {
    return null;
  }
}

function isSyntheticRecord(record, connection) {
  const connectionId = String(record.connectionId || "");
  return connection?.synthetic === true
    || record.data?.synthetic === true
    || record.data?.metadata?.synthetic === true
    || /^(codex[_-]|fixture[_-]|test[_-])/i.test(connectionId);
}

function sameValue(left, right) {
  return (left || "") === (right || "");
}

function identityMatches(existing, candidate) {
  return existing?.schemaVersion === candidate.schemaVersion
    && sameValue(existing.integrationId, candidate.integrationId)
    && sameValue(existing.connectionId, candidate.connectionId)
    && sameValue(existing.calendarId, candidate.calendarId)
    && sameValue(existing.timeLeftUserId, candidate.timeLeftUserId)
    && sameValue(existing.sourceApp, candidate.sourceApp)
    && sameValue(existing.sourceRecordId, candidate.sourceRecordId)
    && sameValue(existing.sourceEventId, candidate.sourceEventId);
}

function isLegacyGenerated(existing) {
  return String(existing?.legacySourceType || "").startsWith("legacy:")
    || String(existing?.metadata?.legacySourceType || "").startsWith("legacy:");
}

function oldUtcMidnightCandidate(candidate, dateId) {
  const utcMidnight = new Date(`${dateId}T00:00:00.000Z`);
  const startWasDerived = candidate.startAt instanceof Date
    && candidate.occurredAt instanceof Date
    && candidate.startAt.getTime() === candidate.occurredAt.getTime();
  const oldCandidate = {
    ...candidate,
    occurredAt: utcMidnight,
    startAt: startWasDerived ? utcMidnight : candidate.startAt
  };
  oldCandidate.contentHash = buildContentHash(oldCandidate);
  return oldCandidate;
}

function localDateId(value, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function isVerifiedSourceTimestampRepair(existing, candidate, dateId) {
  const migration = existing?.migrationMetadata || {};
  if (migration.name !== "targeted-source-timestamp-repair"
    || migration.version !== 1
    || migration.action !== "source-timestamps-repaired") {
    return false;
  }

  const startAt = toDate(existing.startAt, candidate.timezone, "existing.startAt");
  const endAt = toDate(existing.endAt, candidate.timezone, "existing.endAt");
  const durationSeconds = Number(existing.durationSeconds);
  if (!startAt || !endAt || endAt <= startAt || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return false;
  }
  if (localDateId(startAt, candidate.timezone) !== dateId || localDateId(endAt, candidate.timezone) !== dateId) {
    return false;
  }
  const calculatedDuration = (endAt.getTime() - startAt.getTime()) / 1000;
  if (Math.abs(durationSeconds - calculatedDuration) > 0.001) return false;

  const sourceIdentity = candidate.sourceEventId || candidate.sourceRecordId || "";
  if (!sourceIdentity || migration.sourceRecordId !== sourceIdentity) return false;

  const expectedEnrichedHash = buildContentHash({
    ...candidate,
    startAt,
    endAt,
    durationSeconds,
    metadata: existing.metadata
  });
  return existing.contentHash === expectedEnrichedHash;
}

function classifyCanonical(existing, candidate, dateId) {
  if (!existing) return { action: "create" };
  if (existing.contentHash === candidate.contentHash) return { action: "unchanged" };
  if (!isLegacyGenerated(existing) || !identityMatches(existing, candidate)) {
    return { action: "conflict", reason: "canonical_identity_or_origin_mismatch" };
  }
  if (isVerifiedSourceTimestampRepair(existing, candidate, dateId)) {
    return { action: "unchanged", reason: "verified_source_timestamp_repair" };
  }

  const oldCandidate = oldUtcMidnightCandidate(candidate, dateId);
  if (existing.contentHash !== oldCandidate.contentHash) {
    return { action: "conflict", reason: "canonical_content_mismatch" };
  }
  const existingOccurredAt = toDate(existing.occurredAt, candidate.timezone, "existing.occurredAt");
  if (!existingOccurredAt || existingOccurredAt.toISOString() !== `${dateId}T00:00:00.000Z`) {
    return { action: "conflict", reason: "canonical_not_old_midnight_utc" };
  }
  return {
    action: "repair",
    oldContentHash: oldCandidate.contentHash,
    repairStartAt: oldCandidate.startAt instanceof Date
      && existing.startAt
      && toDate(existing.startAt, candidate.timezone, "existing.startAt")?.getTime() === oldCandidate.startAt.getTime()
  };
}

function originalCreatedAt(record, candidate) {
  const data = record.data || {};
  return toDate(
    data.originalCreatedAt || data.createdAt || data.linkedAt,
    candidate.timezone,
    "legacy.createdAt"
  ) || candidate.occurredAt;
}

function migrationMetadata(record, action, now) {
  return {
    name: MIGRATION_NAME,
    version: MIGRATION_VERSION,
    action,
    sourcePath: record.path,
    migratedAt: now
  };
}

function buildCreateData(record, candidate, now) {
  return {
    id: candidate.idempotencyKey,
    ...candidate,
    ingestionStatus: "migrated",
    receivedAt: originalCreatedAt(record, candidate),
    createdAt: originalCreatedAt(record, candidate),
    updatedAt: now,
    migrationMetadata: migrationMetadata(record, "created", now)
  };
}

function buildRepairData(record, candidate, classification, now) {
  return {
    occurredAt: candidate.occurredAt,
    ...(classification.repairStartAt ? { startAt: candidate.startAt } : {}),
    timezone: candidate.timezone,
    contentHash: candidate.contentHash,
    updatedAt: now,
    migrationMetadata: migrationMetadata(record, "timezone-repaired", now)
  };
}

function validateOwnership(record, calendar, connection) {
  const data = record.data || {};
  if (!calendar?.ownerUid) return "missing_calendar_owner";
  if (!connection) return "missing_connection";
  if (connection.status && connection.status !== "active") return "inactive_connection";
  if (data.calendarId && data.calendarId !== record.calendarId) return "cross_calendar_record";
  if (data.ownerUid && data.ownerUid !== calendar.ownerUid) return "owner_mismatch";
  if (connection.timeLeftUserId && connection.timeLeftUserId !== calendar.ownerUid) return "connection_owner_mismatch";
  if (connection.sourceApp && data.sourceApp && connection.sourceApp !== data.sourceApp) return "connection_source_mismatch";
  return "";
}

function buildCandidate(record, calendar, connection) {
  const timezone = normalizeTimezone(
    record.data?.timezone
      || connection.timezone
      || calendar.timezone
      || calendar.settings?.timezone
      || DEFAULT_TIMEZONE
  );
  const raw = {
    ...record.data,
    calendarId: record.calendarId,
    connectionId: record.connectionId,
    dateId: record.dateId,
    externalItemId: record.id,
    timezone
  };
  return mapLegacyToLifeEvent(raw, {
    calendarId: record.calendarId,
    connectionId: record.connectionId,
    integrationId: connection.integrationId || record.connectionId,
    timeLeftUserId: connection.timeLeftUserId || calendar.ownerUid,
    connection
  });
}

async function executeLegacyBackfill(records, dependencies, options = {}) {
  const dryRun = options.apply !== true;
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, Number(options.batchSize) || DEFAULT_BATCH_SIZE));
  const summary = emptySummary(dryRun);
  const pending = [];
  const seenCandidates = new Map();

  async function flush() {
    if (pending.length === 0) return;
    const operations = pending.splice(0, pending.length);
    if (!dryRun) {
      try {
        await dependencies.applyOperations(operations);
      } catch (error) {
        error.backfillFatal = true;
        throw error;
      }
    }
  }

  for (const record of records) {
    summary.scanned += 1;
    try {
      if (!record.dateId) {
        summary.skipped += 1;
        addReason(summary, "missing_date");
        continue;
      }
      const connection = await dependencies.getConnection(record.connectionId);
      if (isSyntheticRecord(record, connection)) {
        summary.skipped += 1;
        addReason(summary, "synthetic_record");
        continue;
      }
      const ownershipIssue = validateOwnership(record, dependencies.calendar, connection);
      if (ownershipIssue) {
        if (["cross_calendar_record", "owner_mismatch", "connection_owner_mismatch", "connection_source_mismatch"].includes(ownershipIssue)) {
          summary.conflicts += 1;
          if (summary.conflictSamples.length < 10) summary.conflictSamples.push({ path: record.path, reason: ownershipIssue });
        } else {
          summary.skipped += 1;
          addReason(summary, ownershipIssue);
        }
        continue;
      }

      const candidate = buildCandidate(record, dependencies.calendar, connection);
      if (!candidate) {
        summary.skipped += 1;
        addReason(summary, "not_eligible");
        continue;
      }
      summary.eligible += 1;

      const seen = seenCandidates.get(candidate.idempotencyKey);
      if (seen) {
        if (seen === candidate.contentHash) {
          summary.unchanged += 1;
          addReason(summary, "duplicate_legacy_identity");
        } else {
          summary.conflicts += 1;
          if (summary.conflictSamples.length < 10) summary.conflictSamples.push({ path: record.path, reason: "duplicate_identity_content_mismatch" });
        }
        continue;
      }
      seenCandidates.set(candidate.idempotencyKey, candidate.contentHash);

      const existing = await dependencies.getCanonical(candidate.idempotencyKey);
      const classification = classifyCanonical(existing, candidate, record.dateId);
      if (classification.action === "unchanged") {
        summary.unchanged += 1;
        continue;
      }
      if (classification.action === "conflict") {
        summary.conflicts += 1;
        if (summary.conflictSamples.length < 10) summary.conflictSamples.push({ path: record.path, reason: classification.reason });
        continue;
      }

      const now = dependencies.now ? dependencies.now() : new Date();
      if (classification.action === "create") {
        summary.created += 1;
        pending.push({
          action: "create",
          id: candidate.idempotencyKey,
          data: buildCreateData(record, candidate, now),
          expectedContentHash: null,
          checkpoint: record.checkpoint
        });
      } else {
        summary.repaired += 1;
        pending.push({
          action: "repair",
          id: candidate.idempotencyKey,
          data: buildRepairData(record, candidate, classification, now),
          expectedContentHash: classification.oldContentHash,
          checkpoint: record.checkpoint
        });
      }
      if (pending.length >= batchSize) await flush();
    } catch (error) {
      if (error.backfillFatal) throw error;
      summary.errors += 1;
      if (summary.errorSamples.length < 10) {
        summary.errorSamples.push({ path: record.path, code: error.code || null, message: error.message });
      }
    }
  }
  await flush();
  return summary;
}

module.exports = {
  MIGRATION_NAME,
  MIGRATION_VERSION,
  buildCandidate,
  buildCreateData,
  buildRepairData,
  classifyCanonical,
  executeLegacyBackfill,
  identityMatches,
  isSyntheticRecord,
  isVerifiedSourceTimestampRepair,
  oldUtcMidnightCandidate,
  validateOwnership
};
