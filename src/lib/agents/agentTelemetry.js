const metrics = { requests: 0, errors: 0, handoffs: 0, providers: { rules: 0, openai: 0 }, intents: {} };

export function recordAgentEvent({ intent, provider, requiresHumanReview, failed = false }) {
  metrics.requests += 1;
  if (failed) metrics.errors += 1;
  if (requiresHumanReview) metrics.handoffs += 1;
  metrics.providers[provider] = (metrics.providers[provider] || 0) + 1;
  metrics.intents[intent] = (metrics.intents[intent] || 0) + 1;
  console.info(JSON.stringify({ event: 'travel_agent', intent, provider, requiresHumanReview, failed }));
}

export function getAgentMetrics() { return structuredClone(metrics); }
