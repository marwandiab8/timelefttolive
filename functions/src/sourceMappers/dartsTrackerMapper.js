function mapDartsTrackerToTimeLeft(record = {}) {
  return {
    ...record,
    sourceApp: "DartstRacker2026",
    category: record.category || "dartsRecord",
    dartDate: record.dartDate || record.dateId || record.date,
    title: record.title || "Darts record",
    metadata: {
      games: record.games || [],
      scores: record.scores || [],
      stats: record.stats || {},
      ...(record.metadata || {})
    }
  };
}

module.exports = { mapDartsTrackerToTimeLeft };
