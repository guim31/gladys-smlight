// -----------------------------------------------------------------------------
// The event stream of one SLZB (Server-Sent Events): the Internet state
// (`EVENT_INET_STATE`, answer to the inetState request), the settings saved
// from any interface (`SAVE_PARAMS`), and the rest, ignored.
//
// The stream is a bonus: the readings of the timer stay the source of truth.
// When it drops, it is opened again after a growing delay (5 s to 5 min); a
// coordinator whose firmware has no stream simply has no Internet state.
//
// Event names and payloads from pysmlight (https://github.com/smlight-tech/pysmlight,
// Apache-2.0): const.py (Events), sse.py, tests/test_sse.py.
// -----------------------------------------------------------------------------

export const EVENT_TYPES = Object.freeze({
  INTERNET: 'EVENT_INET_STATE',
  SETTINGS: 'SAVE_PARAMS',
});

export const STREAM_TIMINGS = { firstRetryMs: 5_000, maxRetryMs: 5 * 60_000 };

/**
 * Incremental parser of a text/event-stream (WHATWG rules: `event:`, `data:`
 * lines, a blank line dispatches, `:` starts a comment).
 * @param {(event: { type: string, data: string }) => void} onEvent
 * @returns {(chunk: string) => void}
 */
export function createEventParser(onEvent) {
  let buffer = '';
  let type = '';
  let data = [];
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop();
    for (const line of lines) {
      if (line === '') {
        if (data.length > 0 || type) {
          onEvent({ type: type || 'message', data: data.join('\n') });
        }
        type = '';
        data = [];
        continue;
      }
      if (line.startsWith(':')) {
        continue;
      }
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
      if (field === 'event') {
        type = value;
      } else if (field === 'data') {
        data.push(value);
      }
    }
    // A stream that never ends a line is not an event stream: do not grow forever.
    if (buffer.length > 64 * 1024) {
      buffer = '';
    }
  };
}

/**
 * The settings carried by a SAVE_PARAMS event of the LED page:
 * `{"page":8,"origin":"ha","changes":{"disableLeds":true},"needReboot":false}`.
 * @returns {Record<string, boolean>|null} toggle name → value, null for another page
 */
export function ledChanges(data, page) {
  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  if (
    !payload ||
    payload.page !== page ||
    !payload.changes ||
    typeof payload.changes !== 'object'
  ) {
    return null;
  }
  const changes = {};
  for (const [key, value] of Object.entries(payload.changes)) {
    if (typeof value === 'boolean') {
      changes[key] = value;
    } else if (value === 0 || value === 1) {
      changes[key] = value === 1;
    }
  }
  return changes;
}

export class EventStream {
  /**
   * @param {object} options
   * @param {string} options.url
   * @param {Record<string, string>} [options.headers]
   * @param {Function} options.open transport seam (src/smlight/http.js openEventStream)
   * @param {(event: { type: string, data: string }) => void} options.onEvent
   * @param {(connected: boolean, error?: Error|null) => void} [options.onStatus]
   * @param {boolean} [options.timers] reconnect on its own (off in tests)
   */
  constructor({ url, headers, open, onEvent, onStatus = () => {}, timers = true, timings }) {
    this.url = url;
    this.headers = headers;
    this.open = open;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.timers = timers;
    this.timings = { ...STREAM_TIMINGS, ...timings };
    this.connection = null;
    this.retryTimer = null;
    this.retryMs = this.timings.firstRetryMs;
    this.connected = false;
    this.stopped = true;
  }

  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.connect();
  }

  connect() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const parse = createEventParser((event) => this.onEvent(event));
    this.connection = this.open(this.url, {
      headers: this.headers,
      onChunk: (text) => {
        // The first bytes prove the stream is open.
        if (!this.connected) {
          this.connected = true;
          this.retryMs = this.timings.firstRetryMs;
          this.onStatus(true);
        }
        parse(text);
      },
      onEnd: (error) => this.ended(error),
    });
  }

  ended(error) {
    this.connection = null;
    if (this.stopped) {
      return;
    }
    const wasConnected = this.connected;
    this.connected = false;
    this.onStatus(false, error ?? (wasConnected ? new Error('stream closed') : null));
    if (!this.timers) {
      return;
    }
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, this.timings.maxRetryMs);
    this.retryTimer = setTimeout(() => this.connect(), delay);
    this.retryTimer.unref?.();
  }

  stop() {
    this.stopped = true;
    this.connected = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.connection?.close();
    this.connection = null;
  }
}
