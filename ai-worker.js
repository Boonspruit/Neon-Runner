self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'SCORE_OPTIONS') return;

  const { requestId, options } = data;
  let best = null;
  let bestScore = -Infinity;

  for (const entry of options || []) {
    let score = 0;
    score -= entry.danger;
    score += entry.distToFuture;
    score += entry.wallIntercept * (1.05 + entry.aggro * 0.35);
    score += entry.ramming * (1.0 + entry.aggro * 0.25);
    score += entry.freeSpace * 0.95;
    score += entry.exitScore;
    if (entry.preferred) score += 18 + entry.aggro * 8;
    score -= entry.loopPenalty;
    score -= entry.ownTrap ? 260 : 0;
    score += entry.noise * 0.35;
    score += entry.randomJitter;

    if (score > bestScore) {
      bestScore = score;
      best = entry.opt;
    }
  }

  self.postMessage({ type: 'SCORED_OPTIONS', requestId, best });
});
