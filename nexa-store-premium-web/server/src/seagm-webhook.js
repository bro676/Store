import crypto from 'node:crypto';
import { buildSeagmSignature } from './seagm-api.js';

const MAX_CALLBACK_BYTES = 32 * 1024;
const MAX_CALLBACK_FIELDS = 64;
const MAX_FIELD_VALUE_LENGTH = 8192;
const MAX_CLOCK_SKEW_SECONDS = 120;

function appendField(target, key, value) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(key)) {
    throw new Error('INVALID_SEAGM_CALLBACK_FIELD');
  }
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    throw new Error('DUPLICATE_SEAGM_CALLBACK_FIELD');
  }
  if (!['string', 'number', 'boolean'].includes(typeof value) || value === null) {
    throw new Error('INVALID_SEAGM_CALLBACK_VALUE');
  }
  const normalized = String(value);
  if (normalized.length > MAX_FIELD_VALUE_LENGTH) {
    throw new Error('SEAGM_CALLBACK_VALUE_TOO_LARGE');
  }
  if (Object.keys(target).length >= MAX_CALLBACK_FIELDS) {
    throw new Error('TOO_MANY_SEAGM_CALLBACK_FIELDS');
  }
  target[key] = normalized;
}

export function parseSeagmCallbackBody(rawBody, contentType = '') {
  const raw = String(rawBody || '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_CALLBACK_BYTES) {
    throw Object.assign(new Error('BODY_TOO_LARGE'), { status:413 });
  }
  if (!raw) return Object.create(null);

  const mediaType = String(contentType).split(';', 1)[0].trim().toLowerCase();
  const parsed = Object.create(null);

  if (mediaType === 'application/json') {
    let payload;
    try { payload = JSON.parse(raw); }
    catch { throw new Error('INVALID_SEAGM_CALLBACK_JSON'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('INVALID_SEAGM_CALLBACK_JSON_SHAPE');
    }
    for (const [key, value] of Object.entries(payload)) appendField(parsed, key, value);
    return parsed;
  }

  if (mediaType === 'application/x-www-form-urlencoded') {
    const form = new URLSearchParams(raw);
    for (const key of new Set(form.keys())) {
      const values = form.getAll(key);
      if (values.length !== 1) throw new Error('DUPLICATE_SEAGM_CALLBACK_FIELD');
      appendField(parsed, key, values[0]);
    }
    return parsed;
  }

  throw new Error('UNSUPPORTED_SEAGM_CALLBACK_CONTENT_TYPE');
}

export function mergeSeagmCallbackParams(queryParams, bodyParams) {
  const merged = Object.create(null);
  if (queryParams && typeof queryParams.entries === 'function') {
    for (const [key, value] of queryParams.entries()) appendField(merged, key, value);
  } else if (queryParams && typeof queryParams === 'object' && !Array.isArray(queryParams)) {
    for (const [key, value] of Object.entries(queryParams)) appendField(merged, key, value);
  } else if (queryParams !== undefined && queryParams !== null) {
    throw new Error('INVALID_SEAGM_CALLBACK_QUERY');
  }

  if (bodyParams && typeof bodyParams === 'object' && !Array.isArray(bodyParams)) {
    for (const [key, value] of Object.entries(bodyParams)) appendField(merged, key, value);
  } else if (bodyParams !== undefined && bodyParams !== null) {
    throw new Error('INVALID_SEAGM_CALLBACK_BODY');
  }
  return merged;
}

export function verifySeagmCallbackSignature(params, secretKey, {
  expectedUid = '',
  nowMs = Date.now(),
  maxClockSkewSeconds = MAX_CLOCK_SKEW_SECONDS,
} = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
  if (typeof secretKey !== 'string' || !secretKey || secretKey.length > 512) return false;

  const signature = String(params.signature || '');
  if (!/^[a-fA-F0-9]{64}$/.test(signature)) return false;

  const timestamp = Number(params.timestamp);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return false;
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  if (!Number.isSafeInteger(nowSeconds) ||
      Math.abs(nowSeconds - timestamp) > Math.max(0, Number(maxClockSkewSeconds) || 0)) {
    return false;
  }

  if (params.uid !== undefined && expectedUid &&
      String(params.uid) !== String(expectedUid)) {
    return false;
  }

  let expected;
  try {
    expected = Buffer.from(buildSeagmSignature(params, secretKey), 'hex');
  } catch {
    return false;
  }
  const supplied = Buffer.from(signature, 'hex');
  return expected.length === 32 &&
    supplied.length === expected.length &&
    crypto.timingSafeEqual(supplied, expected);
}

export const SEAGM_CALLBACK_LIMITS = Object.freeze({
  maxBytes: MAX_CALLBACK_BYTES,
  maxFields: MAX_CALLBACK_FIELDS,
  maxFieldValueLength: MAX_FIELD_VALUE_LENGTH,
  maxClockSkewSeconds: MAX_CLOCK_SKEW_SECONDS,
});
