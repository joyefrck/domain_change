import crypto from 'node:crypto';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionCookie(secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ role: 'admin', exp: now + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionCookie(cookie, secret, now = Date.now()) {
  if (!cookie || typeof cookie !== 'string' || !cookie.includes('.')) {
    return false;
  }

  const [payload, signature] = cookie.split('.');
  if (!payload || !signature || sign(payload, secret) !== signature) {
    return false;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.role === 'admin' && Number.isFinite(session.exp) && session.exp > now;
  } catch {
    return false;
  }
}

export async function verifyPassword(input, expected) {
  const inputBuffer = Buffer.from(input || '');
  const expectedBuffer = Buffer.from(expected || '');
  if (inputBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(inputBuffer, expectedBuffer);
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, salt, 64).toString('base64url');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPasswordHash(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') {
    return false;
  }

  const [scheme, salt, hash] = storedHash.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) {
    return false;
  }

  const calculated = crypto.scryptSync(password || '', salt, 64);
  const expected = Buffer.from(hash, 'base64url');
  if (calculated.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(calculated, expected);
}
