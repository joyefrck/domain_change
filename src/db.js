import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function nowIso() {
  return new Date().toISOString();
}

function parseTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }

  if (!tags) {
    return [];
  }

  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeTags(tags) {
  return JSON.stringify(parseTags(tags));
}

function domainFromRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    url: row.url,
    name: row.name,
    tags: parseTags(row.tags),
    weight: row.weight,
    enabled: row.enabled === 1,
    healthPath: row.health_path ?? '',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.hash = '';
  parsed.search = '';
  return parsed.origin;
}

function normalizeHealthPath(value) {
  const pathValue = String(value ?? '').trim();
  if (!pathValue) {
    return '';
  }
  return pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
}

function assertValidDomainInput(input, partial = false) {
  if (!partial || input.url !== undefined) {
    if (!input.url || typeof input.url !== 'string') {
      throw new Error('URL is required');
    }
    const parsed = new URL(input.url);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('URL must use http or https');
    }
  }

  if (input.weight !== undefined && (!Number.isInteger(input.weight) || input.weight < 0 || input.weight > 1000)) {
    throw new Error('Weight must be an integer between 0 and 1000');
  }
}

function normalizeSettings(input = {}) {
  const siteName = String(input.siteName ?? 'Domain Entry').trim();
  if (!siteName || siteName.length > 60) {
    throw new Error('Site name must be 1-60 characters');
  }
  return { siteName };
}

export function createDatabase(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });

  const sqlite = new Database(filePath);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      weight INTEGER NOT NULL DEFAULT 50,
      enabled INTEGER NOT NULL DEFAULT 1,
      health_path TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS probe_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      ok INTEGER NOT NULL,
      latency_ms INTEGER,
      error TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      ip_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      domain_id INTEGER,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  sqlite.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_at)
    VALUES ('siteName', 'Domain Entry', ?)
  `).run(nowIso());

  const domainSelect = 'SELECT d.* FROM domains d';

  function getDomain(id) {
    return domainFromRow(sqlite.prepare(`${domainSelect} WHERE d.id = ?`).get(id));
  }

  function insertAudit(actor, action, domainId, before, after) {
    sqlite.prepare(`
      INSERT INTO audit_logs (actor, action, domain_id, before_json, after_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      actor || 'system',
      action,
      domainId || null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      nowIso()
    );
  }

  return {
    getSettings() {
      const rows = sqlite.prepare('SELECT key, value FROM settings').all();
      const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
      return normalizeSettings({ siteName: settings.siteName });
    },

    getAdminPasswordHash() {
      const row = sqlite.prepare("SELECT value FROM settings WHERE key = 'adminPasswordHash'").get();
      return row?.value || '';
    },

    updateAdminPasswordHash(passwordHash, actor = 'admin') {
      if (!passwordHash || typeof passwordHash !== 'string') {
        throw new Error('Password hash is required');
      }
      sqlite.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES ('adminPasswordHash', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(passwordHash, nowIso());
      insertAudit(actor, 'update_admin_password', null, null, { changed: true });
    },

    updateSettings(input, actor = 'admin') {
      const before = this.getSettings();
      const next = normalizeSettings(input);
      sqlite.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES ('siteName', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(next.siteName, nowIso());
      insertAudit(actor, 'update_settings', null, before, next);
      return this.getSettings();
    },

    listDomains({ includeDisabled = false } = {}) {
      const rows = sqlite.prepare(`${domainSelect} ${includeDisabled ? '' : 'WHERE d.enabled = 1'} ORDER BY d.weight DESC, d.id ASC`).all();
      return rows.map(domainFromRow);
    },

    getDomain,

    createDomain(input, actor = 'admin') {
      assertValidDomainInput(input);
      const url = normalizeUrl(input.url);
      const name = input.name || new URL(url).hostname;
      const createdAt = nowIso();
      const result = sqlite.prepare(`
        INSERT INTO domains (url, name, tags, weight, enabled, health_path, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        url,
        name,
        serializeTags(input.tags),
        Number.isInteger(input.weight) ? input.weight : 50,
        input.enabled === false ? 0 : 1,
        normalizeHealthPath(input.healthPath),
        input.notes || '',
        createdAt,
        createdAt
      );
      const domain = getDomain(Number(result.lastInsertRowid));
      insertAudit(actor, 'create_domain', domain.id, null, domain);
      return domain;
    },

    updateDomain(id, patch, actor = 'admin') {
      const before = getDomain(id);
      if (!before) {
        return null;
      }
      assertValidDomainInput(patch, true);

      const next = {
        url: patch.url === undefined ? before.url : normalizeUrl(patch.url),
        name: patch.name === undefined ? before.name : String(patch.name || new URL(patch.url || before.url).hostname),
        tags: patch.tags === undefined ? before.tags : parseTags(patch.tags),
        weight: patch.weight === undefined ? before.weight : patch.weight,
        enabled: patch.enabled === undefined ? before.enabled : patch.enabled === true,
        healthPath: patch.healthPath === undefined ? before.healthPath : normalizeHealthPath(patch.healthPath),
        notes: patch.notes === undefined ? before.notes : String(patch.notes || '')
      };

      sqlite.prepare(`
        UPDATE domains
        SET url = ?, name = ?, tags = ?, weight = ?, enabled = ?, health_path = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        next.url,
        next.name,
        serializeTags(next.tags),
        next.weight,
        next.enabled ? 1 : 0,
        next.healthPath,
        next.notes,
        nowIso(),
        id
      );

      const after = getDomain(id);
      insertAudit(actor, 'update_domain', id, before, after);
      return after;
    },

    deleteDomain(id, actor = 'admin') {
      const before = getDomain(id);
      if (!before) {
        return false;
      }
      sqlite.prepare('DELETE FROM domains WHERE id = ?').run(id);
      insertAudit(actor, 'delete_domain', id, before, null);
      return true;
    },

    recordProbeResult(result) {
      sqlite.prepare(`
        INSERT INTO probe_results (domain_id, ok, latency_ms, error, user_agent, ip_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        result.domainId,
        result.ok ? 1 : 0,
        Number.isFinite(result.latencyMs) ? Math.round(result.latencyMs) : null,
        result.error || '',
        result.userAgent || '',
        result.ipHash || '',
        nowIso()
      );
    },

    listProbeResults(limit = 50) {
      return sqlite.prepare('SELECT * FROM probe_results ORDER BY id DESC LIMIT ?').all(limit);
    },

    listAuditLogs(limit = 100) {
      return sqlite.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
    },

    close() {
      sqlite.close();
    }
  };
}
