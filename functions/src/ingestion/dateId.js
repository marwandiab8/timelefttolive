const DATE_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
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
  dateLikeToDateId,
  formatDateId,
  isValidDateId,
  resolveDateId
};
