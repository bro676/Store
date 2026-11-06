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

export function monitorPostgresClientErrors(pool, onClientError) {
  if (!pool || typeof pool.on !== 'function') {
    throw new TypeError('A PostgreSQL pool with an on() method is required.');
  }
  if (typeof onClientError !== 'function') {
    throw new TypeError('A PostgreSQL client error callback is required.');
  }

  const monitoredClients = new WeakSet();
  const onConnect = client => {
    if (!client || typeof client.on !== 'function' || monitoredClients.has(client)) return;
    monitoredClients.add(client);
    client.on('error', error => onClientError(error, client));
  };

  pool.on('connect', onConnect);
  return () => {
    if (typeof pool.off === 'function') pool.off('connect', onConnect);
    else pool.removeListener?.('connect', onConnect);
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
