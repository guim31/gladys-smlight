// -----------------------------------------------------------------------------
// An in-memory SLZB coordinator, a fake network to reach it, and a fake
// SMLIGHT firmware catalog: the seams of src/app.js (`request`, `openStream`,
// `fetchJson`). Built from the real answers of test/fixtures/smlight/. No
// socket is opened.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

/** A fixture of test/fixtures/smlight/, parsed (a fresh copy each time). */
export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/smlight/${name}`, import.meta.url), 'utf8'));

const networkError = (code) => Object.assign(new Error(`connect ${code}`), { code });

export class FakeSlzb {
  /**
   * @param {object} [options]
   * @param {string} [options.info] fixture name of the `/ha_info` answer
   * @param {string} [options.sensors] fixture name of the `/ha_sensors` answer
   * @param {{ username: string, password: string }} [options.login] web interface login
   * @param {boolean} [options.events] the firmware serves the event stream
   */
  constructor({
    info = 'info-slzb-06p7-radios-v2.3.6.json',
    sensors = 'sensors-slzb-06.json',
    login = null,
    events = true,
  } = {}) {
    this.info = fixture(info).Info;
    this.sensors = fixture(sensors).Sensors;
    this.login = login;
    this.eventsEnabled = events;
    this.online = true;
    this.internet = true;
    /** Every request received: `{ method, path, query, body, authorization }`. */
    this.calls = [];
    this.streams = new Set();
  }

  get mac() {
    return this.info.MAC.toLowerCase();
  }

  /** Advance the uptime as time passes on the coordinator. */
  tick(seconds) {
    this.sensors.uptime += seconds;
    if (this.sensors.socket_uptime > 0) {
      this.sensors.socket_uptime += seconds;
    }
  }

  authorized(headers = {}) {
    if (!this.login) {
      return true;
    }
    const expected = `Basic ${Buffer.from(`${this.login.username}:${this.login.password}`).toString('base64')}`;
    return headers.authorization === expected;
  }

  /** The `request` seam, for this coordinator. */
  async handle(url, { method = 'GET', headers = {}, body } = {}) {
    if (!this.online) {
      throw networkError('EHOSTUNREACH');
    }
    const target = new URL(url);
    const query = Object.fromEntries(target.searchParams);
    this.calls.push({
      method,
      path: target.pathname,
      query,
      body,
      authorization: headers.authorization,
    });
    if (!this.authorized(headers)) {
      return { status: 401, headers: {}, body: '' };
    }
    const json = (data) => ({ status: 200, headers: {}, body: JSON.stringify(data) });
    const text = (value) => ({ status: 200, headers: {}, body: value });
    if (method === 'GET' && target.pathname === '/ha_info') {
      return json({ Info: this.info });
    }
    if (method === 'GET' && target.pathname === '/ha_sensors') {
      return json({ Sensors: this.sensors });
    }
    if (method === 'GET' && target.pathname === '/api2') {
      if (query.action === '4' && query.cmd === '3') {
        this.restarted = (this.restarted ?? 0) + 1;
        return text('ok');
      }
      if (query.action === '4' && query.cmd === '1') {
        this.radioRestarts = [...(this.radioRestarts ?? []), Number(query.idx ?? 0)];
        return text('ok');
      }
      if (query.action === '1' && query.param === 'inetState') {
        queueMicrotask(() => this.emit('EVENT_INET_STATE', this.internet ? 'ok' : 'fail'));
        return text('ok');
      }
    }
    if (method === 'POST' && target.pathname === '/settings/saveParams') {
      const form = Object.fromEntries(new URLSearchParams(body));
      const changes = {};
      for (const [toggle, sensor] of [
        ['disableLeds', 'disable_leds'],
        ['nightMode', 'night_mode'],
      ]) {
        if (form[toggle] !== undefined) {
          this.sensors[sensor] = form[toggle] === 'on';
          changes[toggle] = this.sensors[sensor];
        }
      }
      queueMicrotask(() =>
        this.emit(
          'SAVE_PARAMS',
          JSON.stringify({ page: Number(form.pageId), origin: 'ha', changes, needReboot: false }),
        ),
      );
      return text('ok');
    }
    return { status: 404, headers: {}, body: 'URL NOT FOUND' };
  }

  /** The `openStream` seam, for this coordinator. */
  stream(url, { onChunk, onEnd }) {
    if (!this.online || !this.eventsEnabled) {
      queueMicrotask(() => onEnd(networkError(this.online ? 'ECONNREFUSED' : 'EHOSTUNREACH')));
      return { close() {} };
    }
    const stream = { url, onChunk, onEnd };
    this.streams.add(stream);
    // The firmware sends a first event as soon as the stream opens.
    queueMicrotask(() => onChunk(': connected\n\n'));
    return {
      close: () => this.streams.delete(stream),
    };
  }

  /** Send an event to every open stream. */
  emit(type, data) {
    for (const stream of this.streams) {
      stream.onChunk(`event: ${type}\ndata: ${data}\n\n`);
    }
  }

  /** Close every stream from the coordinator side (it went offline, rebooted…). */
  dropStreams() {
    for (const stream of [...this.streams]) {
      this.streams.delete(stream);
      stream.onEnd(networkError('ECONNRESET'));
    }
  }
}

/**
 * A fake network: coordinators by `host` (port 80) or `host:port`.
 * @param {Record<string, FakeSlzb>} coordinators
 */
export function createNetwork(coordinators = {}) {
  const lookup = (url) => {
    const target = new URL(url);
    const host = target.hostname.replace(/^\[|\]$/g, '');
    const port = target.port || '80';
    return port === '80' || port === '81' ? coordinators[host] : coordinators[`${host}:${port}`];
  };
  return {
    coordinators,
    async request(url, options) {
      const coordinator = lookup(url);
      if (!coordinator) {
        throw networkError('ETIMEDOUT');
      }
      return coordinator.handle(url, options);
    },
    openStream(url, options) {
      const coordinator = lookup(url);
      if (!coordinator) {
        queueMicrotask(() => options.onEnd(networkError('ETIMEDOUT')));
        return { close() {} };
      }
      return coordinator.stream(url, options);
    },
  };
}

/**
 * The SMLIGHT firmware catalog: the core lists by type, the radio lists by
 * catalog device id.
 */
export function createCatalog({
  esp = fixture('catalog-esp.json'),
  espS3 = fixture('catalog-esp-s3.json'),
  zigbee = { 3: fixture('catalog-zigbee-06p7.json') },
} = {}) {
  const catalog = {
    esp,
    espS3,
    zigbee,
    failing: false,
    /** Every URL asked. */
    calls: [],
    async fetchJson(url) {
      catalog.calls.push(url);
      if (catalog.failing) {
        throw new Error('getaddrinfo ENOTFOUND updates.smlight.tech');
      }
      const query = Object.fromEntries(new URL(url).searchParams);
      if (query.type === 'ESP') {
        return structuredClone(catalog.esp);
      }
      if (query.type === 'ESPs3') {
        return structuredClone(catalog.espS3);
      }
      return structuredClone(catalog.zigbee[query.device] ?? []);
    },
  };
  return catalog;
}
