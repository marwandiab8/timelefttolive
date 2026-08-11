const { validateBearerToken } = require("./tokens");
const { normalizeExternalItem } = require("./normalize");
const {
  DEFAULT_TIMEZONE,
  dateIdToZonedDate,
  normalizeTimezone,
  parseDateInTimezone,
  resolveDateId,
  isValidDateId
} = require("./dateId");
const { sha256 } = require("./dedupe");
const { validateIngestionRequest } = require("./validateIngestionRequest");
const { upsertExternalItem } = require("./upsertExternalItem");

const MAX_BATCH_SIZE = 100;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = MAX_PAYLOAD_BYTES;
const RAW_AUDIT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const DEAD_LETTER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_QUERY_LIMIT = 100;
const CLEANUP_WRITE_BATCH_SIZE = 50;

const ALLOWED_EVENT_CLASSES = [
  "activity_boundary",
  "completed_activity",
  "location",
  "achievement",
  "project",
  "system"
];

const EVENT_CLASS_BY_EVENT_TYPE = {
  arrive_work: "activity_boundary",
  leave_work: "activity_boundary",
  start_workout: "activity_boundary",
  finish_workout: "activity_boundary",
  completed_workout: "completed_activity",
  completed_gym_workout: "completed_activity",
  completed_darts_match: "completed_activity",
  completed_darts_practice: "completed_activity"
};

const LEGACY_CLASS_BY_CATEGORY = {
  constructionReport: "project",
  projectReport: "project",
  journal: "project",
  workout: "completed_activity",
  dartsRecord: "completed_activity",
  progressRecord: "achievement",
  projectPicture: "system",
  image: "system",
  file: "system",
  link: "system",
  other: "system"
};

const SECRET_KEY_PATTERNS = [
  /authorization/i,
  /auth(?:entication)?(?:[-_ ]?token)?/i,
  /api[_-]?key/i,
  /secret/i,
  /credential/i,
  /password/i,
  /^token$/i
];

function parseAuthorization(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function toTrimmedString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function isSecretKey(key) {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function sanitizeForStorage(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeForStorage(entry))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value === "object") {
    const sanitized = {};
    for (const [key, child] of Object.entries(value)) {
      if (!isSecretKey(key)) sanitized[key] = sanitizeForStorage(child);
    }
    return sanitized;
  }
  return value;
}

function payloadError(message, code = "validation_error") {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function payloadTooLarge(payload, maxBytes = MAX_PAYLOAD_BYTES) {
  return Buffer.byteLength(JSON.stringify(payload || {}), "utf8") > maxBytes;
}

function stableStringify(value) {
  if (value === null || value === undefined) return String(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((child) => stableStringify(child)).join(",")}]`;
  if (typeof value !== "object") return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function buildHash(value) {
  return sha256(stableStringify(value));
}

function normalizeLocation(raw, path = "location") {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw) || typeof raw !== "object") {
    throw payloadError(`${path} must be an object.`);
  }
  const latitude = raw.latitude;
  const longitude = raw.longitude;
  const hasLatitude = latitude !== undefined && latitude !== null;
  const hasLongitude = longitude !== undefined && longitude !== null;
  if (hasLatitude !== hasLongitude) {
    throw payloadError(`${path} requires latitude and longitude together.`);
  }
  const location = {
    label: toTrimmedString(raw.label),
    placeId: toTrimmedString(raw.placeId),
    source: toTrimmedString(raw.source)
  };
  if (hasLatitude) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw payloadError(`${path}.latitude must be between -90 and 90.`);
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw payloadError(`${path}.longitude must be between -180 and 180.`);
    }
    location.latitude = lat;
    location.longitude = lng;
  }
  if (raw.accuracyMeters !== undefined) {
    const accuracyMeters = Number(raw.accuracyMeters);
    if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
      throw payloadError(`${path}.accuracyMeters must be zero or a positive number.`);
    }
    location.accuracyMeters = accuracyMeters;
  }
  return location;
}

function normalizeObject(value, name) {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw payloadError(`${name} must be an object.`);
  }
  return sanitizeForStorage(value);
}

function inferEventClass(payload) {
  const explicit = toTrimmedString(payload.eventClass);
  if (explicit) {
    if (!ALLOWED_EVENT_CLASSES.includes(explicit)) {
      throw payloadError(`eventClass '${explicit}' is not supported.`);
    }
    return explicit;
  }
  const eventType = toTrimmedString(payload.eventType);
  return EVENT_CLASS_BY_EVENT_TYPE[eventType] || "system";
}

function requirePositiveInteger(value, message) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw payloadError(message);
  }
  return parsed;
}

function buildContentHash(payload) {
  return buildHash({
    schemaVersion: payload.schemaVersion,
    integrationId: payload.integrationId,
    sourceApp: payload.sourceApp,
    sourceProjectId: payload.sourceProjectId,
    sourceUserId: payload.sourceUserId,
    sourceRecordId: payload.sourceRecordId,
    sourceEventId: payload.sourceEventId,
    eventType: payload.eventType,
    eventClass: payload.eventClass,
    activityFamily: payload.activityFamily,
    categoryId: payload.categoryId,
    title: payload.title,
    occurredAt: payload.occurredAt,
    startAt: payload.startAt,
    endAt: payload.endAt,
    durationSeconds: payload.durationSeconds,
    timezone: payload.timezone,
    location: payload.location,
    metrics: payload.metrics,
    metadata: payload.metadata,
    privacyLevel: payload.privacyLevel
  });
}

function buildIdempotencyKey(payload) {
  const sourceKey = toTrimmedString(payload.sourceEventId || payload.sourceRecordId);
  return buildHash(`${payload.integrationId}:${payload.schemaVersion}:${sourceKey}`);
}

function validateSourcePermissions(connection, payload) {
  const safeConnection = connection || {};
  const sourceApp = payload.sourceApp;
  const sourceFirebaseProjectId = toTrimmedString(payload.sourceFirebaseProjectId);
  const sourceProjectId = toTrimmedString(payload.sourceProjectId);
  if (safeConnection.sourceApp && sourceApp && safeConnection.sourceApp !== sourceApp) {
    throw payloadError("item.sourceApp does not match this source connection.");
  }
  if (
    safeConnection.sourceFirebaseProjectId &&
    sourceFirebaseProjectId &&
    safeConnection.sourceFirebaseProjectId !== sourceFirebaseProjectId
  ) {
    throw payloadError("item.sourceFirebaseProjectId does not match this source connection.");
  }
  const allowedProjectIds = Array.isArray(safeConnection.sourceProjectIds)
    ? safeConnection.sourceProjectIds.filter(Boolean)
    : [];
  if (allowedProjectIds.length > 0 && sourceProjectId && !allowedProjectIds.includes(sourceProjectId)) {
    throw payloadError("source project is not allowed for this source connection.");
  }
  const allowedEventClasses = Array.isArray(safeConnection.permissions?.eventClasses)
    ? safeConnection.permissions.eventClasses.filter(Boolean)
    : [];
  if (allowedEventClasses.length > 0 && !allowedEventClasses.includes(payload.eventClass)) {
    throw payloadError("eventClass is not allowed for this source connection.");
  }
}

function normalizeLifeEventRecord(raw, context) {
  if (payloadTooLarge(raw)) {
    throw payloadError("Payload too large.");
  }

  const schemaVersion = requirePositiveInteger(raw.schemaVersion, "schemaVersion is required and must be a positive integer.");

  const sourceApp = toTrimmedString(raw.sourceApp);
  if (!sourceApp) {
    throw payloadError("sourceApp is required.");
  }

  const eventType = toTrimmedString(raw.eventType);
  if (!eventType) {
    throw payloadError("eventType is required.");
  }

  const sourceRecordId = toTrimmedString(raw.sourceRecordId);
  const sourceEventId = toTrimmedString(raw.sourceEventId);
  if (!sourceRecordId && !sourceEventId) {
    throw payloadError("sourceRecordId or sourceEventId is required.");
  }

  const timezone = normalizeTimezone(toTrimmedString(raw.timezone, DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE);
  const occurredAt = parseDateInTimezone(raw.occurredAt, timezone, "occurredAt");
  const startAt = parseDateInTimezone(raw.startAt, timezone, "startAt");
  const endAt = parseDateInTimezone(raw.endAt, timezone, "endAt");

  if (!occurredAt && !startAt) {
    throw payloadError("occurredAt or startAt is required.");
  }

  let durationSeconds = raw.durationSeconds === undefined ? null : Number(raw.durationSeconds);
  if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds < 0)) {
    throw payloadError("durationSeconds must be zero or positive.");
  }

  if (startAt && endAt && endAt < startAt) {
    throw payloadError("endAt must not be before startAt.");
  }

  if (startAt && endAt) {
    const computed = Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 1000));
    if (durationSeconds === null) {
      durationSeconds = computed;
    } else if (Math.abs(durationSeconds - computed) > 0) {
      throw payloadError("durationSeconds conflicts with startAt/endAt.");
    }
  }

  const eventClass = inferEventClass(raw);
  const privacyLevel = raw.privacyLevel === "viewers" ? "viewers" : "ownerOnly";

  const eventPayload = {
    schemaVersion,
    integrationId: context.integrationId,
    calendarId: context.calendarId,
    connectionId: context.connectionId,
    timeLeftUserId: context.timeLeftUserId,
    sourceApp,
    sourceFirebaseProjectId: toTrimmedString(raw.sourceFirebaseProjectId),
    sourceProjectId: toTrimmedString(raw.sourceProjectId),
    sourceUserId: toTrimmedString(raw.sourceUserId),
    sourceRecordId,
    sourceEventId,
    eventType,
    eventClass,
    activityFamily: toTrimmedString(raw.activityFamily),
    categoryId: toTrimmedString(raw.categoryId),
    title: toTrimmedString(raw.title, `Life event (${eventType})`),
    occurredAt: occurredAt || startAt,
    startAt,
    endAt,
    durationSeconds,
    timezone,
    location: normalizeLocation(raw.location, "location"),
    metrics: normalizeObject(raw.metrics, "metrics"),
    metadata: normalizeObject(raw.metadata, "metadata"),
    privacyLevel
  };

  validateSourcePermissions(context.connection, {
    sourceApp: eventPayload.sourceApp,
    sourceProjectId: eventPayload.sourceProjectId,
    eventClass
  });

  eventPayload.idempotencyKey = buildIdempotencyKey(eventPayload);
  eventPayload.contentHash = buildContentHash(eventPayload);
  return eventPayload;
}

function buildRawAuditRecord(payload, context) {
  const sourceFirebaseProjectId = toTrimmedString(payload.sourceFirebaseProjectId);
  const receivedAt = new Date();
  return {
    calendarId: context.calendarId,
    timeLeftUserId: context.timeLeftUserId,
    connectionId: context.connectionId,
    integrationId: context.integrationId,
    sourceApp: payload.sourceApp,
    sourceProjectId: payload.sourceProjectId,
    sourceUserId: payload.sourceUserId,
    sourceEventId: payload.sourceEventId,
    sourceRecordId: payload.sourceRecordId,
    eventType: payload.eventType,
    eventClass: payload.eventClass,
    schemaVersion: payload.schemaVersion,
    payloadHash: payload.contentHash,
    receivedAt,
    expiresAt: new Date(receivedAt.getTime() + RAW_AUDIT_TTL_MS),
    status: "received",
    payload: {
      title: payload.title,
      sourceApp: payload.sourceApp,
      sourceProjectId: payload.sourceProjectId,
      sourceFirebaseProjectId,
      eventType: payload.eventType
    },
    payloadSummary: {
      title: payload.title,
      eventType: payload.eventType,
      sourceFirebaseProjectId,
      occurredAt: payload.occurredAt
    }
  };
}

function buildDeadLetterRecord(payload, context, error, payloadHash) {
  const now = new Date();
  return {
    calendarId: context.calendarId,
    timeLeftUserId: context.timeLeftUserId,
    connectionId: context.connectionId,
    integrationId: context.integrationId,
    sourceApp: payload.sourceApp,
    sourceIdentifier: payload.sourceRecordId || payload.sourceEventId || "unknown",
    errorCode: error.code || "internal_error",
    errorSummary: toTrimmedString(error.message, "internal processing failure"),
    payloadHash,
    firstFailedAt: payload._firstFailedAt || now,
    lastFailedAt: now,
    retryCount: Number(payload._retryCount || 0) + 1,
    status: "retrying",
    expiresAt: new Date(now.getTime() + DEAD_LETTER_TTL_MS)
  };
}

async function appendDeadLetter(db, payload, context, error, payloadHash) {
  const deadLetterId = buildHash(`${context.calendarId}:${context.connectionId}:${payloadHash}`);
  const docRef = db.collection("lifeCalendars").doc(context.calendarId).collection("ingestionDeadLetters").doc(deadLetterId);
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(docRef);
    if (!existing.exists) {
      tx.set(docRef, buildDeadLetterRecord(payload, context, error, payloadHash));
      return;
    }
    const previous = existing.data() || {};
    const merged = buildDeadLetterRecord(payload, context, error, payloadHash);
    merged.retryCount = (Number.isFinite(previous.retryCount) ? Number(previous.retryCount) : 0) + 1;
    merged.firstFailedAt = previous.firstFailedAt || merged.firstFailedAt;
    tx.set(docRef, merged, { merge: true });
  });
}

async function upsertLifeEventRecord(db, payload) {
  const calendarRef = db.collection("lifeCalendars").doc(payload.calendarId);
  const eventRef = calendarRef.collection("lifeEvents").doc(payload.idempotencyKey);
  const rawRef = calendarRef.collection("rawIngestionPayloads").doc(payload.idempotencyKey);

  const now = new Date();

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(eventRef);
    if (existing.exists) {
      const data = existing.data() || {};
      if (data.contentHash !== payload.contentHash) {
        const err = new Error("Idempotency conflict for the same key.");
        err.code = "idempotency_conflict";
        err.status = 409;
        err.existingLifeEventId = existing.id;
        throw err;
      }
      return {
        status: "duplicate",
        duplicate: true,
        lifeEventId: eventRef.id,
        idempotencyKey: payload.idempotencyKey,
        schemaVersion: payload.schemaVersion,
        receivedAt: data.receivedAt || now
      };
    }

    tx.set(eventRef, {
      id: eventRef.id,
      ...payload,
      ingestionStatus: "received",
      receivedAt: now,
      createdAt: now,
      updatedAt: now
    });
    tx.set(rawRef, buildRawAuditRecord(payload, {
      ...payload
    }));

    return {
      status: "created",
      duplicate: false,
      lifeEventId: eventRef.id,
      idempotencyKey: payload.idempotencyKey,
      schemaVersion: payload.schemaVersion,
      receivedAt: now
    };
  });
}

function normalizeResponseTime(dateValue) {
  return dateValue instanceof Date ? dateValue.toISOString() : dateValue;
}

function sendError(res, error) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  const code = error.code || "server_error";
  const body = {
    status: "error",
    code,
    message: status >= 500 ? "Internal ingestion failure." : (error.message || "Request failed.")
  };
  if (Array.isArray(error.fieldErrors)) {
    body.fieldErrors = error.fieldErrors;
  }
  if (error.existingLifeEventId) {
    body.existingLifeEventId = error.existingLifeEventId;
  }
  return res.status(status).json(body);
}

function isValidationFailure(error) {
  const validationCodes = new Set([
    "validation_error",
    "auth_error",
    "method_not_allowed",
    "idempotency_conflict"
  ]);
  if (validationCodes.has(error.code)) return true;
  return [400, 401, 403, 405].includes(error.status);
}

function assertMethod(req) {
  if (req.method !== "POST") {
    const err = payloadError("Use POST.", "method_not_allowed");
    err.status = 405;
    throw err;
  }
}

async function resolveAuth(db, req, allowMissingIntegrationId = false) {
  assertMethod(req);
  const body = req.body || {};
  if (payloadTooLarge(body, MAX_REQUEST_BYTES)) {
    const error = payloadError("Payload too large.");
    error.status = 413;
    error.code = "validation_error";
    throw error;
  }

  const calendarId = toTrimmedString(body.calendarId);
  const connectionId = toTrimmedString(body.connectionId);
  const integrationId = toTrimmedString(body.integrationId);
  const token = parseAuthorization(req);

  if (!calendarId) {
    const error = payloadError("calendarId is required.");
    error.status = 400;
    throw error;
  }
  if (!connectionId) {
    const error = payloadError("connectionId is required.");
    error.status = 400;
    throw error;
  }
  if (!allowMissingIntegrationId && !integrationId) {
    const error = payloadError("integrationId is required.");
    error.status = 400;
    throw error;
  }

  const auth = await validateBearerToken(db, token, calendarId, connectionId, { integrationId });
  const resolvedIntegrationId = auth.connection?.integrationId || auth.connectionId || connectionId;

  if (!allowMissingIntegrationId && integrationId !== resolvedIntegrationId) {
    const error = new Error("integrationId does not match connection registry.");
    error.code = "auth_error";
    error.status = 403;
    throw error;
  }

  if (auth.connection && auth.connection.tokenStatus === "revoked") {
    const error = new Error("Ingestion token is revoked.");
    error.code = "auth_error";
    error.status = 403;
    throw error;
  }

  return {
    calendarId,
    connectionId,
    calendar: auth.calendar,
    connection: auth.connection,
    integrationId: resolvedIntegrationId,
    timeLeftUserId: (auth.connection && auth.connection.timeLeftUserId) || auth.calendar.ownerUid || ""
  };
}

async function ingestLifeEventSingle(db, req, res, options = {}) {
  let auth;
  try {
    auth = await resolveAuth(db, req, options.allowMissingIntegrationId);
    const body = req.body || {};
    const payload = body.item && typeof body.item === "object"
      ? { ...body.item }
      : { ...body };

    const normalized = normalizeLifeEventRecord(payload, {
      calendarId: auth.calendarId,
      connectionId: auth.connectionId,
      connection: auth.connection,
      integrationId: auth.integrationId,
      timeLeftUserId: auth.timeLeftUserId
    });

    const result = await upsertLifeEventRecord(db, normalized);
    return res.status(200).json({
      status: "success",
      lifeEventId: result.lifeEventId,
      idempotencyKey: result.idempotencyKey,
      duplicate: result.duplicate,
      schemaVersion: result.schemaVersion,
      receivedAt: normalizeResponseTime(result.receivedAt)
    });
  } catch (error) {
    if (!isValidationFailure(error) && auth) {
      const body = req.body || {};
      const payload = body.item && typeof body.item === "object"
        ? { ...body.item }
        : { ...body };
      const payloadHash = buildHash(payload);
      try {
        await appendDeadLetter(db, payload, {
          calendarId: auth.calendarId,
          connectionId: auth.connectionId,
          integrationId: auth.integrationId,
          timeLeftUserId: auth.timeLeftUserId,
          connection: auth.connection
        }, error, payloadHash);
      } catch (deadLetterError) {
        deadLetterError;
      }
    }
    return sendError(res, error);
  }
}

async function ingestLifeEventBatch(db, req, res, options = {}) {
  try {
    const auth = await resolveAuth(db, req, options.allowMissingIntegrationId);
    const body = req.body || {};
    const items = body.items;

    if (!Array.isArray(items)) {
      const err = payloadError("items must be an array.");
      err.status = 400;
      throw err;
    }
    if (items.length > MAX_BATCH_SIZE) {
      const err = payloadError("Batch limit is 100 items.");
      err.status = 400;
      throw err;
    }

    const summary = {
      total: items.length,
      success: 0,
      duplicates: 0,
      failed: 0,
      conflict: 0
    };
    const results = [];

    for (const [index, rawItem] of items.entries()) {
      const item = rawItem || {};
      try {
        const normalized = normalizeLifeEventRecord(item, {
          calendarId: auth.calendarId,
          connectionId: auth.connectionId,
          connection: auth.connection,
          integrationId: auth.integrationId,
          timeLeftUserId: auth.timeLeftUserId
        });
        const result = await upsertLifeEventRecord(db, normalized);
        summary.success += 1;
        if (result.duplicate) summary.duplicates += 1;
        results.push({
          index,
          clientReference: item.clientReference || null,
          status: "success",
          lifeEventId: result.lifeEventId,
          idempotencyKey: result.idempotencyKey,
          duplicate: result.duplicate,
          schemaVersion: result.schemaVersion,
          receivedAt: normalizeResponseTime(result.receivedAt)
        });
      } catch (error) {
        summary.failed += 1;
        if (error.code === "idempotency_conflict") summary.conflict += 1;
        const isValidation = isValidationFailure(error);
        if (!isValidation) {
          await appendDeadLetter(db, item, {
            calendarId: auth.calendarId,
            connectionId: auth.connectionId,
            integrationId: auth.integrationId,
            timeLeftUserId: auth.timeLeftUserId,
            connection: auth.connection
          }, error, buildHash(item));
        }
        results.push({
          index,
          clientReference: item.clientReference || null,
          status: "error",
          code: error.code || "server_error",
          message: isValidation ? error.message : "Internal ingestion failure.",
          existingLifeEventId: error.existingLifeEventId || null
        });
      }
    }

    return res.status(200).json({
      status: summary.failed > 0 ? "partial_success" : "success",
      ...summary,
      results
    });
  } catch (error) {
    return sendError(res, error);
  }
}

function mapLegacyToLifeEvent(record, context) {
  const mapped = normalizeExternalItem(record, {
    calendarId: context.calendarId,
    connectionId: context.connectionId,
    ownerUid: context.timeLeftUserId,
    createdByUid: `legacy:${record.sourceApp || "source"}`,
    updatedByUid: `legacy:${record.sourceApp || "source"}`
  });

  const dateParts = resolveDateId(mapped);
  if (!dateParts.dateId && !mapped.originalCreatedAt && !mapped.createdAt) return null;

  const dateId = dateParts.dateId || "";
  const timezone = normalizeTimezone(toTrimmedString(record.timezone, DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE);
  const occurredAt = dateId && isValidDateId(dateId)
    ? dateIdToZonedDate(dateId, timezone)
    : null;

  const sourceKey = mapped.sourceEventId
    || mapped.sourceRecordId
    || mapped.sourceDocumentPath
    || mapped.sourceDocumentId
    || mapped.sourceUrl
    || mapped.sourceStoragePath
    || mapped.externalItemId
    || `${mapped.sourceApp || "legacy"}-${mapped.calendarId || "default"}-${mapped.createdByUid || "legacy"}`;

  const category = mapped.category || "other";
  const eventClass = LEGACY_CLASS_BY_CATEGORY[category] || "system";

  const event = {
    schemaVersion: 1,
    sourceApp: mapped.sourceApp,
    sourceFirebaseProjectId: mapped.sourceFirebaseProjectId,
    sourceProjectId: mapped.sourceProjectId || "",
    sourceUserId: toTrimmedString(record.sourceUserId),
    sourceRecordId: mapped.sourceRecordId || mapped.sourceDocumentPath || mapped.sourceDocumentId || mapped.externalItemId,
    sourceEventId: sourceKey,
    eventType: toTrimmedString(record.eventType, category),
    eventClass,
    activityFamily: toTrimmedString(record.activityFamily || category),
    categoryId: toTrimmedString(category),
    title: mapped.title || `Legacy ${category}`,
    occurredAt,
    startAt: parseDateInTimezone(mapped.capturedAt, timezone, "capturedAt") || occurredAt,
    endAt: null,
    durationSeconds: null,
    timezone,
    location: normalizeLocation(record.location || {}, "location") || null,
    metrics: normalizeObject(record.metrics || {}, "metrics"),
    metadata: {
      ...(normalizeObject(record.metadata || {}, "metadata") || {}),
      legacySourceType: `legacy:${mapped.sourceApp || "unknown"}`
    },
    privacyLevel: mapped.visibility === "viewers" ? "viewers" : "ownerOnly",
    integrationId: context.integrationId,
    calendarId: context.calendarId,
    connectionId: context.connectionId,
    timeLeftUserId: context.timeLeftUserId,
    legacySourceType: `legacy:${mapped.sourceApp || "legacy"}`
  };

  if (!event.occurredAt) return null;

  event.idempotencyKey = buildIdempotencyKey(event);
  event.contentHash = buildContentHash(event);
  validateSourcePermissions(context.connection || {}, {
    sourceApp: event.sourceApp,
    sourceProjectId: event.sourceProjectId,
    eventClass
  });

  return event;
}

async function ingestLegacySingle(db, req, res) {
  try {
    const { item, normalized, context, connection } = await validateIngestionRequest(db, req, true);
    const legacyResult = await upsertExternalItem(db, item || normalized, context);
    const canonicalPayload = mapLegacyToLifeEvent(item || normalized, {
      calendarId: context.calendarId,
      connectionId: context.connectionId,
      integrationId: connection?.integrationId || context.connectionId,
      timeLeftUserId: context.ownerUid,
      connection
    });

    if (!canonicalPayload) {
      return res.status(200).json({
        ok: true,
        ...legacyResult,
        canonicalIngestion: "skipped"
      });
    }

    try {
      const canonicalResult = await upsertLifeEventRecord(db, canonicalPayload);
      return res.status(200).json({
        ok: true,
        ...legacyResult,
        lifeEventId: canonicalResult.lifeEventId,
        idempotencyKey: canonicalResult.idempotencyKey,
        canonicalDuplicate: canonicalResult.duplicate
      });
    } catch (error) {
      if (error.code === "idempotency_conflict" || error.code === "validation_error") {
        return res.status(200).json({
          ok: true,
          ...legacyResult,
          canonicalIngestion: "failed",
          canonicalError: error.message
        });
      }
      const body = req.body || {};
      await appendDeadLetter(db, body, {
        calendarId: body.calendarId,
        connectionId: body.connectionId,
        integrationId: connection?.integrationId,
        timeLeftUserId: context.ownerUid,
        connection
      }, error, buildHash(body));
      return res.status(200).json({
        ok: true,
        ...legacyResult,
        canonicalIngestion: "failed"
      });
    }
  } catch (error) {
    return sendError(res, error);
  }
}

async function ingestLegacyBatch(db, req, res) {
  try {
    const { items, context, connection } = await validateIngestionRequest(db, req, false);
    if (!Array.isArray(items)) {
      const err = payloadError("items must be an array.");
      err.status = 400;
      throw err;
    }
    const results = [];
    const summary = {
      created: 0,
      updated: 0,
      moved: 0,
      skipped: 0,
      needsDateReview: 0,
      errors: []
    };

    for (const [index, item] of items.entries()) {
      try {
        const legacyResult = await upsertExternalItem(db, item, context);
        summary.created = legacyResult.status === "created" ? summary.created + 1 : summary.created;
        summary.updated = legacyResult.status === "updated" ? summary.updated + 1 : summary.updated;
        summary.moved = legacyResult.status === "moved" ? summary.moved + 1 : summary.moved;
        summary.needsDateReview = legacyResult.status === "needsDateReview" ? summary.needsDateReview + 1 : summary.needsDateReview;

        const canonicalPayload = mapLegacyToLifeEvent(item, {
          calendarId: context.calendarId,
          connectionId: context.connectionId,
          connection,
          integrationId: connection?.integrationId || context.connectionId,
          timeLeftUserId: context.ownerUid
        });
        if (canonicalPayload) {
          const canonicalResult = await upsertLifeEventRecord(db, canonicalPayload);
          results.push({ index, status: "success", lifeEventId: canonicalResult.lifeEventId, legacy: legacyResult.status });
        } else {
          results.push({ index, status: "success", canonicalIngestion: "skipped", legacy: legacyResult.status });
        }
      } catch (error) {
        summary.skipped += 1;
        summary.errors.push({ index, message: error.message });
        results.push({ index, status: "error", code: error.code || "server_error", message: error.message });
      }
    }

    return res.status(200).json({ ok: true, ...summary, results });
  } catch (error) {
    return sendError(res, error);
  }
}

async function cleanupLifeEventArtifacts(db) {
  const now = new Date();
  const rawDeleted = await deleteExpiredCollectionGroupDocuments(db, "rawIngestionPayloads", now);
  const deadLetterDeleted = await deleteExpiredCollectionGroupDocuments(db, "ingestionDeadLetters", now);
  return { rawDeleted, deadLetterDeleted, totalDeleted: rawDeleted + deadLetterDeleted };
}

function chunk(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) {
    result.push(values.slice(i, i + size));
  }
  return result;
}

function logCleanupWarning(details) {
  console.warn("cleanupLifeEventArtifacts warning:", details);
}

async function deleteInBatches(db, refs) {
  let deleted = 0;
  const chunks = chunk(refs, CLEANUP_WRITE_BATCH_SIZE);

  for (const refsChunk of chunks) {
    let chunkDeleted = 0;
    if (typeof db.batch === "function") {
      const batch = db.batch();
      for (const ref of refsChunk) {
        batch.delete(ref);
      }
      try {
        await batch.commit();
        deleted += refsChunk.length;
        continue;
      } catch (error) {
        logCleanupWarning({
          collection: refsChunk[0]?.path?.split("/")[1] || "unknown",
          count: refsChunk.length,
          message: error.message
        });
      }
    }

    for (const ref of refsChunk) {
      try {
        await ref.delete();
        chunkDeleted += 1;
      } catch (error) {
        logCleanupWarning({
          collection: refsChunk[0]?.path?.split("/")[1] || "unknown",
          path: ref.path,
          message: error.message
        });
      }
    }
    deleted += chunkDeleted;
  }

  return deleted;
}

async function deleteExpiredCollectionGroupDocuments(db, collectionName, now) {
  let deletedTotal = 0;
  let loops = 0;

  while (loops < 20) {
    const snapshot = await db.collectionGroup(collectionName)
      .where("expiresAt", "<=", now)
      .limit(CLEANUP_QUERY_LIMIT)
      .get();

    if (!snapshot || snapshot.docs.length === 0) {
      break;
    }

    const refs = snapshot.docs
      .filter((docSnap) => docSnap.exists)
      .map((docSnap) => docSnap.ref)
      .filter(Boolean);

    if (refs.length === 0) {
      break;
    }

    const deleted = await deleteInBatches(db, refs);
    deletedTotal += deleted;

    if (deleted === 0 || deleted < snapshot.docs.length) {
      break;
    }

    loops += 1;
  }

  return deletedTotal;
}

module.exports = {
  buildHash,
  normalizeLifeEventRecord,
  buildIdempotencyKey,
  buildContentHash,
  mapLegacyToLifeEvent,
  ingestLifeEventSingle,
  ingestLifeEventBatch,
  ingestLegacySingle,
  ingestLegacyBatch,
  upsertLifeEventRecord,
  appendDeadLetter,
  cleanupLifeEventArtifacts
};
