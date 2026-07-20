const assert = require("node:assert/strict");
const test = require("node:test");
const admin = require("firebase-admin");

const [hostingHost = "127.0.0.1", hostingPort = "5000"] = (process.env.FIREBASE_HOSTING_EMULATOR_HOST
  || process.env.HOSTING_EMULATOR_HOST
  || "127.0.0.1:5000").split(":");
const basePath = `http://${hostingHost}:${hostingPort}`;
const lifeEventPath = "/api/v1/life-events";
const lifeEventBatchPath = "/api/v1/life-events:batch";

async function callHostingApi(route, options = {}) {
  const response = await fetch(`${basePath}${route}`, {
    method: options.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(text);
  } catch (_error) {
    payload = {};
  }
  return { status: response.status, payload };
}

function assertRequestFailure(response) {
  assert.ok(response.status >= 400 && response.status < 500, `expected client error, got ${response.status}`);
  assert.equal(response.payload.status, "error");
}

test.before(async () => {
  const hasAppApi = admin.apps && Array.isArray(admin.apps);
  if (!hasAppApi || !admin.apps.length) {
    const projectId = "timelefttolive-hosting-verification";
    admin.initializeApp({
      projectId
    });
  }
});

test("POST /api/v1/life-events maps through hosting", async () => {
  const response = await callHostingApi(lifeEventPath);
  assertRequestFailure(response);
  assert.ok(response.status !== 404);
});

test("POST /api/v1/life-events:batch maps through hosting", async () => {
  const response = await callHostingApi(lifeEventBatchPath);
  assertRequestFailure(response);
  assert.ok(response.status !== 404);
});

test("non-POST routes return 405", async () => {
  const single = await callHostingApi(lifeEventPath, { method: "GET" });
  const batch = await callHostingApi(lifeEventBatchPath, { method: "PATCH" });
  assert.equal(single.status, 405);
  assert.equal(batch.status, 405);
});

test("invalid token still returns safe authentication response", async () => {
  const tokenResponse = await callHostingApi(lifeEventPath, {
    headers: {
      Authorization: "Bearer invalid-token"
    }
  });
  assertRequestFailure(tokenResponse);
  assert.ok(tokenResponse.status !== 500);
});

console.info(`hosting verification using emulator host ${basePath}`);
