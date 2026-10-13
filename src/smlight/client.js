// -----------------------------------------------------------------------------
// The local HTTP API of one SLZB coordinator.
//
//   GET  /ha_info                       identity, firmware, radios (JSON `Info`)
//   GET  /ha_sensors                    readings (JSON `Sensors`)
//   GET  /api2?action=4&cmd=3           restart the coordinator
//   GET  /api2?action=4&cmd=1[&idx=n]   restart a radio (the Zigbee chip)
//   GET  /api2?action=1&param=inetState ask for the Internet state (answered as
//                                       an `EVENT_INET_STATE` event)
//   POST /settings/saveParams           LED settings, form-encoded
//   SSE  http://<host>:81/              events (firmware after v2.6.8.dev25;
//                                       before: http://<host>/events)
//
// The web interface can be protected by a login (SLZB: Settings → Security):
// HTTP Basic authentication, sent with every request when a username is set.
//
// Ported from pysmlight (https://github.com/smlight-tech/pysmlight,
// Apache-2.0): web.py (endpoints, parameters, `ha=True`), sse.py (stream
// address by firmware version).
// -----------------------------------------------------------------------------

import { compareVersions } from './firmware.js';
import { parseInfo, parseSensors } from './model.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: off, unplugged, wrong address
  AUTH: 'auth', // the web interface login refused the credentials
  UNSUPPORTED: 'unsupported', // not an SLZB, or a firmware without /ha_info
  INVALID: 'invalid', // an answer that cannot be read
});

// pysmlight Actions / Commands / Pages.
const ACTION_GET_PARAM = 1;
const ACTION_CMD = 4;
const CMD_ZB_RST = 1;
const CMD_ESP_RES = 3;
export const PAGE_LED = 8;

// LED settings of the `Settings → LED` page, by setting key of this integration.
export const LED_SETTINGS = Object.freeze({
  disable_leds: 'disableLeds',
  night_mode: 'nightMode',
});

// The firmware that moved the event stream to port 81 (pysmlight sse.py).
const LEGACY_EVENTS_VERSION = 'v2.6.8.dev25';

export class SlzbError extends Error {
  constructor(kind, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.kind = kind;
  }
}

/** A host name or IP address as written in a URL (an IPv6 address in brackets). */
export const urlHost = (host) => (host.includes(':') ? `[${host}]` : host);

export class SlzbClient {
  /**
   * @param {object} options
   * @param {string} options.host IP address or host name
   * @param {number} [options.port] web interface port
   * @param {string} [options.username] web interface login (empty: none)
   * @param {string} [options.password]
   * @param {Function} options.request HTTP seam (src/smlight/http.js httpRequest)
   */
  constructor({ host, port = 80, username = '', password = '', request }) {
    this.host = host;
    this.base = `http://${urlHost(host)}${port === 80 ? '' : `:${port}`}`;
    this.request = request;
    // Built once; never logged.
    this.authorization = username
      ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      : null;
  }

  headers(extra = {}) {
    return this.authorization ? { ...extra, authorization: this.authorization } : extra;
  }

  async send(path, { method = 'GET', body, headers } = {}) {
    let response;
    try {
      response = await this.request(`${this.base}${path}`, {
        method,
        body,
        headers: this.headers(headers),
      });
    } catch (err) {
      throw new SlzbError(ERROR_KINDS.UNREACHABLE, `no answer (${err.code ?? err.message})`, err);
    }
    if (response.status === 401) {
      throw new SlzbError(ERROR_KINDS.AUTH, 'login refused (HTTP 401)');
    }
    return response;
  }

  async getJson(path, rootKey) {
    const response = await this.send(path, { headers: { accept: 'application/json' } });
    // Firmware before v2.3.6 has no /ha_* endpoint (pysmlight falls back to
    // the legacy dashboard page, which this integration does not read).
    if (response.status === 404 || response.body.trim() === 'URL NOT FOUND') {
      throw new SlzbError(ERROR_KINDS.UNSUPPORTED, `${path} not found: firmware too old?`);
    }
    if (response.status !== 200) {
      throw new SlzbError(ERROR_KINDS.INVALID, `${path} answered HTTP ${response.status}`);
    }
    let data;
    try {
      data = JSON.parse(response.body);
    } catch {
      throw new SlzbError(ERROR_KINDS.UNSUPPORTED, `${path} did not answer JSON: not an SLZB?`);
    }
    if (!data || typeof data !== 'object' || !data[rootKey]) {
      throw new SlzbError(ERROR_KINDS.UNSUPPORTED, `${path} answered without "${rootKey}"`);
    }
    return data[rootKey];
  }

  async getInfo() {
    const info = parseInfo(await this.getJson('/ha_info', 'Info'));
    if (!info.mac) {
      throw new SlzbError(ERROR_KINDS.UNSUPPORTED, '/ha_info answered without a MAC address');
    }
    return info;
  }

  async getSensors() {
    return parseSensors(await this.getJson('/ha_sensors', 'Sensors'));
  }

  /**
   * `/api2` command; resolves with the answer ("ok" on the firmware pysmlight
   * was written against). Any HTTP 200 counts as accepted: Home Assistant
   * ignores the text too.
   */
  async command(params) {
    const response = await this.send(`/api2?${new URLSearchParams(params)}`);
    if (response.status !== 200) {
      throw new SlzbError(ERROR_KINDS.INVALID, `command answered HTTP ${response.status}`);
    }
    return response.body.trim();
  }

  /** Restart the whole coordinator (ESP32 and radios): ~15 s without Zigbee. */
  restart() {
    return this.command({ action: ACTION_CMD, cmd: CMD_ESP_RES });
  }

  /** Restart one radio; the first one takes no index (pysmlight set_cmd). */
  restartRadio(index = 0) {
    const params = { action: ACTION_CMD, cmd: CMD_ZB_RST };
    if (index > 0) {
      params.idx = index;
    }
    return this.command(params);
  }

  /** Ask for the Internet state; the answer comes as an EVENT_INET_STATE event. */
  requestInternetState() {
    return this.command({ action: ACTION_GET_PARAM, param: 'inetState' });
  }

  /**
   * Turn an LED setting on or off.
   * @param {keyof typeof LED_SETTINGS} key
   * @param {boolean} on
   */
  async setLedSetting(key, on) {
    const toggle = LED_SETTINGS[key];
    if (!toggle) {
      throw new Error(`Unknown LED setting ${key}`);
    }
    // `ha=True`: what pysmlight sends (Python's urlencode of True).
    const body = new URLSearchParams({
      pageId: String(PAGE_LED),
      [toggle]: on ? 'on' : 'off',
      ha: 'True',
    }).toString();
    const response = await this.send('/settings/saveParams', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    if (response.status !== 200) {
      throw new SlzbError(
        ERROR_KINDS.INVALID,
        `saving the setting answered HTTP ${response.status}`,
      );
    }
  }

  /** Address of the event stream, which moved with firmware v2.6.8.dev26. */
  eventsUrl(coreVersion) {
    const comparison = compareVersions(coreVersion, LEGACY_EVENTS_VERSION);
    if (comparison !== null && comparison <= 0) {
      return `${this.base}/events`;
    }
    // Port 81 whatever the port of the web interface.
    return `http://${urlHost(this.host)}:81/`;
  }
}
