const {
  ingestLegacySingle,
  ingestLegacyBatch,
  ingestLifeEventSingle,
  ingestLifeEventBatch
} = require("./lifeEventFoundation");

function sendError(res, error) {
  const status = error.status || 500;
  res.status(status).json({ ok: false, error: error.message || "Ingestion failed." });
}

async function ingestOneRequest(db, req, res) {
  try {
    await ingestLegacySingle(db, req, res);
  } catch (error) {
    sendError(res, error);
  }
}

async function ingestBatchRequest(db, req, res) {
  try {
    await ingestLegacyBatch(db, req, res);
  } catch (error) {
    sendError(res, error);
  }
}

module.exports = {
  ingestBatchRequest,
  ingestOneRequest,
  ingestLifeEventSingle,
  ingestLifeEventBatch
};
