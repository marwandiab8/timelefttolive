const { normalizeExternalItem } = require("./normalize");
const { validateBearerToken } = require("./tokens");

function bearerToken(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function validateMethod(req) {
  if (req.method !== "POST") {
    throw Object.assign(new Error("Use POST."), { status: 405 });
  }
}

function validateItemAgainstConnection(item, connection) {
  if (!item.sourceApp) throw Object.assign(new Error("item.sourceApp is required or unsupported."), { status: 400 });
  if (connection.sourceApp && item.sourceApp !== connection.sourceApp) {
    throw Object.assign(new Error("item.sourceApp does not match this source connection."), { status: 403 });
  }
  if (connection.sourceFirebaseProjectId && item.sourceFirebaseProjectId !== connection.sourceFirebaseProjectId) {
    throw Object.assign(new Error("item.sourceFirebaseProjectId does not match this source connection."), { status: 403 });
  }
  const allowedProjectIds = Array.isArray(connection.sourceProjectIds) ? connection.sourceProjectIds.filter(Boolean) : [];
  if (allowedProjectIds.length > 0 && (!item.sourceProjectId || !allowedProjectIds.includes(item.sourceProjectId))) {
    throw Object.assign(new Error("item.sourceProjectId is not allowed for this source connection."), { status: 403 });
  }
}

async function validateIngestionRequest(db, req, itemRequired = true) {
  validateMethod(req);
  const { calendarId, connectionId, item, items } = req.body || {};
  const authContext = await validateBearerToken(db, bearerToken(req), calendarId, connectionId);
  const baseContext = {
    calendarId,
    connectionId,
    ownerUid: authContext.calendar.ownerUid,
    connectionRef: authContext.connectionRef
  };
  if (itemRequired) {
    const normalized = normalizeExternalItem(item || {}, baseContext);
    validateItemAgainstConnection(normalized, authContext.connection);
    return { item, normalized, context: baseContext, connection: authContext.connection };
  }
  return { items, context: baseContext, connection: authContext.connection };
}

module.exports = {
  validateIngestionRequest,
  validateItemAgainstConnection
};
