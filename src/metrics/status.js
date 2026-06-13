// Recency-based refinement of the spec heuristic. Error always wins; otherwise
// classify by how long ago the session last had activity.
function computeStatus(summary, now, config) {
  if (summary.hasError) return 'error';
  if (summary.lastTs == null) return 'idle';
  const age = now - summary.lastTs;
  if (age <= config.RUNNING_THRESHOLD_MS) return 'running';
  if (age <= config.IDLE_THRESHOLD_MS) return 'waiting';
  return 'idle';
}

module.exports = { computeStatus };
