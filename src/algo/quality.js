// Incremental sampling-quality tracker: how regular a sensor stream was.
export function createRateTracker(gapMs) {
  return { count: 0, first: null, last: null, maxDt: 0, gaps: 0, gapMs };
}

export function trackSample(q, t) {
  if (q.last !== null) {
    const dt = t - q.last;
    if (dt > q.maxDt) q.maxDt = dt;
    if (dt > q.gapMs) q.gaps++;
  } else {
    q.first = t;
  }
  q.last = t;
  q.count++;
  return q;
}

export function rateSummary(q) {
  const span = q.last - q.first;
  return {
    count: q.count,
    hz: q.count > 1 && span > 0 ? ((q.count - 1) * 1000) / span : 0,
    maxDtMs: Math.round(q.maxDt),
    gaps: q.gaps,
    gapMs: q.gapMs,
  };
}

export function rateFromTimes(times, gapMs) {
  const q = createRateTracker(gapMs);
  for (const t of times) trackSample(q, t);
  return rateSummary(q);
}
