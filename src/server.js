import path from 'node:path';
import { createDatabase } from './db.js';
import { buildApp } from './app.js';
import { probeAllDomains } from './health.js';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const dbPath = process.env.DB_PATH || path.join(dataDir, 'domain-entry.sqlite');
const adminPassword = process.env.ADMIN_PASSWORD || 'change-me';
const sessionSecret = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const probeIntervalMs = Number(process.env.PROBE_INTERVAL_MS || 60_000);

if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET)) {
  throw new Error('ADMIN_PASSWORD and SESSION_SECRET are required in production');
}

const db = createDatabase(dbPath);
const app = await buildApp({
  db,
  adminPassword,
  sessionSecret,
  publicDir: path.join(process.cwd(), 'public')
});

async function runProbeCycle() {
  try {
    await probeAllDomains(db);
  } catch (error) {
    app.log?.error?.(error);
  }
}

setInterval(runProbeCycle, probeIntervalMs).unref();
runProbeCycle();

await app.listen({ port, host });
console.log(`Domain entry server listening on http://${host}:${port}`);
