function mapGridlineAiToTimeLeft(record = {}) {
  return {
    ...record,
    sourceApp: "gridlineai",
    category: record.category || (record.contentType && String(record.contentType).startsWith("image/") ? "projectPicture" : "projectReport"),
    dateId: record.dateId || record.reportDateKey || record.dateKey || record.journalDate,
    title: record.title || record.reportTitle || "gridlineai record"
  };
}

module.exports = { mapGridlineAiToTimeLeft };
