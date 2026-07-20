function mapMyDoubleProgressToTimeLeft(record = {}) {
  return {
    ...record,
    sourceApp: "MyDoubleProgress",
    category: record.category || "progressRecord",
    progressDate: record.progressDate || record.dateId || record.date,
    title: record.title || "Daily progress",
    metadata: {
      metrics: record.metrics || {},
      ...(record.metadata || {})
    }
  };
}

module.exports = { mapMyDoubleProgressToTimeLeft };
