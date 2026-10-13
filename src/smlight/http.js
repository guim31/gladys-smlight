// -----------------------------------------------------------------------------
// The two functions that talk to the network, on node:http: a request whose
// whole body is read, and a long-lived Server-Sent Events stream. The SLZB
// web server speaks plain HTTP only.
//
// The client (src/smlight/client.js) and the event stream (src/smlight/events.js)
// take these functions as parameters: the tests replace them with an in-memory
// coordinator (test/helpers/fakeSlzb.js).
// -----------------------------------------------------------------------------

import http from 'node:http';

const MAX_BODY_BYTES = 512 * 1024;

/**
 * @param {string} url absolute http:// URL
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body] already encoded body
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export function httpRequest(url, { method = 'GET', headers = {}, body, timeoutMs = 10_000 } = {}) {
  const payload = body === undefined ? undefined : Buffer.from(body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method,
        headers: payload ? { ...headers, 'content-length': payload.length } : headers,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(payload);
  });
}

/**
 * Open a Server-Sent Events stream. `onChunk` receives the raw text as it
 * arrives (parsed by src/smlight/events.js); `onEnd` is called once, when the
 * stream ends, fails, stays silent `idleMs` long, or is closed.
 * @param {string} url
 * @param {object} options
 * @param {Record<string, string>} [options.headers]
 * @param {(text: string) => void} options.onChunk
 * @param {(error: Error|null) => void} options.onEnd
 * @param {number} [options.idleMs]
 * @returns {{ close: () => void }}
 */
export function openEventStream(url, { headers = {}, onChunk, onEnd, idleMs = 90_000 }) {
  let ended = false;
  const end = (error) => {
    if (!ended) {
      ended = true;
      onEnd(error);
    }
  };
  const request = http.request(url, {
    headers: { accept: 'text/event-stream', 'cache-control': 'no-cache', ...headers },
    // Socket inactivity: the firmware sends a ping event well within this delay.
    timeout: idleMs,
  });
  request.on('response', (response) => {
    if (response.statusCode !== 200) {
      response.resume();
      end(new Error(`HTTP ${response.statusCode}`));
      request.destroy();
      return;
    }
    response.setEncoding('utf8');
    response.on('data', (text) => onChunk(text));
    response.on('end', () => end(null));
    response.on('error', (err) => end(err));
  });
  request.on('timeout', () => request.destroy(new Error(`No event for ${idleMs} ms`)));
  request.on('error', (err) => end(err));
  request.end();
  return {
    close() {
      ended = true;
      request.destroy();
    },
  };
}
