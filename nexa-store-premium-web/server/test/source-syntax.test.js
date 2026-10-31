import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('../', import.meta.url));
const serverPath = fileURLToPath(new URL('../src/server.js', import.meta.url));

test('production server entrypoint parses without syntax errors', async () => {
  const source = await readFile(serverPath, 'utf8');
  const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {
    input: source,
    encoding: 'utf8',
    cwd: serverDir,
    timeout: 15_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout || 'Node syntax check failed.');
});
