import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { sendJsonResponse } from '../src/http-response.js';

function createResponse(acceptEncoding = '') {
  let resolveEnd;
  const ended = new Promise(resolve => { resolveEnd = resolve; });
  const response = {
    req: { headers: { 'accept-encoding': acceptEncoding } },
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body) {
      this.body = Buffer.from(body);
      this.writableEnded = true;
      resolveEnd();
    },
  };
  return { response, ended };
}

test('large JSON API responses are gzip-compressed when accepted', async () => {
  const payload = { items: Array.from({ length: 500 }, (_, index) => ({ id: index, description: 'Digital store product '.repeat(8) })) };
  const { response, ended } = createResponse('br, gzip');
  sendJsonResponse(response, 200, payload);
  await ended;

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Encoding'], 'gzip');
  assert.match(response.headers.Vary, /Accept-Encoding/);
  assert.equal(Number(response.headers['Content-Length']), response.body.byteLength);
  assert.deepEqual(JSON.parse(gunzipSync(response.body).toString('utf8')), payload);
});

test('small JSON responses are not compressed', async () => {
  const payload = { ok: true };
  const { response, ended } = createResponse('gzip');
  sendJsonResponse(response, 200, payload);
  await ended;

  assert.equal(response.headers['Content-Encoding'], undefined);
  assert.equal(response.body.toString('utf8'), JSON.stringify(payload));
});

test('clients that disable gzip receive the uncompressed JSON body', async () => {
  const payload = { content: 'x'.repeat(4000) };
  const { response, ended } = createResponse('gzip;q=0');
  sendJsonResponse(response, 200, payload);
  await ended;

  assert.equal(response.headers['Content-Encoding'], undefined);
  assert.equal(response.body.toString('utf8'), JSON.stringify(payload));
});
