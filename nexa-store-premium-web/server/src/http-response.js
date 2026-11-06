import { gzip } from 'node:zlib';

function acceptsGzip(header) {
  return String(header || '').split(',').some(token => {
    const [name, ...parameters] = token.trim().split(';');
    if (name.trim().toLowerCase() !== 'gzip') return false;
    const quality = parameters.map(value => value.trim()).find(value => /^q\s*=/i.test(value));
    return !quality || Number(quality.split('=')[1]) > 0;
  });
}

function mergeVary(value, token) {
  const values = String(value || '').split(',').map(part => part.trim()).filter(Boolean);
  if (!values.some(part => part.toLowerCase() === token.toLowerCase())) values.push(token);
  return values.join(', ');
}

/**
 * Send JSON with asynchronous gzip compression for larger API payloads.
 * Compression runs in libuv's worker pool instead of blocking the request loop.
 */
export function sendJsonResponse(res, status, data, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(data));
  const baseHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self' data: blob: https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    ...extraHeaders,
  };

  const finish = (payload, compressed = false) => {
    if (res.destroyed || res.writableEnded || res.headersSent) return;
    const headers = {
      ...baseHeaders,
      'Content-Length': String(payload.byteLength),
    };
    if (compressed) {
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = mergeVary(headers.Vary, 'Accept-Encoding');
    }
    res.writeHead(status, headers);
    res.end(payload);
  };

  const encoding = res.req?.headers?.['accept-encoding'] || '';
  if (body.byteLength < 1024 || !acceptsGzip(encoding)) {
    finish(body);
    return;
  }

  gzip(body, { level: 1 }, (error, compressed) => {
    if (error) {
      finish(body);
      return;
    }
    finish(compressed, true);
  });
}
