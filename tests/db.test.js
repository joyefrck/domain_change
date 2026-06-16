import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db.js';

describe('database', () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'domain-entry-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists domains, audit logs, and browser probe results', () => {
    const db = createDatabase(path.join(dir, 'app.sqlite'));
    const domain = db.createDomain({
      url: 'https://login.example.com',
      name: 'Login A',
      tags: ['domestic', 'primary'],
      weight: 80,
      enabled: true,
      healthPath: '/healthz',
      notes: 'first line'
    }, 'admin');

    db.recordProbeResult({
      domainId: domain.id,
      ok: true,
      latencyMs: 90,
      userAgent: 'Vitest',
      ipHash: 'hash'
    });

    const domains = db.listDomains({ includeDisabled: true });
    expect(domains).toHaveLength(1);
    expect(domains[0]).toMatchObject({
      id: domain.id,
      url: 'https://login.example.com',
      tags: ['domestic', 'primary']
    });
    expect(domains[0]).not.toHaveProperty('serverHealth');

    expect(db.listAuditLogs()).toHaveLength(1);
    expect(db.listProbeResults()).toHaveLength(1);
    db.close();
  });

  it('persists global site settings', () => {
    const db = createDatabase(path.join(dir, 'settings.sqlite'));

    expect(db.getSettings()).toEqual({ siteName: 'Domain Entry' });

    const settings = db.updateSettings({ siteName: 'Elephant Route' }, 'admin');

    expect(settings).toEqual({ siteName: 'Elephant Route' });
    expect(db.getSettings()).toEqual({ siteName: 'Elephant Route' });
    expect(db.listAuditLogs()).toHaveLength(1);
    db.close();
  });
});
