import crypto from 'node:crypto';

const PASSWORD_BYTES = 64;
const SALT_BYTES = 16;
const SESSION_BYTES = 32;

export function normalizeCustomerPhone(value) {
  const raw = String(value ?? '').trim();
  if (raw.length > 32) return '';
  const compact = raw.replace(/[\s().-]/g, '');
  if (!/^\+?\d{7,20}$/.test(compact)) return '';
  return compact;
}

export function hashCustomerPassword(password) {
  const value = String(password ?? '');
  if (value.length < 8 || value.length > 128) {
    throw Object.assign(new Error('يجب أن تتكون كلمة المرور من 8 إلى 128 محرفاً.'), { status:400, code:'INVALID_PASSWORD' });
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(value, salt, PASSWORD_BYTES, { N:16384, r:8, p:1, maxmem:64*1024*1024 });
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

export function verifyCustomerPassword(password, encoded) {
  const parts = String(encoded ?? '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(parts[1]) || !/^[a-f0-9]{128}$/i.test(parts[2])) return false;
  try {
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(String(password ?? ''), Buffer.from(parts[1], 'hex'), PASSWORD_BYTES, { N:16384, r:8, p:1, maxmem:64*1024*1024 });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createCustomerSessionToken() {
  return crypto.randomBytes(SESSION_BYTES).toString('base64url');
}

export function hashCustomerSessionToken(token) {
  const value = String(token ?? '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(value)) return '';
  return crypto.createHash('sha256').update(value).digest('hex');
}
