const LATENCY_TIE_WINDOW_MS = 50;

function normalizeBrowserResult(result) {
  if (!result) {
    return { ok: false, latencyMs: null };
  }
  return {
    ok: result.ok === true,
    latencyMs: Number.isFinite(result.latencyMs) ? result.latencyMs : null,
    error: result.error || ''
  };
}

function scoreDomain(domain, browser) {
  const browserReachable = browser.ok === true;
  const available = browserReachable && domain.enabled !== false;
  const browserLatency = Number.isFinite(browser.latencyMs) ? browser.latencyMs : 999999;
  const browserPenalty = browserReachable ? 0 : 200000;
  return { available, browserReachable, browserLatency, score: browserPenalty + browserLatency };
}

export function rankDomains(domains, browserResults = new Map()) {
  const ranked = domains
    .map((domain, index) => {
      const browser = normalizeBrowserResult(browserResults.get(domain.id));
      const computed = scoreDomain(domain, browser);
      return {
        ...domain,
        browserLatencyMs: browser.latencyMs,
        browserError: browser.error,
        browserReachable: computed.browserReachable,
        available: computed.available,
        recommended: false,
        _rankIndex: index,
        _score: computed.score
      };
    })
    .sort((a, b) => {
      if (a.available !== b.available) {
        return a.available ? -1 : 1;
      }
      if (Math.abs(a._score - b._score) > LATENCY_TIE_WINDOW_MS) {
        return a._score - b._score;
      }
      if ((b.weight || 0) !== (a.weight || 0)) {
        return (b.weight || 0) - (a.weight || 0);
      }
      return a._rankIndex - b._rankIndex;
    })
    .map(({ _rankIndex, _score, ...domain }) => domain);

  const firstAvailable = ranked.find((domain) => domain.available);
  if (firstAvailable) {
    firstAvailable.recommended = true;
  }
  return ranked;
}
