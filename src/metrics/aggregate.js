const { computeCost } = require('./cost.js');
const { computeStatus } = require('./status.js');

function buildSessionCard(summary, { pricing, now, config }) {
  return {
    ...summary,
    status: computeStatus(summary, now, config),
    costUsd: computeCost(summary.tokens, summary.model, pricing),
  };
}

function buildOverview(cards) {
  const latencies = cards.map(c => c.avgResponseMs).filter(v => typeof v === 'number');
  const avgResponseMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;
  return {
    totalSessions: cards.length,
    runningSessions: cards.filter(c => c.status === 'running').length,
    totalTurns: cards.reduce((a, c) => a + (c.turns || 0), 0),
    totalInputTokens: cards.reduce((a, c) => a + (c.tokens.input || 0), 0),
    totalOutputTokens: cards.reduce((a, c) => a + (c.tokens.output || 0), 0),
    avgResponseMs,
    estimatedCostUsd: cards.reduce((a, c) => a + (c.costUsd || 0), 0),
  };
}

module.exports = { buildSessionCard, buildOverview };
