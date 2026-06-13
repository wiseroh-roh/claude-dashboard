function computeCost(tokens = {}, model, pricing) {
  const rates = (model && pricing[model]) || pricing.default;
  const input = (tokens.input || 0) / 1e6 * rates.input;
  const output = (tokens.output || 0) / 1e6 * rates.output;
  const cacheWrite = (tokens.cacheCreate || 0) / 1e6 * rates.cacheWrite;
  const cacheRead = (tokens.cacheRead || 0) / 1e6 * rates.cacheRead;
  return input + output + cacheWrite + cacheRead;
}

module.exports = { computeCost };
