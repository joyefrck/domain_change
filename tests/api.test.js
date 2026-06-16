import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

describe('Fastify API', () => {
  let app;
  let db;
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'domain-entry-api-'));
    db = createDatabase(path.join(dir, 'app.sqlite'));
    app = await buildApp({
      db,
      adminPassword: 'secret',
      sessionSecret: 'test-secret',
      publicDir: path.join(process.cwd(), 'public')
    });
  });

  afterEach(async () => {
    await app.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('requires admin authentication for write APIs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/api/domains',
      payload: { url: 'https://login.example.com' }
    });

    expect(response.statusCode).toBe(401);
  });

  it('serves the public entry page and admin page', async () => {
    const entry = await app.inject({ method: 'GET', url: '/' });
    const admin = await app.inject({ method: 'GET', url: '/admin/' });

    expect(entry.statusCode).toBe(200);
    expect(entry.body).toContain('<span data-site-name>Domain Entry</span>');
    expect(entry.body).toContain('<h1 data-site-title>网站可用性检测</h1>');
    expect(admin.statusCode).toBe(200);
    expect(admin.body).toContain('维护登录域名池');
  });

  it('serves static assets without browser caching', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/main.js' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.etag).toBeUndefined();
  });

  it('renders visibility toggles for every password field in the admin page', async () => {
    const admin = await app.inject({ method: 'GET', url: '/admin/' });
    const passwordFields = admin.body.match(/type="password"/g) || [];
    const toggleButtons = admin.body.match(/data-password-toggle/g) || [];

    expect(passwordFields).toHaveLength(3);
    expect(toggleButtons).toHaveLength(3);
  });

  it('exposes a lightweight health endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('lets an authenticated admin create and update domains', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: 'secret' }
    });
    const cookie = login.cookies[0].value;

    const create = await app.inject({
      method: 'POST',
      url: '/admin/api/domains',
      cookies: { admin_session: cookie },
      payload: {
        url: 'https://login.example.com',
        name: 'Login A',
        tags: ['domestic'],
        weight: 70,
        enabled: true,
        healthPath: '',
        notes: ''
      }
    });

    expect(create.statusCode).toBe(201);
    expect(create.json().domain.healthPath).toBe('');
    const id = create.json().domain.id;

    const update = await app.inject({
      method: 'PUT',
      url: `/admin/api/domains/${id}`,
      cookies: { admin_session: cookie },
      payload: { enabled: false, weight: 10 }
    });

    expect(update.statusCode).toBe(200);
    expect(update.json().domain).toMatchObject({ id, enabled: false, weight: 10 });
  });

  it('lets an authenticated admin clear an existing health path', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: 'secret' }
    });
    const cookie = login.cookies[0].value;
    const domain = db.createDomain({
      url: 'https://login.example.com',
      name: 'Login A',
      tags: [],
      weight: 70,
      enabled: true,
      healthPath: '/healthz',
      notes: ''
    }, 'seed');

    const update = await app.inject({
      method: 'PUT',
      url: `/admin/api/domains/${domain.id}`,
      cookies: { admin_session: cookie },
      payload: { healthPath: '' }
    });

    expect(update.statusCode).toBe(200);
    expect(update.json().domain.healthPath).toBe('');
  });

  it('returns blank health paths in the public domain list', async () => {
    db.createDomain({
      url: 'https://login.example.com',
      name: 'Login A',
      tags: [],
      weight: 70,
      enabled: true,
      healthPath: '',
      notes: ''
    }, 'seed');

    const domains = await app.inject({ method: 'GET', url: '/api/domains' });

    expect(domains.statusCode).toBe(200);
    expect(domains.json().domains[0].healthPath).toBe('');
  });

  it('returns enabled domains and accepts anonymous probe results', async () => {
    const domain = db.createDomain({
      url: 'https://login.example.com',
      name: 'Login A',
      tags: ['domestic'],
      weight: 70,
      enabled: true,
      healthPath: '/healthz',
      notes: ''
    }, 'seed');

    const domains = await app.inject({ method: 'GET', url: '/api/domains' });
    expect(domains.statusCode).toBe(200);
    expect(domains.json().domains).toHaveLength(1);
    expect(domains.json().domains[0]).not.toHaveProperty('serverHealth');

    const probe = await app.inject({
      method: 'POST',
      url: '/api/probe-result',
      headers: { 'user-agent': 'Vitest UA' },
      payload: { domainId: domain.id, ok: true, latencyMs: 110 }
    });
    expect(probe.statusCode).toBe(204);
    expect(db.listProbeResults()).toHaveLength(1);
  });

  it('does not expose server-side domain probe APIs', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: 'secret' }
    });
    const cookie = login.cookies[0].value;
    const domain = db.createDomain({
      url: 'https://login.example.com',
      name: 'Login A',
      tags: [],
      weight: 70,
      enabled: true,
      healthPath: '/healthz',
      notes: ''
    }, 'seed');

    const singleProbe = await app.inject({
      method: 'POST',
      url: `/admin/api/domains/${domain.id}/probe`,
      cookies: { admin_session: cookie }
    });
    const allProbe = await app.inject({
      method: 'POST',
      url: '/admin/api/probe-all',
      cookies: { admin_session: cookie }
    });

    expect(singleProbe.statusCode).toBe(404);
    expect(allProbe.statusCode).toBe(404);
  });

  it('returns public settings and lets an authenticated admin update the site name', async () => {
    const initial = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({ siteName: 'Domain Entry' });

    const login = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: 'secret' }
    });
    const cookie = login.cookies[0].value;

    const update = await app.inject({
      method: 'PUT',
      url: '/admin/api/settings',
      cookies: { admin_session: cookie },
      payload: { siteName: 'Elephant Route' }
    });

    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ settings: { siteName: 'Elephant Route' } });

    const current = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(current.json()).toEqual({ siteName: 'Elephant Route' });
  });

  it('lets an authenticated admin log out', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: 'secret' }
    });
    const cookie = login.cookies[0].value;

    const logout = await app.inject({
      method: 'POST',
      url: '/admin/api/logout',
      cookies: { admin_session: cookie }
    });

    expect(logout.statusCode).toBe(200);
    expect(logout.cookies[0]).toMatchObject({ name: 'admin_session', value: '' });
  });

  it('lets an authenticated admin change the login password', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: 'secret' }
    });
    const cookie = login.cookies[0].value;

    const change = await app.inject({
      method: 'PUT',
      url: '/admin/api/password',
      cookies: { admin_session: cookie },
      payload: { currentPassword: 'secret', newPassword: 'new-secret-123' }
    });

    expect(change.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: 'secret' }
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: 'new-secret-123' }
    });
    expect(newLogin.statusCode).toBe(200);
  });
});
