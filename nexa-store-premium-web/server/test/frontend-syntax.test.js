import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../');
const pages = ['index.html', 'admin.html'];

for (const page of pages) {
  test(`${page} inline JavaScript parses without syntax errors`, async () => {
    const html = await fs.readFile(path.join(webRoot, page), 'utf8');
    const scripts = [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].map(match => match[1]).filter(source => source.trim());
    assert.ok(scripts.length > 0, `No inline scripts found in ${page}`);
    for (const [index, source] of scripts.entries()) {
      assert.doesNotThrow(() => new vm.Script(source, { filename: `${page}#script-${index + 1}` }));
    }
  });
}
