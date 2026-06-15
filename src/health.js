export async function probeDomain(domain, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = new URL(domain.healthPath || '/healthz', domain.url).toString();
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json,text/plain,*/*' }
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      ok: response.ok,
      latencyMs,
      statusCode: response.status,
      error: response.ok ? '' : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      statusCode: null,
      error: error?.name === 'AbortError' ? 'timeout' : error?.message || 'probe failed'
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeAllDomains(db, options = {}) {
  const domains = db.listDomains({ includeDisabled: false });
  const results = await Promise.all(domains.map(async (domain) => {
    const result = await probeDomain(domain, options);
    db.recordHealthCheck(domain.id, result);
    return { domainId: domain.id, ...result };
  }));
  return results;
}
