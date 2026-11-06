import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { waitForDatabase } from '../src/db-startup.js';

test('database startup succeeds immediately when PostgreSQL is reachable', async () => {
  let calls = 0;
  await waitForDatabase({
    async query(sql) {
      calls += 1;
      assert.equal(sql, 'SELECT 1');
    },
  });
  assert.equal(calls, 1);
});

test('database startup retries transient DNS and connection failures with bounded backoff', async () => {
  let calls = 0;
  const delays = [];
  const retries = [];
  await waitForDatabase({
    async query() {
      calls += 1;
      if (calls < 4) {
        const error = new Error('temporary database DNS failure');
        error.code = calls === 1 ? 'ENOTFOUND' : 'ECONNRESET';
        throw error;
      }
    },
  }, {
    attempts: 5,
    baseDelayMs: 500,
    maxDelayMs: 1500,
    sleep: async (ms) => delays.push(ms),
    onRetry: (error, attempt, delayMs) => retries.push({ code: error.code, attempt, delayMs }),
  });
  assert.equal(calls, 4);
  assert.deepEqual(delays, [500, 1000, 1500]);
  assert.deepEqual(retries.map(item => item.code), ['ENOTFOUND', 'ECONNRESET', 'ECONNRESET']);
});

test('database startup does not retry permanent authentication or configuration errors', async () => {
  let calls = 0;
  let sleepCalls = 0;
  const authError = new Error('password authentication failed');
  authError.code = '28P01';
  await assert.rejects(
    waitForDatabase({
      async query() {
        calls += 1;
        throw authError;
      },
    }, {
      attempts: 5,
      sleep: async () => { sleepCalls += 1; },
    }),
    error => error.code === '28P01' && error.cause === authError
  );
  assert.equal(calls, 1);
  assert.equal(sleepCalls, 0);
});

test('database startup fails clearly after exhausting transient retries', async () => {
  let calls = 0;
  const delays = [];
  const lastError = new Error('database host is temporarily unavailable');
  lastError.code = 'ENOTFOUND';
  await assert.rejects(
    waitForDatabase({
      async query() {
        calls += 1;
        throw lastError;
      },
    }, {
      attempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 1000,
      sleep: async ms => delays.push(ms),
    }),
    error => error.message.includes('after 3 attempts') &&
      error.code === 'ENOTFOUND' &&
      error.cause === lastError
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 500]);
});

test('database startup validates the PostgreSQL pool input', async () => {
  await assert.rejects(waitForDatabase(null), TypeError);
});

test('database errors are classified by PostgreSQL/network codes, including nested causes', async () => {
  const { isRetryableDatabaseError } = await import('../src/db-startup.js');
  for (const code of ['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT','08004']) {
    assert.equal(isRetryableDatabaseError({ code }), true, code + ' should retry');
  }
  assert.equal(isRetryableDatabaseError({ cause: { code: 'ECONNRESET' } }), true);
  assert.equal(isRetryableDatabaseError({ code: '28P01' }), false, 'Authentication errors are not treated as transient');
  assert.equal(isRetryableDatabaseError(new Error('unknown error')), false);
});

test('background database retry schedule backs off to one minute and throttles repeated logs', async () => {
  const { nextDatabaseRetry } = await import('../src/db-startup.js');
  let state = null;
  const delays = [];
  const first = nextDatabaseRetry(state, 1_000);
  state = first; delays.push(first.delayMs);
  assert.equal(first.shouldLog, true);
  for (const now of [6_000,16_000,36_000,76_000,136_000]) {
    const next = nextDatabaseRetry(state, now);
    state = next; delays.push(next.delayMs);
    if (now < 61_000) assert.equal(next.shouldLog, false, 'Logs stay throttled inside the one-minute window');
  }
  assert.deepEqual(delays,[5_000,10_000,20_000,40_000,60_000,60_000]);
  const afterLogWindow=nextDatabaseRetry(state,197_000);
  assert.equal(afterLogWindow.shouldLog,true,'A new diagnostic is emitted after the one-minute log interval');
  assert.equal(afterLogWindow.nextLogAt,257_000);
});

test('non-transient database claim errors use a slow diagnostic retry cadence', async () => {
  const { nextDatabaseRetry } = await import('../src/db-startup.js');
  const retry=nextDatabaseRetry(null,5_000,{baseDelayMs:60_000,maxDelayMs:60_000});
  assert.equal(retry.delayMs,60_000);
  assert.equal(retry.nextAttemptAt,65_000);
});

test('SEAGM fulfillment worker defers repeated database claim failures and resets after a successful claim', async () => {
  const server = await fs.readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(server.includes("import { waitForDatabase, isRetryableDatabaseError, nextDatabaseRetry } from './db-startup.js';"));
  assert.ok(server.includes('if(seagmFulfillmentDbRetryState&&Date.now()<seagmFulfillmentDbRetryState.nextAttemptAt)return;'),
    'The five-second worker timer respects the database retry deadline');
  assert.ok(server.includes('job=await claimSeagmFulfillmentJob();\n    seagmFulfillmentDbRetryState=null;'),
    'A successful database claim clears the retry state immediately');
  assert.ok(server.includes("console.warn('[database] SEAGM worker paused after a transient database connection failure'"),
    'Transient connection failures produce a throttled warning instead of a warning every five seconds');
});
