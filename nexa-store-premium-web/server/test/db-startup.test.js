import test from 'node:test';
import assert from 'node:assert/strict';
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
