const DATE_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const DEFAULT_TIMEZONE = "America/Toronto";

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDateId(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatUtcDateId(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function isValidDateId(value) {
  if (typeof value !== "string" || !DATE_ID_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function invalidTimezoneError(timezone) {
  const error = new Error(`timezone '${timezone}' is not a valid IANA timezone.`);
  error.code = "validation_error";
  error.status = 400;
  return error;
}

function invalidDateError(fieldName) {
  const error = new Error(`${fieldName} must be an ISO-8601 timestamp.`);
  error.code = "validation_error";
  error.status = 400;
  return error;
}

function normalizeTimezone(value, fallback = DEFAULT_TIMEZONE) {
  const timezone = typeof value === "string" && value.trim() ? value.trim() : fallback;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(0));
  } catch (_error) {
    throw invalidTimezoneError(timezone);
  }
  return timezone;
}

function zonedParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  return Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

function timezoneOffsetMs(date, timezone) {
  const parts = zonedParts(date, timezone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const instantWithoutMilliseconds = Math.floor(date.getTime() / 1000) * 1000;
  return localAsUtc - instantWithoutMilliseconds;
}

function zonedDateTimeToDate(parts, timezoneValue) {
  const timezone = normalizeTimezone(timezoneValue);
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
    parts.millisecond || 0
  );
  let instant = new Date(desired);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = new Date(desired - timezoneOffsetMs(instant, timezone));
    if (next.getTime() === instant.getTime()) break;
    instant = next;
  }

  const resolved = zonedParts(instant, timezone);
  const matches = resolved.year === parts.year
    && resolved.month === parts.month
    && resolved.day === parts.day
    && resolved.hour === (parts.hour || 0)
    && resolved.minute === (parts.minute || 0)
    && resolved.second === (parts.second || 0);
  if (!matches) {
    const error = new Error("Local date-time does not exist in the supplied timezone.");
    error.code = "validation_error";
    error.status = 400;
    throw error;
  }
  return instant;
}

function dateIdToZonedDate(dateId, timezoneValue = DEFAULT_TIMEZONE) {
  if (!isValidDateId(dateId)) {
    const error = new Error("dateId must be a valid YYYY-MM-DD date.");
    error.code = "validation_error";
    error.status = 400;
    throw error;
  }
  const [year, month, day] = dateId.split("-").map(Number);
  return zonedDateTimeToDate({ year, month, day, hour: 0, minute: 0, second: 0, millisecond: 0 }, timezoneValue);
}

function parseDateInTimezone(value, timezoneValue = DEFAULT_TIMEZONE, fieldName = "date") {
  if (value === undefined || value === null || value === "") return null;
  const timezone = normalizeTimezone(timezoneValue);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw invalidDateError(fieldName);
    return value;
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw invalidDateError(fieldName);
    return parsed;
  }
  if (typeof value?.toDate === "function") {
    const parsed = value.toDate();
    if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) throw invalidDateError(fieldName);
    return parsed;
  }
  if (typeof value === "string" && isValidDateId(value)) {
    return dateIdToZonedDate(value, timezone);
  }
  if (typeof value === "string") {
    const localMatch = LOCAL_DATE_TIME_PATTERN.exec(value);
    if (localMatch) {
      const millisecond = Number(String(localMatch[7] || "0").padEnd(3, "0"));
      return zonedDateTimeToDate({
        year: Number(localMatch[1]),
        month: Number(localMatch[2]),
        day: Number(localMatch[3]),
        hour: Number(localMatch[4]),
        minute: Number(localMatch[5]),
        second: Number(localMatch[6] || 0),
        millisecond
      }, timezone);
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw invalidDateError(fieldName);
  }
  return parsed;
}

function dateLikeToDateId(value) {
  if (!value) return "";
  if (typeof value === "string") {
    if (isValidDateId(value)) return value;
    const dateOnly = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateOnly && isValidDateId(dateOnly[1])) return dateOnly[1];
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "" : formatUtcDateId(parsed);
  }
  if (value instanceof Date) return formatDateId(value);
  if (typeof value.toDate === "function") return formatDateId(value.toDate());
  if (typeof value.seconds === "number") return formatUtcDateId(new Date(value.seconds * 1000));
  return "";
}

function resolveDateId(item = {}) {
  const candidates = [
    "dateId",
    "reportDateKey",
    "dateKey",
    "workoutDate",
    "progressDate",
    "dartDate",
    "capturedAt",
    "originalCreatedAt",
    "createdAt",
    "uploadedAt"
  ];
  for (const field of candidates) {
    const dateId = dateLikeToDateId(item[field]);
    if (isValidDateId(dateId)) return { dateId, sourceField: field };
  }
  return { dateId: "", sourceField: "" };
}

module.exports = {
  DEFAULT_TIMEZONE,
  dateIdToZonedDate,
  dateLikeToDateId,
  formatDateId,
  isValidDateId,
  normalizeTimezone,
  parseDateInTimezone,
  resolveDateId
};
