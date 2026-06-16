import { describe, expect, it } from 'vitest';
import { rankDomains } from '../src/domainSelection.js';

describe('rankDomains', () => {
  it('prioritizes browser-reachable domains by latency and weight only', () => {
    const domains = [
      {
        id: 1,
        url: 'https://slow.example.com',
        weight: 100,
        enabled: true,
        serverHealth: { ok: true, latencyMs: 800 }
      },
      {
        id: 2,
        url: 'https://fast.example.com',
        weight: 50,
        enabled: true,
        serverHealth: { ok: false, latencyMs: null }
      },
      {
        id: 3,
        url: 'https://down.example.com',
        weight: 1000,
        enabled: true,
        serverHealth: { ok: false, latencyMs: null }
      }
    ];

    const browserResults = new Map([
      [1, { ok: true, latencyMs: 420 }],
      [2, { ok: true, latencyMs: 120 }],
      [3, { ok: false, latencyMs: 5000 }]
    ]);

    const ranked = rankDomains(domains, browserResults);

    expect(ranked.map((domain) => domain.id)).toEqual([2, 1, 3]);
    expect(ranked[0]).toMatchObject({
      id: 2,
      recommended: true,
      browserReachable: true,
      available: true
    });
    expect(ranked[2].available).toBe(false);
  });

  it('uses configured weight as a tie breaker when browser latency is similar', () => {
    const ranked = rankDomains(
      [
        { id: 1, url: 'https://a.example.com', weight: 10, enabled: true, serverHealth: { ok: true } },
        { id: 2, url: 'https://b.example.com', weight: 90, enabled: true, serverHealth: { ok: true } }
      ],
      new Map([
        [1, { ok: true, latencyMs: 205 }],
        [2, { ok: true, latencyMs: 200 }]
      ])
    );

    expect(ranked.map((domain) => domain.id)).toEqual([2, 1]);
  });
});
