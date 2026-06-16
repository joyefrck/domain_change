import crypto from 'node:crypto';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formBody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { createSessionCookie, hashPassword, verifyPassword, verifyPasswordHash, verifySessionCookie } from './auth.js';

function hashIp(ip, secret) {
  return crypto.createHmac('sha256', secret).update(ip || '').digest('hex').slice(0, 24);
}

function toTags(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value.split(',').map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
}

function normalizeDomainPayload(payload = {}) {
  return {
    url: payload.url,
    name: payload.name,
    tags: toTags(payload.tags),
    weight: payload.weight === undefined ? undefined : Number(payload.weight),
    enabled: payload.enabled === undefined ? undefined : payload.enabled === true || payload.enabled === 'true',
    healthPath: payload.healthPath,
    notes: payload.notes
  };
}

function normalizeSettingsPayload(payload = {}) {
  return {
    siteName: payload.siteName
  };
}

async function verifyAdminPassword(db, password, fallbackPassword) {
  const storedHash = db.getAdminPasswordHash();
  if (storedHash) {
    return verifyPasswordHash(password, storedHash);
  }
  return verifyPassword(password, fallbackPassword);
}

export async function buildApp({
  db,
  adminPassword,
  sessionSecret,
  publicDir = path.join(process.cwd(), 'public')
}) {
  const app = Fastify({ logger: false });
  const cookieName = 'admin_session';

  await app.register(cookie);
  await app.register(formBody);
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    index: ['index.html']
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.decorate('requireAdmin', async (request, reply) => {
    if (!verifySessionCookie(request.cookies[cookieName], sessionSecret)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.get('/api/domains', async () => ({
    domains: db.listDomains({ includeDisabled: false }),
    generatedAt: new Date().toISOString()
  }));

  app.get('/api/settings', async () => db.getSettings());

  app.post('/api/probe-result', async (request, reply) => {
    const payload = request.body || {};
    if (!Number.isInteger(payload.domainId) || typeof payload.ok !== 'boolean') {
      return reply.code(400).send({ error: 'Invalid probe result' });
    }

    db.recordProbeResult({
      domainId: payload.domainId,
      ok: payload.ok,
      latencyMs: Number(payload.latencyMs),
      error: payload.error || '',
      userAgent: request.headers['user-agent'] || '',
      ipHash: hashIp(request.ip, sessionSecret)
    });
    return reply.code(204).send();
  });

  app.post('/admin/api/login', async (request, reply) => {
    const password = request.body?.password || '';
    if (!(await verifyAdminPassword(db, password, adminPassword))) {
      return reply.code(401).send({ error: 'Invalid password' });
    }

    reply.setCookie(cookieName, createSessionCookie(sessionSecret), {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 24 * 60 * 60
    });
    return { ok: true };
  });

  app.post('/admin/api/logout', {
    preHandler: app.requireAdmin
  }, async (_request, reply) => {
    reply.clearCookie(cookieName, { path: '/' });
    return { ok: true };
  });

  app.put('/admin/api/password', {
    preHandler: app.requireAdmin
  }, async (request, reply) => {
    const currentPassword = request.body?.currentPassword || '';
    const newPassword = request.body?.newPassword || '';

    if (newPassword.length < 8 || newPassword.length > 128) {
      return reply.code(400).send({ error: 'New password must be 8-128 characters' });
    }
    if (!(await verifyAdminPassword(db, currentPassword, adminPassword))) {
      return reply.code(401).send({ error: 'Current password is incorrect' });
    }

    db.updateAdminPasswordHash(hashPassword(newPassword), 'admin');
    reply.clearCookie(cookieName, { path: '/' });
    return { ok: true };
  });

  app.get('/admin/api/me', {
    preHandler: app.requireAdmin
  }, async () => ({ authenticated: true }));

  app.get('/admin/api/domains', {
    preHandler: app.requireAdmin
  }, async () => ({
    domains: db.listDomains({ includeDisabled: true })
  }));

  app.get('/admin/api/settings', {
    preHandler: app.requireAdmin
  }, async () => db.getSettings());

  app.put('/admin/api/settings', {
    preHandler: app.requireAdmin
  }, async (request, reply) => {
    try {
      const settings = db.updateSettings(normalizeSettingsPayload(request.body), 'admin');
      return { settings };
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });

  app.post('/admin/api/domains', {
    preHandler: app.requireAdmin
  }, async (request, reply) => {
    try {
      const domain = db.createDomain(normalizeDomainPayload(request.body), 'admin');
      return reply.code(201).send({ domain });
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });

  app.put('/admin/api/domains/:id', {
    preHandler: app.requireAdmin
  }, async (request, reply) => {
    try {
      const domain = db.updateDomain(Number(request.params.id), normalizeDomainPayload(request.body), 'admin');
      if (!domain) {
        return reply.code(404).send({ error: 'Domain not found' });
      }
      return { domain };
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });

  app.delete('/admin/api/domains/:id', {
    preHandler: app.requireAdmin
  }, async (request, reply) => {
    const deleted = db.deleteDomain(Number(request.params.id), 'admin');
    if (!deleted) {
      return reply.code(404).send({ error: 'Domain not found' });
    }
    return { ok: true };
  });

  app.get('/admin/api/audit-logs', {
    preHandler: app.requireAdmin
  }, async () => ({
    logs: db.listAuditLogs()
  }));

  app.get('/admin/api/probe-results', {
    preHandler: app.requireAdmin
  }, async () => ({
    results: db.listProbeResults()
  }));

  return app;
}
