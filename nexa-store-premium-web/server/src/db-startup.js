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

function isRetryableDatabaseError(error) {
  const code = error?.code || error?.cause?.code;
  return RETRYABLE_DATABASE_ERRORS.has(String(code || '').toUpperCase());
}

export async function waitForDatabase(pool, {
  attempts = 12,
  baseDelayMs = 1000,
  maxDelayMs = 5000,
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


/**
 * Guard a checked-out pg client against connection-level error events.
 * pg.Pool reports errors for idle clients, but a connection can also reset
 * while application code holds it inside a transaction. Keep that error
 * handled and evict the damaged client when the caller releases it.
 */
export function guardPoolClient(client, onError = () => {}) {
  if (!client || typeof client.on !== 'function' || typeof client.release !== 'function') {
    throw new TypeError('A checked-out PostgreSQL client is required.');
  }

  const originalRelease = client.release.bind(client);
  let connectionError = null;
  let released = false;

  const handleError = error => {
    connectionError ||= error || new Error('PostgreSQL client connection failed.');
    try { onError(connectionError, client); } catch {}
  };

  client.on('error', handleError);
  client.release = error => {
    if (released) return;
    released = true;
    client.removeListener?.('error', handleError);
    return originalRelease(connectionError || error);
  };

  return client;
}
