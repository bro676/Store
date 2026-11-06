const RETRYABLE_DATABASE_ERRORS = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
]);

export function isRetryableDatabaseError(error) {
  const code = error?.code || error?.cause?.code;
  return RETRYABLE_DATABASE_ERRORS.has(String(code || '').toUpperCase());
}

export function nextDatabaseRetry(state = null, now = Date.now(), {
  baseDelayMs = 5_000,
  maxDelayMs = 60_000,
  logIntervalMs = 60_000,
} = {}) {
  const baseDelay = Number.isFinite(baseDelayMs) && baseDelayMs > 0 ? baseDelayMs : 5_000;
  const maxDelay = Number.isFinite(maxDelayMs) && maxDelayMs >= baseDelay
    ? maxDelayMs
    : Math.max(baseDelay, 60_000);
  const logInterval = Number.isFinite(logIntervalMs) && logIntervalMs > 0 ? logIntervalMs : 60_000;
  const previousAttempt = Number.isSafeInteger(state?.attempt) && state.attempt > 0 ? state.attempt : 0;
  const attempt = previousAttempt + 1;
  const delayMs = Math.min(baseDelay * (2 ** Math.min(attempt - 1, 20)), maxDelay);
  const previousLogAt = Number(state?.nextLogAt);
  const shouldLog = !Number.isFinite(previousLogAt) || now >= previousLogAt;
  return {
    attempt,
    delayMs,
    nextAttemptAt: now + delayMs,
    nextLogAt: shouldLog ? now + logInterval : previousLogAt,
    shouldLog,
  };
}

export async function waitForDatabase(pool, {
  attempts = 5,
  baseDelayMs = 500,
  maxDelayMs = 3000,
  sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  onRetry,
} = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool with a query() method is required.');
  }

  const maxAttempts = Number.isSafeInteger(attempts) && attempts > 0 ? attempts : 1;
  const baseDelay = Number.isFinite(baseDelayMs) && baseDelayMs >= 0 ? baseDelayMs : 500;
  const maxDelay = Number.isFinite(maxDelayMs) && maxDelayMs >= 0 ? maxDelayMs : 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (!isRetryableDatabaseError(error) || attempt === maxAttempts) {
        const startupError = new Error(
          `PostgreSQL startup check failed after ${attempt} attempt${attempt === 1 ? '' : 's'}: ${error?.message || 'unknown database error'}`,
          { cause: error }
        );
        startupError.code = error?.code || error?.cause?.code || 'DATABASE_STARTUP_FAILED';
        throw startupError;
      }

      const delayMs = Math.min(baseDelay * (2 ** (attempt - 1)), maxDelay);
      if (typeof onRetry === 'function') onRetry(error, attempt, delayMs);
      if (delayMs > 0) await sleep(delayMs);
    }
  }
}
