import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const pages = ['admin.html', 'index.html'];

function checkJavaScript(source, label) {
  const result = spawnSync(process.execPath, ['--check'], {
    input: source,
    encoding: 'utf8',
    cwd: fileURLToPath(root),
    timeout: 15_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, label + ': ' + (result.stderr || result.stdout || 'syntax check failed'));
}

for (const page of pages) {
  test(page + ' inline scripts parse without syntax errors', async () => {
    const html = await readFile(new URL('../../' + page, import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script\\s*>/gi)]
      .filter(match => !/\\bsrc\\s*=/i.test(match[1]))
      .map(match => match[2]);
    assert.ok(scripts.length > 0, 'Expected at least one inline script in ' + page);
    scripts.forEach((script, index) => checkJavaScript(script, page + ' script ' + (index + 1)));
  });
}
