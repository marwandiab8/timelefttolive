function mapGymK2ToTimeLeft(record = {}) {
  const exerciseSummaries = Array.isArray(record.exerciseSummaries)
    ? record.exerciseSummaries
    : Array.isArray(record.exercises)
      ? record.exercises
      : [];
  const focus = Array.isArray(record.focus) ? record.focus : [];
  return {
    ...record,
    sourceApp: "GYM-K2",
    category: record.category || "workout",
    summary: record.summary || record.workoutName || "Workout",
    description: record.description || record.notes || record.summary || '',
    workoutDate: record.workoutDate || record.dateId || record.date,
    title: record.title || record.workoutName || "Workout",
    sourceProjectName: record.sourceProjectName || "GYM-K2",
    metadata: {
      exerciseSummaries,
      exerciseCount: Number(record.exerciseCount || exerciseSummaries.length || 0),
      focus,
      unit: typeof record.unit === "string" ? record.unit : "lb",
      notes: typeof record.notes === "string" ? record.notes : "",
      durationMinutes: record.durationMinutes || null,
      stats: record.stats || {},
      ...(record.metadata || {}),
      source: "GYM-K2",
    }
  };
}

module.exports = { mapGymK2ToTimeLeft };
